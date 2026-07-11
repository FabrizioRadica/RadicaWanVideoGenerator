"""GameLab AI Game Generator (PATCH_GameLabPromptToGameConfig_v1).

Controlled prompt-to-game-configuration flow for template-based Canvas2D games:

    user prompt + manually selected template
        -> shared AI Assistant provider layer (never bypassed)
        -> JSON game configuration ONLY (never runtime code)
        -> jsonschema validation against the template's schema.json
        -> stored in the GameLab project (ai_game section of game.json)
        -> build: locked template runtime copied verbatim + validated config
        -> standalone browser export (HTML/CSS/vanilla JS/JSON, no server)

The template runtime is LOCKED: generation never modifies runtime files, and
the build step only copies them byte-for-byte from gamelab_templates/.
"""

from __future__ import annotations

import json
import re
import shutil

import jsonschema

from app.config import logger
from app.models.ai_assistant_models import (
    PROVIDER_DEFAULTS,
    AIAssistantConfig,
    AIProviderSettings,
)
from app.models.gamelab_models import AIGameData, utc_now
from app.services import gamelab_service, gamelab_template_service
from app.services.ai_assistant import config_service
from app.services.ai_assistant.parser import _extract_json_blob
from app.services.ai_assistant.providers import AIProviderError, get_provider
from app.services.ai_assistant.resource_manager import STATUS_IDLE, resource_manager
from app.services.gamelab_service import GameLabError

STATUS_GENERATING_GAME = "AI Assistant generating game configuration..."

# Game configs are larger than clip prompts; guarantee enough output tokens so
# the JSON is not truncated mid-object, without touching the saved settings.
_MIN_GAME_CONFIG_TOKENS = 4096

_SYSTEM_PROMPT = """\
You are the RadicaLab GameLab configuration generator.

You generate JSON game configurations for existing, locked Canvas2D game \
templates. You NEVER generate JavaScript, CSS, HTML or any runtime code — the \
template runtime already exists and must not be changed.

Hard rules:
1. Output must validate against the template's JSON Schema provided below.
2. Never invent configuration keys. Unknown keys are rejected.
3. Never reference asset files you do not know to exist. Omit sprite mappings \
so the runtime uses its procedural fallbacks.
4. If the user asks for a feature the template does not support, adapt the \
request to the closest supported behavior and record a short human-readable \
note in the "warnings" list. Never fake the feature with invented keys.
5. Follow the template's generation rules exactly.

Respond ONLY with a single JSON object in this exact shape (no markdown, no \
prose outside the JSON):
{"game_config": { ...the template configuration... },
 "warnings": ["...one entry per adapted/unsupported request, empty if none..."],
 "notes": "one short sentence about the design (optional)"}"""


# --------------------------------------------------------------------------- #
# Provider resolution (shared AI Assistant layer — patch mandatory rule)
# --------------------------------------------------------------------------- #
def resolve_provider_settings(config: AIAssistantConfig, provider: str | None,
                              model_name: str | None) -> AIProviderSettings:
    """Provider settings for this generation, based on the SHARED stored config.

    No override -> the stored settings verbatim. A provider/model override from
    the GameLab UI still goes through the same AIProviderSettings model, the
    same drivers and the same resource rules. The stored API key is only kept
    when the provider is unchanged (keys are per-provider)."""
    stored = config.provider
    chosen = (provider or "").strip().lower() or stored.provider.value
    if chosen not in PROVIDER_DEFAULTS:
        raise AIProviderError(f"Unknown AI provider: {chosen}")
    data = stored.model_dump()
    if chosen != stored.provider.value:
        data.update({"provider": chosen, "base_url": "", "api_key": "", "model_name": ""})
    if model_name is not None and str(model_name).strip():
        data["model_name"] = str(model_name).strip()
    settings = AIProviderSettings.model_validate(data)
    if settings.requires_key() and not settings.api_key.strip():
        raise AIProviderError(
            f"{PROVIDER_DEFAULTS[chosen]['label']} needs an API key. Configure it in "
            "Settings → AI Prompt Assistant first.")
    return settings


