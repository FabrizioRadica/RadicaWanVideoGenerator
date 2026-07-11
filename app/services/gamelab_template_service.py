"""GameLab template repository discovery (PATCH_GameLabPromptToGameConfig_v1).

Scans the immediate child folders of GAMELAB_TEMPLATES_ROOT (default
``gamelab_templates/``) at request time and detects valid template packages by
the presence of a readable ``template.json``. No template id is ever hardcoded:
the repository on disk is the single source of truth. Folders without a valid
``template.json`` are reported as invalid (with a reason) but never crash
discovery. The template runtime is locked — this service only READS from the
repository; nothing here ever writes into it.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.config import logger, settings

TEMPLATE_META_FILE = "template.json"


class GameLabTemplateError(Exception):
    """Raised for template repository failures with a user-readable message."""


def templates_root() -> Path:
    return settings.gamelab_templates_root.resolve()


def _relative_file(tdir: Path, rel: str, label: str) -> Path:
    """Resolve a file referenced by template.json, refusing traversal outside
    the template folder."""
    rel = str(rel or "").replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        raise GameLabTemplateError(f"Template {label} path is invalid: '{rel}'.")
    path = (tdir / rel).resolve()
    if tdir.resolve() not in path.parents:
        raise GameLabTemplateError(f"Template {label} path escapes the template folder.")
    return path


def _read_meta(tdir: Path) -> dict:
    meta_file = tdir / TEMPLATE_META_FILE
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GameLabTemplateError(f"template.json is unreadable: {exc}") from exc
    if not isinstance(meta, dict):
        raise GameLabTemplateError("template.json must contain a JSON object.")
    return meta


def _summary(tdir: Path, meta: dict) -> dict:
    """UI-facing summary derived from template.json metadata. Missing optional
    metadata gets a safe fallback label — never invented capabilities."""
    template_id = str(meta.get("template_id") or tdir.name)
    return {
        "template_id": template_id,
        "name": str(meta.get("name") or meta.get("display_name") or template_id),
        "description": str(meta.get("description") or ""),
        "engine": str(meta.get("engine") or "unknown"),
        "version": str(meta.get("version") or ""),
        "capabilities": [str(c) for c in meta.get("capabilities") or []],
        "constraints": [str(c) for c in meta.get("constraints") or []],
        "has_examples": bool(meta.get("examples")),
    }


def _validate_package(tdir: Path, meta: dict) -> None:
    """Reject incomplete packages with a clear reason (missing schema/runtime)."""
    template_id = str(meta.get("template_id") or "").strip()
    if not template_id:
        raise GameLabTemplateError("template.json has no template_id.")
    schema_rel = str(meta.get("schema") or "schema.json")
    if not _relative_file(tdir, schema_rel, "schema").exists():
        raise GameLabTemplateError(f"Schema file '{schema_rel}' is missing.")
    entry_rel = str(meta.get("entry") or "runtime/index.html")
    if not _relative_file(tdir, entry_rel, "entry").exists():
        raise GameLabTemplateError(f"Runtime entry '{entry_rel}' is missing.")
    for rel in meta.get("runtime_files") or []:
        if not _relative_file(tdir, str(rel), "runtime").exists():
            raise GameLabTemplateError(f"Runtime file '{rel}' is missing.")


def discover_templates() -> dict:
    """Scan the repository. Returns {"templates": [...], "invalid": [...]} where
    invalid entries carry the folder name and a readable reason. One malformed
    template never breaks discovery of the others."""
    root = templates_root()
    templates: list[dict] = []
    invalid: list[dict] = []
    if not root.exists():
        logger.warning("GameLab template repository not found: %s", root)
        return {"templates": [], "invalid": [],
                "error": f"Template repository folder '{root.name}' was not found."}
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        if not (child / TEMPLATE_META_FILE).exists():
            continue  # not a template package (e.g. docs folder) — silently skip
        try:
            meta = _read_meta(child)
            _validate_package(child, meta)
            templates.append(_summary(child, meta))
        except GameLabTemplateError as exc:
            invalid.append({"folder": child.name, "reason": str(exc)})
            logger.warning("GameLab template '%s' skipped: %s", child.name, exc)
    return {"templates": templates, "invalid": invalid}


def _find_template_dir(template_id: str) -> Path:
    """Locate the folder whose template.json declares this template_id."""
    template_id = (template_id or "").strip()
    if not template_id:
        raise GameLabTemplateError("No template selected.")
    root = templates_root()
    if not root.exists():
        raise GameLabTemplateError("Template repository folder was not found.")
    for child in sorted(root.iterdir()):
        if not (child.is_dir() and (child / TEMPLATE_META_FILE).exists()):
            continue
        try:
            meta = _read_meta(child)
        except GameLabTemplateError:
            continue
        if str(meta.get("template_id") or "").strip() == template_id:
            return child
    raise GameLabTemplateError(f"Template '{template_id}' was not found in the repository.")


def load_template(template_id: str) -> dict:
    """Full template package info: metadata + resolved folder + schema path.
    Validates completeness so callers can rely on the referenced files."""
    tdir = _find_template_dir(template_id)
    meta = _read_meta(tdir)
    _validate_package(tdir, meta)
    return {"dir": tdir, "meta": meta, "summary": _summary(tdir, meta)}


def load_schema(template: dict) -> dict:
    """The template's JSON Schema (draft-07) as a dict."""
    tdir, meta = template["dir"], template["meta"]
    schema_path = _relative_file(tdir, str(meta.get("schema") or "schema.json"), "schema")
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GameLabTemplateError(f"Template schema is unreadable: {exc}") from exc
    if not isinstance(schema, dict):
        raise GameLabTemplateError("Template schema must be a JSON object.")
    return schema


def load_generation_rules(template: dict) -> str:
    """The template's generation_rules.md content ('' when absent)."""
    path = template["dir"] / "generation_rules.md"
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not read generation rules for %s: %s", template["dir"].name, exc)
        return ""


def runtime_files(template: dict) -> list[Path]:
    """Absolute paths of the locked runtime files to copy verbatim at build."""
    tdir, meta = template["dir"], template["meta"]
    rels = meta.get("runtime_files") or [str(meta.get("entry") or "runtime/index.html")]
    return [_relative_file(tdir, str(rel), "runtime") for rel in rels]


def entry_file(template: dict) -> Path:
    tdir, meta = template["dir"], template["meta"]
    return _relative_file(tdir, str(meta.get("entry") or "runtime/index.html"), "entry")


def config_filename(template: dict) -> str:
    name = Path(str(template["meta"].get("config_filename") or "game_config.json")).name
    return name or "game_config.json"


def assets_dir(template: dict) -> Path | None:
    path = template["dir"] / "assets"
    return path if path.is_dir() else None
