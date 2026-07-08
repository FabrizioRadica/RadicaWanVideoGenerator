"""Project-local Prompt Library storage + service (PATCH_ProjectPromptLibrary).

JSON files under `<app root>/prompts/` are the source of truth; `index.json` is
a rebuildable cache. This module owns storage, CRUD, trash, import/export,
search and demo seeding, plus THIN integrations that reuse the existing
SequenceQueue model/service and Single Clip fields — it never duplicates them
(patch §1.1).

Everything is defensive: malformed JSON files are skipped and logged, never
fatal; the library never crashes the app.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
import uuid
from pathlib import Path

from app.config import BASE_DIR, logger
from app.models.prompt_library_models import (
    MODEL_FOR_TYPE,
    SEQUENCE_PRESET_SCHEMA,
    SHARED_NEGATIVE_SCHEMA,
    SINGLE_CLIP_SCHEMA,
    TYPE_DIRS,
    PromptLibraryIndex,
    PromptLibraryIndexItem,
    SequencePreset,
    SequencePresetClip,
    SingleClipPrompt,
    now_iso,
)

SCHEMA_FOR_TYPE = {
    "single_clip_prompt": SINGLE_CLIP_SCHEMA,
    "sequence_preset": SEQUENCE_PRESET_SCHEMA,
    "shared_negative_prompt": SHARED_NEGATIVE_SCHEMA,
}

LIBRARY_ROOT = BASE_DIR / "prompts"
INDEX_FILE = LIBRARY_ROOT / "index.json"

_LOCK = threading.RLock()
_demo_seeded = False


class PromptLibraryError(Exception):
    """User-readable prompt library failure."""


# --------------------------------------------------------------------------
# Paths / layout
# --------------------------------------------------------------------------

def _type_dir(item_type: str, trashed: bool = False) -> Path:
    sub = TYPE_DIRS.get(item_type)
    if not sub:
        raise PromptLibraryError(f"Unknown prompt type: {item_type}")
    return (LIBRARY_ROOT / "trash" / sub) if trashed else (LIBRARY_ROOT / sub)


def ensure_layout() -> None:
    for sub in TYPE_DIRS.values():
        (LIBRARY_ROOT / sub).mkdir(parents=True, exist_ok=True)
        (LIBRARY_ROOT / "trash" / sub).mkdir(parents=True, exist_ok=True)


def ensure_ready() -> None:
    """Create the folder layout and seed demo assets once per process."""
    global _demo_seeded
    with _LOCK:
        ensure_layout()
        if not _demo_seeded:
            try:
                _seed_demo_assets()
            except Exception as exc:  # noqa: BLE001 — seeding must never break the app
                logger.warning("Prompt library demo seeding failed (non-fatal): %s", exc)
            _demo_seeded = True


def _slug(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return (cleaned or "prompt")[:60]


def _unique_path(directory: Path, slug: str, existing: Path | None = None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{slug}.json"
    if candidate == existing:
        return candidate
    counter = 1
    while candidate.exists():
        counter += 1
        candidate = directory / f"{slug}_{counter}.json"
    return candidate


def _safe_within(path: Path) -> Path:
    root = LIBRARY_ROOT.resolve()
    p = path.resolve()
    if root not in p.parents and p != root:
        raise PromptLibraryError("Refused a path outside the prompt library.")
    return p


# --------------------------------------------------------------------------
# Low-level read/write
# --------------------------------------------------------------------------

def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("Prompt library: skipping malformed file %s: %s", path, exc)
        return None


def _write_json(path: Path, data: dict) -> None:
    _safe_within(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _validate(data: dict) -> tuple[str, dict]:
    """Validate a prompt asset dict; returns (type, normalized_dict). Raises
    PromptLibraryError for anything the library cannot load (patch §15)."""
    if not isinstance(data, dict):
        raise PromptLibraryError("Prompt file is not a JSON object.")
    item_type = data.get("type")
    model = MODEL_FOR_TYPE.get(item_type)
    if model is None:
        raise PromptLibraryError(f"Unrecognized prompt type: {item_type!r}.")
    if not data.get("schema_version"):
        raise PromptLibraryError("Missing schema_version.")
    try:
        obj = model.model_validate(data)
    except ValueError as exc:
        raise PromptLibraryError(f"Invalid {item_type}: {exc}") from exc
    if item_type == "sequence_preset":
        if not obj.clips:
            raise PromptLibraryError("Sequence preset has no clips.")
        for c in obj.clips:
            if not (c.clip_name or "").strip() or not (c.positive_prompt or "").strip():
                raise PromptLibraryError("Every sequence clip needs a name and a positive prompt.")
    return item_type, obj.model_dump(mode="json")


# --------------------------------------------------------------------------
# Locate assets by id
# --------------------------------------------------------------------------

def _iter_files(include_trash: bool = True):
    ensure_layout()
    for item_type, sub in TYPE_DIRS.items():
        for path in sorted((LIBRARY_ROOT / sub).glob("*.json")):
            yield path, item_type, False
        if include_trash:
            for path in sorted((LIBRARY_ROOT / "trash" / sub).glob("*.json")):
                yield path, item_type, True


def _find(item_id: str, include_trash: bool = True):
    for path, item_type, trashed in _iter_files(include_trash):
        data = _read_json(path)
        if data and data.get("id") == item_id:
            return path, item_type, trashed, data
    return None


def _require(item_id: str, include_trash: bool = True):
    found = _find(item_id, include_trash)
    if not found:
        raise PromptLibraryError(f"Prompt asset '{item_id}' not found.")
    return found


# --------------------------------------------------------------------------
# CRUD
# --------------------------------------------------------------------------

def save(data: dict) -> dict:
    """Create a NEW prompt asset from `data` (assigns id/timestamps)."""
    with _LOCK:
        ensure_ready()
        payload = dict(data)
        payload["id"] = payload.get("id") or uuid.uuid4().hex
        if not payload.get("schema_version"):
            payload["schema_version"] = SCHEMA_FOR_TYPE.get(payload.get("type"), "")
        payload.setdefault("created_at", now_iso())
        payload["updated_at"] = now_iso()
        item_type, normalized = _validate(payload)
        path = _unique_path(_type_dir(item_type), _slug(normalized.get("name", "prompt")))
        _write_json(path, normalized)
        _rebuild_index()
        logger.info("Prompt library: saved %s '%s' -> %s", item_type,
                    normalized.get("name"), path.name)
        return {"item": normalized, "path": _rel(path)}


def load(item_id: str) -> dict:
    _, _, _, data = _require(item_id)
    return data


def update(item_id: str, changes: dict) -> dict:
    with _LOCK:
        path, item_type, trashed, data = _require(item_id, include_trash=False)
        merged = {**data, **{k: v for k, v in (changes or {}).items()
                             if k not in ("id", "type", "schema_version", "created_at")}}
        merged["id"] = data["id"]
        merged["type"] = item_type
        merged["updated_at"] = now_iso()
        _, normalized = _validate(merged)
        # Rename the file if the name changed.
        new_path = path
        if _slug(normalized.get("name", "")) != path.stem.rsplit("_", 1)[0] and \
                _slug(normalized.get("name", "")) != path.stem:
            new_path = _unique_path(_type_dir(item_type), _slug(normalized["name"]), existing=path)
        _write_json(new_path, normalized)
        if new_path != path and path.exists():
            path.unlink()
        _rebuild_index()
        return {"item": normalized, "path": _rel(new_path)}


def duplicate(item_id: str) -> dict:
    with _LOCK:
        _, item_type, _, data = _require(item_id, include_trash=False)
        copy = dict(data)
        copy["id"] = uuid.uuid4().hex
        copy["name"] = f"{data.get('name', 'Prompt')} Copy"
        copy["created_at"] = now_iso()
        copy["updated_at"] = now_iso()
        _, normalized = _validate(copy)
        path = _unique_path(_type_dir(item_type), _slug(normalized["name"]))
        _write_json(path, normalized)
        _rebuild_index()
        return {"item": normalized, "path": _rel(path)}


def rename(item_id: str, new_name: str) -> dict:
    if not (new_name or "").strip():
        raise PromptLibraryError("New name is required.")
    return update(item_id, {"name": new_name.strip()})


def soft_delete(item_id: str) -> dict:
    with _LOCK:
        path, item_type, trashed, data = _require(item_id, include_trash=False)
        dest = _unique_path(_type_dir(item_type, trashed=True), path.stem)
        shutil.move(str(path), str(dest))
        _rebuild_index()
        logger.info("Prompt library: trashed %s '%s'", item_type, data.get("name"))
        return {"deleted": True, "id": item_id, "trash_path": _rel(dest)}


def restore(item_id: str) -> dict:
    with _LOCK:
        found = _find(item_id, include_trash=True)
        if not found:
            raise PromptLibraryError(f"Prompt asset '{item_id}' not found.")
        path, item_type, trashed, data = found
        if not trashed:
            return {"restored": False, "id": item_id, "message": "Item is not in trash."}
        dest = _unique_path(_type_dir(item_type, trashed=False), path.stem)
        shutil.move(str(path), str(dest))
        _rebuild_index()
        logger.info("Prompt library: restored %s '%s'", item_type, data.get("name"))
        return {"restored": True, "id": item_id, "path": _rel(dest)}


def permanent_delete(item_id: str) -> dict:
    with _LOCK:
        found = _find(item_id, include_trash=True)
        if not found:
            raise PromptLibraryError(f"Prompt asset '{item_id}' not found.")
        path, _, trashed, _ = found
        if not trashed:
            raise PromptLibraryError("Only items in trash can be permanently deleted. Delete it first.")
        path.unlink(missing_ok=True)
        _rebuild_index()
        return {"deleted": True, "id": item_id}


def empty_trash() -> dict:
    with _LOCK:
        removed = 0
        for sub in TYPE_DIRS.values():
            tdir = LIBRARY_ROOT / "trash" / sub
            for path in tdir.glob("*.json"):
                path.unlink(missing_ok=True)
                removed += 1
        _rebuild_index()
        return {"emptied": True, "removed": removed}


# --------------------------------------------------------------------------
# List / search / index
# --------------------------------------------------------------------------

def _preview(item_type: str, data: dict) -> str:
    if item_type == "sequence_preset":
        return f"{len(data.get('clips', []))} clips · " + (data.get("clips", [{}])[0].get("positive_prompt", "") if data.get("clips") else "")
    if item_type == "shared_negative_prompt":
        return data.get("negative_prompt", "")
    return data.get("positive_prompt", "")


def _index_item(path: Path, item_type: str, trashed: bool, data: dict) -> PromptLibraryIndexItem:
    return PromptLibraryIndexItem(
        id=data.get("id", ""),
        type=item_type,
        name=data.get("name", ""),
        path=_rel(path),
        tags=data.get("tags", []) or [],
        source=data.get("source", "manual"),
        updated_at=data.get("updated_at", ""),
        preview=(_preview(item_type, data) or "")[:200],
        trashed=trashed,
    )


def _rebuild_index() -> PromptLibraryIndex:
    items: list[PromptLibraryIndexItem] = []
    for path, item_type, trashed in _iter_files(include_trash=True):
        data = _read_json(path)
        if not data or not data.get("id"):
            continue
        items.append(_index_item(path, item_type, trashed, data))
    idx = PromptLibraryIndex(items=items, updated_at=now_iso())
    try:
        _write_json(INDEX_FILE, idx.model_dump(mode="json", by_alias=True))
    except Exception as exc:  # noqa: BLE001 — index is a cache; failure is non-fatal
        logger.warning("Prompt library: could not write index.json: %s", exc)
    return idx


def rebuild_index() -> dict:
    with _LOCK:
        ensure_ready()
        idx = _rebuild_index()
        return {"rebuilt": True, "count": len(idx.items)}


def list_items(type_filter: str = "all", query: str = "", include_trash: bool = False) -> list[dict]:
    """List assets (patch §6.2). `type_filter`: all | single_clip_prompt |
    sequence_preset | shared_negative_prompt | trash. Search covers name, tags,
    prompts, notes, source, mode, type."""
    ensure_ready()
    want_trash = (type_filter == "trash") or include_trash
    q = (query or "").strip().lower()
    out: list[dict] = []
    for path, item_type, trashed in _iter_files(include_trash=True):
        if trashed and not want_trash:
            continue
        if not trashed and type_filter == "trash":
            continue
        if type_filter not in ("all", "trash") and item_type != type_filter:
            continue
        data = _read_json(path)
        if not data or not data.get("id"):
            continue
        if q:
            haystack = " ".join(str(x) for x in [
                data.get("name", ""), " ".join(data.get("tags", []) or []),
                data.get("positive_prompt", ""), data.get("negative_prompt", ""),
                data.get("shared_negative_prompt", ""), data.get("notes", ""),
                data.get("source", ""), data.get("mode", ""), item_type,
                " ".join(c.get("positive_prompt", "") for c in data.get("clips", []) or []),
            ]).lower()
            if q not in haystack:
                continue
        out.append(_index_item(path, item_type, trashed, data).model_dump(mode="json"))
    out.sort(key=lambda i: i.get("updated_at", ""), reverse=True)
    return out


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(BASE_DIR.resolve()).as_posix()
    except ValueError:
        return path.name


# --------------------------------------------------------------------------
# Import / export
# --------------------------------------------------------------------------

def import_asset(data: dict) -> dict:
    """Validate an imported asset and copy it into the correct project-local
    folder with a fresh id + unique filename (patch §10)."""
    if not isinstance(data, dict):
        raise PromptLibraryError("Imported file is not a JSON object.")
    payload = dict(data)
    payload["id"] = uuid.uuid4().hex           # avoid id collisions on import
    if not payload.get("schema_version"):
        payload["schema_version"] = SCHEMA_FOR_TYPE.get(payload.get("type"), "")
    payload.setdefault("source", "imported")
    payload.setdefault("created_at", now_iso())
    payload["updated_at"] = now_iso()
    return save(payload)


def export_path(item_id: str) -> Path:
    path, _, _, _ = _require(item_id)
    return path


# --------------------------------------------------------------------------
# Integrations (reuse existing SequenceQueue model/service — patch §7/§8)
# --------------------------------------------------------------------------

def preset_from_sequence(sequence_id: str, name: str = "") -> dict:
    """Build a Sequence Preset from a live VideoSequence (patch §8 'Save Current
    Queue as Sequence Preset') and save it to the library."""
    from app.services import sequence_service
    from app.services.sequence_service import SequenceError
    try:
        seq = sequence_service.load_sequence(sequence_id)
    except SequenceError as exc:
        raise PromptLibraryError(str(exc)) from exc

    preset = SequencePreset(
        name=(name or seq.name or "Sequence Preset").strip(),
        tags=[],
        shared_negative_prompt=seq.global_generation_settings.negative_prompt or "",
        sequence_settings=seq.global_generation_settings.model_dump(mode="json"),
        clips=[SequencePresetClip(
            index=i,
            clip_name=c.name,
            clip_type=c.type.value,
            duration=round(_frames_to_seconds(c, seq), 2),
            positive_prompt=c.prompt,
            negative_prompt=c.negative_prompt,
            generation_overrides=c.generation_overrides.model_dump(mode="json"),
            color_look_mode=c.color_look_mode.value,
            custom_color_look=c.custom_color_look.model_dump(mode="json"),
            project_relative_image=(c.source_image or None),
            continuity_notes="",
            ai_notes=(c.diagnostics or {}).get("ai_notes", "") if c.diagnostics else "",
        ) for i, c in enumerate(seq.clips)],
        source="sequence",
    )
    if not preset.clips:
        raise PromptLibraryError("The sequence has no clips to save as a preset.")
    return save(preset.model_dump(mode="json"))


def _frames_to_seconds(clip, seq) -> float:
    frames = clip.generation_overrides.frames or seq.global_generation_settings.frames
    fps = seq.global_generation_settings.fps or 16
    return frames / fps if fps else 4.0


def apply_preset_to_sequence(preset_id: str, sequence_id: str, mode: str = "append") -> dict:
    """Append or replace a sequence's clips from a preset, using the existing
    sequence model + service (patch §8). Never renders; refuses while rendering."""
    from app.models.sequence_models import ClipGenerationOverrides, ClipType, ColorLookMode, SequenceClip
    from app.models.project_models import VideoEffects
    from app.services import sequence_service
    from app.services.sequence_service import SequenceError
    from app.services.sequence_queue_service import queue_manager

    if mode not in ("append", "replace"):
        raise PromptLibraryError("Mode must be 'append' or 'replace'.")
    _, item_type, _, data = _require(preset_id, include_trash=False)
    if item_type != "sequence_preset":
        raise PromptLibraryError("Selected asset is not a sequence preset.")
    if queue_manager.is_running(sequence_id):
        raise PromptLibraryError("The sequence is currently rendering. Wait for it to finish.")

    try:
        seq = sequence_service.load_sequence(sequence_id)
    except SequenceError as exc:
        raise PromptLibraryError(str(exc)) from exc

    preset = SequencePreset.model_validate(data)
    if mode == "replace":
        seq.clips = []
    start = len(seq.clips)
    added: list[str] = []
    warnings: list[str] = []
    for i, pc in enumerate(preset.clips):
        try:
            ctype = ClipType(pc.clip_type)
        except ValueError:
            ctype = ClipType.PROMPT_ONLY
            warnings.append(f"Clip '{pc.clip_name}': unknown type '{pc.clip_type}', used prompt_only.")
        negative = (pc.negative_prompt or "").strip() or (preset.shared_negative_prompt or "").strip()
        try:
            overrides = ClipGenerationOverrides.model_validate(pc.generation_overrides or {})
        except ValueError:
            overrides = ClipGenerationOverrides()
        try:
            look = VideoEffects.model_validate(pc.custom_color_look or {}) if pc.custom_color_look else VideoEffects()
        except ValueError:
            look = VideoEffects()
        try:
            look_mode = ColorLookMode(pc.color_look_mode)
        except ValueError:
            look_mode = ColorLookMode.GLOBAL
        clip = SequenceClip(
            clip_id=uuid.uuid4().hex[:10],
            index=start + i,
            name=(pc.clip_name or f"Clip {start + i + 1:02d}").strip()[:120],
            type=ctype,
            prompt=(pc.positive_prompt or "").strip(),
            negative_prompt=negative,
            use_global_generation_settings=not bool(pc.generation_overrides),
            generation_overrides=overrides,
            color_look_mode=look_mode,
            custom_color_look=look,
        )
        if ctype == ClipType.IMAGE_REFERENCE:
            warnings.append(f"'{clip.name}' is an Image2Video clip — add a source image before rendering.")
        seq.clips.append(clip)
        added.append(clip.clip_id)

    seq.reindex()
    sequence_service.save_sequence(seq)
    logger.info("Prompt library: applied preset '%s' to sequence '%s' (%s, +%d clips)",
                preset.name, seq.sequence_id, mode, len(added))
    return {"sequence_id": seq.sequence_id, "mode": mode, "added": len(added),
            "clip_ids": added, "total_clips": len(seq.clips), "notes": warnings}


def single_clip_from_sequence_clip(sequence_id: str, clip_id: str, name: str = "") -> dict:
    """Save a SequenceQueue clip's prompt as a Single Clip prompt asset (§8)."""
    from app.services import sequence_service
    from app.services.sequence_service import SequenceError
    try:
        seq = sequence_service.load_sequence(sequence_id)
    except SequenceError as exc:
        raise PromptLibraryError(str(exc)) from exc
    clip = seq.get_clip(clip_id)
    if clip is None:
        raise PromptLibraryError(f"Clip '{clip_id}' not found.")
    asset = SingleClipPrompt(
        name=(name or clip.name or "Clip Prompt").strip(),
        positive_prompt=clip.prompt,
        negative_prompt=clip.negative_prompt or seq.global_generation_settings.negative_prompt,
        mode="image2video" if clip.type.value == "image_reference" else "text2video",
        source="sequence",
    )
    return save(asset.model_dump(mode="json"))


def apply_shared_negative_to_sequence(negative_id: str, sequence_id: str) -> dict:
    """Apply a shared negative prompt to every clip in a sequence via the
    existing update_clip service (patch §8)."""
    from app.services import sequence_service
    from app.services.sequence_service import SequenceError
    from app.services.sequence_queue_service import queue_manager

    _, item_type, _, data = _require(negative_id, include_trash=False)
    if item_type != "shared_negative_prompt":
        raise PromptLibraryError("Selected asset is not a shared negative prompt.")
    if queue_manager.is_running(sequence_id):
        raise PromptLibraryError("The sequence is currently rendering. Wait for it to finish.")
    negative = data.get("negative_prompt", "")
    try:
        seq = sequence_service.load_sequence(sequence_id)
    except SequenceError as exc:
        raise PromptLibraryError(str(exc)) from exc
    count = 0
    for clip in list(seq.clips):
        sequence_service.update_clip(sequence_id, clip.clip_id, {"negative_prompt": negative})
        count += 1
    return {"sequence_id": sequence_id, "updated_clips": count}


# --------------------------------------------------------------------------
# Demo assets (patch §13/§14) — created only if missing
# --------------------------------------------------------------------------

def _write_demo(item_type: str, filename: str, model_dict: dict) -> None:
    path = _type_dir(item_type) / filename
    if path.exists():
        return  # never overwrite user-modified demo files
    if not model_dict.get("id"):
        model_dict["id"] = uuid.uuid4().hex
    if not model_dict.get("schema_version"):
        model_dict["schema_version"] = SCHEMA_FOR_TYPE.get(item_type, "")
    model_dict.setdefault("created_at", now_iso())
    model_dict.setdefault("updated_at", now_iso())
    model_dict["source"] = "demo"
    try:
        _, normalized = _validate(model_dict)
        _write_json(path, normalized)
    except PromptLibraryError as exc:
        logger.warning("Prompt library: demo asset %s invalid: %s", filename, exc)


def _demo_sequence(name: str, negative: str, base_positive: str, clip_names: list[str]) -> dict:
    clips = []
    for i, cn in enumerate(clip_names):
        shot = cn.split("-", 1)[-1].strip() if "-" in cn else cn
        clips.append(SequencePresetClip(
            index=i, clip_name=cn, clip_type="prompt_only", duration=4.0,
            positive_prompt=f"{base_positive} Shot: {shot}.",
            negative_prompt="", color_look_mode="global",
        ).model_dump(mode="json"))
    return SequencePreset(name=name, shared_negative_prompt=negative,
                          clips=[SequencePresetClip.model_validate(c) for c in clips],
                          tags=[], source="demo").model_dump(mode="json")


def _seed_demo_assets() -> None:
    demos = [
        ("demo_beach_sunset_model", "Beach Sunset Model", "text2video",
         "A cinematic realistic video of an elegant woman walking slowly on the shoreline at sunset. "
         "Warm orange and pink sky, soft reflections on the wet sand, gentle sea waves, subtle wind moving "
         "her hair and dress, shallow depth of field, smooth tracking shot, realistic skin texture, emotional peaceful mood.",
         "bad anatomy, deformed body, distorted legs, broken legs, extra limbs, missing fingers, malformed hands, "
         "twisted feet, unnatural walking, sliding feet, floating body, unstable body, body jitter, face distortion, "
         "changing face, melting face, asymmetrical face, crossed eyes, bad eyes, blinking artifacts, unnatural smile, "
         "plastic skin, doll face, uncanny valley, low quality, blurry, noisy, pixelated, text, watermark, logo.",
         ["beach", "sunset", "cinematic"],
         "demo_beach_sunset_model_sequence", "Beach Sunset Model Sequence",
         ["Clip 01 - Establishing Beach", "Clip 02 - Walking on Shoreline", "Clip 03 - Looking at the Sky",
          "Clip 04 - Slow Turn", "Clip 05 - Close-up Smile"]),
        ("demo_cyberpunk_alley_chase", "Cyberpunk Alley Chase", "text2video",
         "A cinematic cyberpunk night scene in a narrow neon-lit alley. A young rebel wearing a red jacket runs "
         "through wet streets, reflections of purple and blue signs on the asphalt, dramatic handheld camera, fast "
         "but readable motion, rain particles, steam from vents, intense atmosphere, anime-inspired cinematic realism.",
         "bad anatomy, distorted limbs, broken arms, extra legs, unstable running, sliding feet, warped perspective, "
         "unreadable motion, excessive blur, flickering lights, identity drift, face deformation, duplicated character, "
         "broken hands, low quality, noisy, pixelated, text, watermark, logo, frame.",
         ["cyberpunk", "chase", "neon"],
         "demo_cyberpunk_alley_chase_sequence", "Cyberpunk Alley Chase Sequence",
         ["Clip 01 - Neon Alley Establishing Shot", "Clip 02 - Rebel Starts Running",
          "Clip 03 - Camera Follows from Behind", "Clip 04 - Drone Searchlight Appears",
          "Clip 05 - Escape into Side Street"]),
        ("demo_product_showcase", "Product Showcase", "text2video",
         "A premium cinematic product showcase of a modern black wireless headphone resting on a matte table. "
         "Slow rotating camera movement, soft studio lighting, elegant reflections, shallow depth of field, clean "
         "background, luxury advertising style, high detail, realistic materials.",
         "deformed product, warped geometry, melting plastic, unstable shape, incorrect reflections, noisy image, "
         "low quality, blurry edges, flickering, distorted logo, unwanted text, watermark, duplicated objects, "
         "unrealistic materials, broken symmetry, camera jump.",
         ["product", "advertising", "studio"],
         "demo_product_showcase_sequence", "Product Showcase Sequence",
         ["Clip 01 - Product Hero Shot", "Clip 02 - Slow Detail Pan", "Clip 03 - Material Close-up",
          "Clip 04 - Rotating Beauty Shot", "Clip 05 - Final Advertising Frame"]),
        ("demo_fantasy_dungeon_hero", "Fantasy Dungeon Hero", "text2video",
         "A cinematic fantasy dungeon scene viewed from a slightly elevated angle. A brave hero with a sword walks "
         "through an ancient stone corridor lit by torches, soft smoke in the air, warm firelight, dark atmospheric "
         "shadows, dramatic adventure mood, detailed medieval environment.",
         "bad anatomy, distorted sword, broken arms, extra limbs, malformed hands, unstable walking, sliding feet, "
         "warped dungeon walls, flickering torch artifacts, unreadable motion, low quality, blurry, noisy, pixelated, "
         "text, watermark, logo, frame, cartoonish distortion.",
         ["fantasy", "dungeon", "hero"],
         "demo_fantasy_dungeon_hero_sequence", "Fantasy Dungeon Hero Sequence",
         ["Clip 01 - Dungeon Entrance", "Clip 02 - Hero Walks Forward", "Clip 03 - Torchlight Reveal",
          "Clip 04 - Enemy Shadow Appears", "Clip 05 - Hero Raises Sword"]),
        ("demo_chihuahua_parrot_garden", "Chihuahua and Parrot Microfilm", "text2video",
         "A heartwarming cinematic shot of a small fluffy chihuahua playing gently in a sun-drenched garden while a "
         "colorful parrot watches from a nearby railing. Warm golden hour lighting, lush green plants, shallow depth "
         "of field, soft camera movement, peaceful and charming mood.",
         "bad animal anatomy, deformed dog, deformed bird, extra legs, extra wings, distorted face, unstable motion, "
         "floating body, unnatural movement, flickering feathers, identity drift, warped background, low quality, "
         "blurry, noisy, pixelated, text, watermark, logo, frame.",
         ["animals", "garden", "cinematic"],
         "demo_chihuahua_parrot_microfilm_sequence", "Chihuahua and Parrot Microfilm",
         ["Clip 01 - Garden Establishing Shot", "Clip 02 - Chihuahua Notices the Parrot", "Clip 03 - Playful Close-up",
          "Clip 04 - Parrot Flutters Nearby", "Clip 05 - Peaceful Ending"]),
    ]
    for (sc_file, sc_name, mode, positive, negative, tags,
         seq_file, seq_name, clip_names) in demos:
        _write_demo("single_clip_prompt", f"{sc_file}.json", SingleClipPrompt(
            name=sc_name, positive_prompt=positive, negative_prompt=negative,
            tags=tags, mode=mode, source="demo").model_dump(mode="json"))
        _write_demo("sequence_preset", f"{seq_file}.json",
                    _demo_sequence(seq_name, negative, positive, clip_names))

    _write_demo("shared_negative_prompt", "demo_clean_human_motion_negative.json",
                {"type": "shared_negative_prompt", "schema_version": "shared_negative_prompt/1",
                 "name": "Clean Human Motion Negative", "tags": ["motion", "human", "anti-deformation"],
                 "negative_prompt": (
                     "bad anatomy, deformed body, distorted limbs, broken legs, extra limbs, missing fingers, "
                     "malformed hands, twisted feet, unnatural walking, sliding feet, floating body, unstable body, "
                     "body jitter, face distortion, changing face, melting face, asymmetrical face, crossed eyes, "
                     "bad eyes, blinking artifacts, unnatural smile, plastic skin, doll face, uncanny valley, "
                     "low quality, blurry, noisy, pixelated, temporal inconsistency, identity drift, camera jump, "
                     "text, watermark, logo.")})
    _write_demo("shared_negative_prompt", "demo_wan_anti_deformation_negative.json",
                {"type": "shared_negative_prompt", "schema_version": "shared_negative_prompt/1",
                 "name": "WAN Anti-Deformation Negative", "tags": ["wan", "anti-deformation"],
                 "negative_prompt": (
                     "deformed body, distorted limbs, broken anatomy, unstable motion, unnatural movement, frame "
                     "jitter, temporal inconsistency, flickering, identity drift, changing face, warped background, "
                     "duplicated subject, ghosting, melting details, broken hands, extra fingers, extra legs, "
                     "sliding feet, floating body, low quality, blurry, noisy, pixelated, compression artifacts, "
                     "text, watermark, logo.")})
    _rebuild_index()