# --------------------------------------------------------------------------- #
# Prompt construction (controlled — patch "Internal prompt construction")
# --------------------------------------------------------------------------- #
def _build_user_message(user_prompt: str, template: dict, schema: dict,
                        generation_rules: str) -> str:
    meta = template["meta"]
    lines = [
        f"Template: {meta.get('template_id')} — {meta.get('name', '')}",
        f"Engine: {meta.get('engine', 'canvas2d')}",
    ]
    caps = meta.get("capabilities") or []
    if caps:
        lines.append("Supported capabilities:\n- " + "\n- ".join(str(c) for c in caps))
    cons = meta.get("constraints") or []
    if cons:
        lines.append("Template constraints:\n- " + "\n- ".join(str(c) for c in cons))
    if generation_rules.strip():
        lines.append("Template generation rules:\n" + generation_rules.strip())
    lines.append("JSON Schema the game_config must validate against "
                 "(additionalProperties are rejected):\n"
                 + json.dumps(schema, ensure_ascii=False))
    lines.append("User game request:\n" + user_prompt.strip())
    lines.append('Return ONLY the JSON object {"game_config": ..., "warnings": [...], '
                 '"notes": "..."} described in the system instructions.')
    return "\n\n".join(lines)


async def _run_provider(config: AIAssistantConfig, provider_settings: AIProviderSettings,
                        user_message: str) -> tuple[str, dict]:
    """Call the provider under the shared resource-manager rules (render block,
    serialization, release after generation) — same behavior as the Prompt
    Assistant. Cleanup failures never discard a successful generation."""
    if provider_settings.max_tokens < _MIN_GAME_CONFIG_TOKENS:
        provider_settings = provider_settings.model_copy(
            update={"max_tokens": _MIN_GAME_CONFIG_TOKENS})
    provider = get_provider(provider_settings)
    is_local = provider_settings.is_local()
    lock = resource_manager.acquire(config.resources, is_local)
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]
    async with lock:
        resource_manager._busy = True
        resource_manager.set_status(STATUS_GENERATING_GAME)
        try:
            text = await provider.generate_chat_completion(messages)
        finally:
            resource_manager._busy = False
        try:
            release = await resource_manager.release(provider, config.resources, is_local)
        except Exception as exc:  # noqa: BLE001 — cleanup must not fail the result
            logger.warning("GameLab AI resource release raised (non-fatal): %s", exc)
            release = {"ok": False, "released": False,
                       "warning": f"Config generated, but resource cleanup failed: {exc}",
                       "reason": "cleanup_exception"}
    if not is_local:
        resource_manager.set_status(STATUS_IDLE)
    return text, release


# --------------------------------------------------------------------------- #
# Validation (jsonschema against the selected template's schema.json)
# --------------------------------------------------------------------------- #
def validate_config(config_obj: dict, schema: dict) -> list[str]:
    """Readable schema validation errors (empty = valid)."""
    try:
        validator = jsonschema.Draft7Validator(schema)
    except jsonschema.exceptions.SchemaError as exc:
        return [f"The template schema itself is invalid: {exc.message}"]
    errors = []
    for err in sorted(validator.iter_errors(config_obj), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in err.absolute_path) or "(root)"
        errors.append(f"{where}: {err.message}")
    return errors[:40]


def _parse_generation(text: str, template_id: str) -> tuple[dict | None, list[str], str]:
    """Recover (game_config, model_warnings, notes) from the LLM response."""
    blob = _extract_json_blob(text)
    if not isinstance(blob, dict):
        return None, [], ""
    cfg = blob.get("game_config")
    if not isinstance(cfg, dict):
        # Some models return the bare config object without the wrapper.
        cfg = blob if "warnings" not in blob and "game_config" not in blob else None
    if not isinstance(cfg, dict):
        return None, [], ""
    warnings = [str(w) for w in blob.get("warnings") or [] if str(w).strip()]
    notes = str(blob.get("notes") or "").strip()
    # The schema pins "template" with a const but does not require it; setting
    # the selected id when absent is normalization, not invention.
    cfg.setdefault("template", template_id)
    return cfg, warnings, notes


# --------------------------------------------------------------------------- #
# Generate + store (patch flow steps 5-8)
# --------------------------------------------------------------------------- #
async def generate_config(game_id: str, template_id: str, user_prompt: str,
                          provider: str | None = None,
                          model_name: str | None = None) -> dict:
    project = gamelab_service.load_game(game_id)  # ensures the project exists
    user_prompt = (user_prompt or "").strip()
    if not user_prompt:
        raise GameLabError("Write a game prompt first.")
    template = gamelab_template_service.load_template(template_id)
    schema = gamelab_template_service.load_schema(template)
    rules = gamelab_template_service.load_generation_rules(template)

    config = config_service.load_config()
    provider_settings = resolve_provider_settings(config, provider, model_name)
    preflight = resource_manager.preflight_warnings(config.resources,
                                                    provider_settings.is_local())

    user_message = _build_user_message(user_prompt, template, schema, rules)
    text, release = await _run_provider(config, provider_settings, user_message)

    cfg, model_warnings, notes = _parse_generation(text, template["summary"]["template_id"])
    if cfg is None:
        return {"ok": False, "parse_error": True, "raw": text[:8000],
                "errors": ["The AI did not return a JSON game configuration. "
                           "Try again, or use a stronger model / higher max tokens."],
                "warnings": preflight, "release": release,
                "status": resource_manager.status}

    errors = validate_config(cfg, schema)
    ai_game = AIGameData(
        template_id=template["summary"]["template_id"],
        prompt=user_prompt,
        provider=provider_settings.provider.value,
        model_name=provider_settings.effective_model(),
        config=cfg,
        schema_valid=not errors,
        warnings=model_warnings,
        generated_at=utc_now(),
        # A new config invalidates any previous build until Build runs again.
        build_dir=None,
        built_at=None,
    )
    project.ai_game = ai_game
    gamelab_service.save_game(project)

    return {"ok": True, "parse_error": False,
            "ai_game": ai_game.model_dump(),
            "errors": errors, "warnings": preflight + model_warnings,
            "notes": notes, "release": release,
            "status": resource_manager.status}


def apply_edited_config(game_id: str, config_obj: dict) -> dict:
    """Store a manually edited config (the preview area is minimally editable
    before build). Revalidates against the stored template's schema."""
    project = gamelab_service.load_game(game_id)
    if project.ai_game is None or not project.ai_game.template_id:
        raise GameLabError("Generate a configuration first (no template selected yet).")
    if not isinstance(config_obj, dict):
        raise GameLabError("The edited configuration must be a JSON object.")
    template = gamelab_template_service.load_template(project.ai_game.template_id)
    schema = gamelab_template_service.load_schema(template)
    errors = validate_config(config_obj, schema)
    project.ai_game.config = config_obj
    project.ai_game.schema_valid = not errors
    project.ai_game.build_dir = None
    project.ai_game.built_at = None
    gamelab_service.save_game(project)
    return {"ok": True, "ai_game": project.ai_game.model_dump(), "errors": errors}


# --------------------------------------------------------------------------- #
# Build / export (locked runtime + validated config -> standalone build)
# --------------------------------------------------------------------------- #
_INLINE_CONFIG_ID_RE = re.compile(r'getElementById\(["\']([\w-]*config)["\']\)')


def _inject_inline_config(index_html: str, config_obj: dict) -> str:
    """Embed the config inline when the template runtime looks for an inline
    <script type="application/json" id="...config"> block, so the exported
    build also works from file:// where fetch() is blocked. The id is read
    from the runtime's own code — nothing is guessed or rewritten."""
    match = _INLINE_CONFIG_ID_RE.search(index_html)
    if not match:
        return index_html
    inline_id = match.group(1)
    # Escape "<" so config strings can never close the script tag early.
    embedded = json.dumps(config_obj, ensure_ascii=False).replace("<", "\\u003c")
    tag = f'<script type="application/json" id="{inline_id}">{embedded}</script>\n  '
    idx = index_html.find("<script src=")
    if idx == -1:
        return index_html
    return index_html[:idx] + tag + index_html[idx:]


def build_game(game_id: str) -> dict:
    """Build the standalone browser game: template runtime copied VERBATIM plus
    the validated game config (and template assets, if any). Test Play serves
    this exact folder and Export points the user at it — one honest build."""
    project = gamelab_service.load_game(game_id)
    ai = project.ai_game
    if ai is None or not isinstance(ai.config, dict):
        raise GameLabError("Generate a game configuration first.")
    if not ai.schema_valid:
        raise GameLabError("The configuration is not schema-valid. Fix validation errors "
                           "before building.")
    template = gamelab_template_service.load_template(ai.template_id)
    # Revalidate at build time so a schema change since generation is caught.
    errors = validate_config(ai.config, gamelab_template_service.load_schema(template))
    if errors:
        raise GameLabError("Build blocked — the stored config no longer validates:\n- "
                           + "\n- ".join(errors[:10]))

    slug = gamelab_service.slugify(ai.config.get("title") or project.title)
    out_name = f"{slug}_{ai.template_id}_web"
    out_dir = (gamelab_service.game_dir(game_id) / "exports" / out_name).resolve()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    entry = gamelab_template_service.entry_file(template)
    for src in gamelab_template_service.runtime_files(template):
        dst = out_dir / src.name  # runtime files reference each other as siblings
        if src == entry:
            html = _inject_inline_config(src.read_text(encoding="utf-8"), ai.config)
            dst.write_text(html, encoding="utf-8")
        else:
            shutil.copy2(src, dst)  # locked runtime — copied byte-for-byte
        copied.append(src.name)
    entry_name = entry.name
    if entry_name != "index.html" and not (out_dir / "index.html").exists():
        shutil.copy2(out_dir / entry_name, out_dir / "index.html")

    cfg_name = gamelab_template_service.config_filename(template)
    (out_dir / cfg_name).write_text(
        json.dumps(ai.config, indent=2, ensure_ascii=False), encoding="utf-8")

    assets = gamelab_template_service.assets_dir(template)
    asset_count = 0
    if assets is not None:
        for f in assets.rglob("*"):
            if not f.is_file() or f.suffix.lower() == ".md":
                continue
            dst = out_dir / "assets" / f.relative_to(assets)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
            asset_count += 1

    ai.build_dir = f"exports/{out_name}"
    ai.built_at = utc_now()
    gamelab_service.save_game(project)
    logger.info("GameLab AI game built '%s' -> %s", project.title, out_dir)
    return {
        "ok": True,
        "export_dir": out_name,
        "files": copied + [cfg_name],
        "asset_count": asset_count,
        "play_url": f"/media/gamelab/{game_id}/ai-build/{build_token(ai)}/index.html",
        "ai_game": ai.model_dump(),
        "note": "Standalone build — open index.html in a browser, or serve the folder "
                "with any static web server. No FastAPI/Python/Node needed after export.",
    }


def build_token(ai: AIGameData) -> str:
    """Cache-partitioning URL segment for Test Play — unique per build, so the
    browser can never mix a cached runtime from an earlier build (possibly a
    different template) into the current one. Purely a namespace: the serving
    route always resolves the CURRENT build."""
    return re.sub(r"\D", "", ai.built_at or "") or "0"


def resolve_build_file(game_id: str, rel_path: str):
    """Resolve a file inside the current AI build for Test Play serving,
    refusing traversal outside the build folder."""
    project = gamelab_service.load_game(game_id)
    ai = project.ai_game
    if ai is None or not ai.build_dir:
        raise GameLabError("No AI game build exists yet. Build the game first.")
    parts = [p for p in str(ai.build_dir).replace("\\", "/").split("/") if p]
    if len(parts) != 2 or parts[0] != "exports" or ".." in parts:
        raise GameLabError("Invalid build folder reference.")
    base = (gamelab_service.game_dir(game_id) / parts[0] / parts[1]).resolve()
    rel = str(rel_path or "index.html").replace("\\", "/")
    if rel.startswith("/") or ".." in rel.split("/"):
        raise GameLabError("Invalid build file path.")
    path = (base / rel).resolve()
    if base != path and base not in path.parents:
        raise GameLabError("Invalid build file path.")
    if not path.exists() or not path.is_file():
        raise GameLabError(f"Build file '{rel}' was not found.")
    return path
