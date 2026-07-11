"""GameLab project lifecycle, scene editing, media import and validation.

GameLab projects are stored as JSON in <GAMELAB_ROOT>/<game_id>/game.json with a
portable, project-relative asset layout:

    <GAMELAB_ROOT>/<game_id>/
        game.json
        assets/videos/  assets/images/  assets/audio/
        exports/<slug>_web/            (created by gamelab_export_service)

GameLab never calls Wan/LTX or any video backend. Media is always COPIED into the
game project; game.json only ever stores project-relative paths.
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path

from app.config import logger, settings
from app.models.gamelab_models import (
    INTERACTION_TYPES,
    QTE_KEYS,
    GameProject,
    GameScene,
    utc_now,
)

GAME_FILE = "game.json"
ASSET_SUBFOLDERS = ("assets/videos", "assets/images", "assets/audio")

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\-]+")


class GameLabError(Exception):
    """Raised for GameLab failures with a user-readable message."""


# --------------------------------------------------------------------------- #
# Safe path helpers
# --------------------------------------------------------------------------- #
def game_dir(game_id: str) -> Path:
    """Resolve a game project folder inside GAMELAB_ROOT, refusing traversal."""
    safe = Path(game_id).name
    if not safe or safe != game_id:
        raise GameLabError("Invalid game id.")
    root = settings.gamelab_root.resolve()
    path = (root / safe).resolve()
    if root not in path.parents:
        raise GameLabError("Invalid game project path.")
    return path


def _game_file(game_id: str) -> Path:
    return game_dir(game_id) / GAME_FILE


def sanitize_filename(filename: str) -> str:
    """Sanitise an uploaded/imported filename to a safe, flat name."""
    name = Path(filename or "").name
    stem = Path(name).stem
    ext = Path(name).suffix.lower()
    stem = _SAFE_FILENAME_RE.sub("_", stem).strip("._") or "media"
    ext = _SAFE_FILENAME_RE.sub("", ext)
    return f"{stem[:60]}{ext}"


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug[:50] or "game"


# --------------------------------------------------------------------------- #
# Project CRUD
# --------------------------------------------------------------------------- #
def create_game(title: str) -> GameProject:
    title = (title or "").strip() or "Untitled Game"
    game_id = "game_" + uuid.uuid4().hex[:10]
    project = GameProject(game_id=game_id, title=title)
    gdir = game_dir(game_id)
    gdir.mkdir(parents=True, exist_ok=True)
    for sub in ASSET_SUBFOLDERS:
        (gdir / sub).mkdir(parents=True, exist_ok=True)
    save_game(project)
    logger.info("GameLab project created: '%s' (%s)", project.title, project.game_id)
    return project


def save_game(project: GameProject) -> GameProject:
    project.updated_at = utc_now()
    gfile = _game_file(project.game_id)
    gfile.parent.mkdir(parents=True, exist_ok=True)
    tmp = gfile.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(project.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(gfile)
    logger.info("GameLab project saved: '%s' (%s)", project.title, project.game_id)
    return project


def load_game(game_id: str) -> GameProject:
    gfile = _game_file(game_id)
    if not gfile.exists():
        raise GameLabError(f"Game project '{game_id}' was not found.")
    try:
        data = json.loads(gfile.read_text(encoding="utf-8"))
        return GameProject.model_validate(data)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("Corrupted GameLab project %s: %s", gfile, exc)
        raise GameLabError(f"Game project '{game_id}' is corrupted or invalid.") from exc


def list_games() -> list[dict]:
    root = settings.gamelab_root
    games: list[dict] = []
    if not root.exists():
        return games
    for child in sorted(root.iterdir()):
        if not (child.is_dir() and (child / GAME_FILE).exists()):
            continue
        try:
            p = load_game(child.name)
        except GameLabError:
            logger.warning("Skipping unreadable GameLab project: %s", child)
            continue
        games.append({
            "game_id": p.game_id,
            "title": p.title,
            "theme": p.theme,
            "scene_count": len(p.scenes),
            "created_at": p.created_at,
            "updated_at": p.updated_at,
        })
    games.sort(key=lambda g: g["updated_at"], reverse=True)
    return games


def update_game_settings(game_id: str, data: dict) -> GameProject:
    """Apply Game Setup fields (never touches the scene list)."""
    project = load_game(game_id)
    allowed = ("title", "template", "theme", "start_scene_id", "lives",
               "checkpoint_mode", "show_hud", "enable_sfx", "enable_music")
    patch = {k: v for k, v in (data or {}).items() if k in allowed}
    if "title" in patch:
        patch["title"] = str(patch["title"]).strip() or project.title
    merged = project.model_dump()
    merged.update(patch)
    updated = GameProject.model_validate(merged)
    updated.scenes = project.scenes  # scenes are managed by the scene endpoints
    return save_game(updated)


# --------------------------------------------------------------------------- #
# Scene CRUD
# --------------------------------------------------------------------------- #
def _new_scene_id() -> str:
    return "scene_" + uuid.uuid4().hex[:10]


def add_scene(game_id: str, data: dict | None = None) -> tuple[GameProject, GameScene]:
    project = load_game(game_id)
    payload = dict(data or {})
    payload["scene_id"] = _new_scene_id()
    scene = GameScene.model_validate(payload)
    project.scenes.append(scene)
    # First scene added becomes the start scene automatically.
    if not project.start_scene_id:
        project.start_scene_id = scene.scene_id
    save_game(project)
    return project, scene


def update_scene(game_id: str, scene_id: str, data: dict) -> tuple[GameProject, GameScene]:
    project = load_game(game_id)
    existing = project.scene_by_id(scene_id)
    if existing is None:
        raise GameLabError(f"Scene '{scene_id}' does not exist.")
    merged = existing.model_dump()
    for k, v in (data or {}).items():
        if k in merged and k != "scene_id":
            merged[k] = v
    merged["scene_id"] = scene_id
    scene = GameScene.model_validate(merged)
    project.scenes = [scene if s.scene_id == scene_id else s for s in project.scenes]
    save_game(project)
    return project, scene


def duplicate_scene(game_id: str, scene_id: str) -> tuple[GameProject, GameScene]:
    project = load_game(game_id)
    src = project.scene_by_id(scene_id)
    if src is None:
        raise GameLabError(f"Scene '{scene_id}' does not exist.")
    clone = src.model_copy(deep=True)
    clone.scene_id = _new_scene_id()
    clone.name = f"{src.name} Copy"
    clone.is_checkpoint = False
    idx = next(i for i, s in enumerate(project.scenes) if s.scene_id == scene_id)
    project.scenes.insert(idx + 1, clone)
    save_game(project)
    return project, clone


def delete_scene(game_id: str, scene_id: str) -> GameProject:
    project = load_game(game_id)
    if project.scene_by_id(scene_id) is None:
        raise GameLabError(f"Scene '{scene_id}' does not exist.")
    project.scenes = [s for s in project.scenes if s.scene_id != scene_id]
    # Clear dangling references so validation/flow stay coherent.
    for s in project.scenes:
        for attr in ("next_scene_id", "success_scene_id", "failure_scene_id"):
            if getattr(s, attr) == scene_id:
                setattr(s, attr, None)
    if project.start_scene_id == scene_id:
        project.start_scene_id = project.scenes[0].scene_id if project.scenes else None
    save_game(project)
    return project


# --------------------------------------------------------------------------- #
# Media import (upload bytes OR copy from an existing Library asset)
# --------------------------------------------------------------------------- #
def _asset_subfolder_for_ext(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    if ext in settings.allowed_video_extensions:
        return "assets/videos"
    if ext in settings.allowed_image_extensions:
        return "assets/images"
    if ext in settings.allowed_audio_extensions:
        return "assets/audio"
    allowed = ", ".join(sorted(set(settings.allowed_video_extensions)
                               | set(settings.allowed_image_extensions)))
    raise GameLabError(f"File type '.{ext}' is not supported. Allowed: {allowed}.")


def _unique_target(base: Path, filename: str) -> Path:
    target = base / filename
    if not target.exists():
        return target
    stem, suffix = Path(filename).stem, Path(filename).suffix
    n = 2
    while (base / f"{stem}_{n}{suffix}").exists():
        n += 1
    return base / f"{stem}_{n}{suffix}"


def _store_media_bytes(game_id: str, filename: str, data: bytes) -> dict:
    safe = sanitize_filename(filename)
    ext = Path(safe).suffix.lstrip(".").lower()
    if not ext:
        raise GameLabError("The media file has no extension.")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise GameLabError(f"File is too large ({len(data)/1024/1024:.1f} MB). "
                           f"Limit is {settings.max_upload_size_mb} MB.")
    sub = _asset_subfolder_for_ext(ext)
    base = game_dir(game_id) / sub
    base.mkdir(parents=True, exist_ok=True)
    target = _unique_target(base, safe)
    target.write_bytes(data)
    rel = f"{sub}/{target.name}"
    kind = "video" if sub.endswith("videos") else ("image" if sub.endswith("images") else "audio")
    logger.info("GameLab media stored for '%s': %s (%.1f KB)", game_id, rel, len(data)/1024)
    return {"media_path": rel, "kind": kind, "filename": target.name}


def import_media_upload(game_id: str, filename: str, data: bytes) -> dict:
    load_game(game_id)  # ensure it exists
    return _store_media_bytes(game_id, filename, data)


def _resolve_source_media(source: dict) -> tuple[Path, str, str]:
    """Resolve a RadicaLab-owned media asset to (abs_path, media_kind, default_name).

    Every branch resolves through an existing safe service (VideoLab media
    resolver / sequence service), so no arbitrary path can be read. `source` is a
    structured descriptor produced by list_importable_assets — never a raw path.
    """
    from app.services import media_service, sequence_service
    from app.services.sequence_service import SequenceError

    stype = (source or {}).get("source_type")

    if stype == "project_output":
        project_id = str(source.get("project_id", ""))
        filename = str(source.get("filename", ""))
        try:
            path = media_service.resolve_media_path(project_id, "outputs", filename)
        except media_service.MediaError as exc:
            raise GameLabError(str(exc)) from exc
        return path, _media_kind_for(path), Path(filename).stem

    if stype == "sequence_clip":
        stage = str(source.get("stage", "final"))
        if stage not in ("final", "fx", "raw"):
            raise GameLabError("Invalid sequence clip stage.")
        try:
            seq = sequence_service.load_sequence(str(source.get("sequence_id", "")))
        except SequenceError as exc:
            raise GameLabError(str(exc)) from exc
        clip = seq.get_clip(str(source.get("clip_id", "")))
        if clip is None:
            raise GameLabError("Sequence clip not found.")
        fname = getattr(clip.outputs, stage, None)
        if not fname:
            raise GameLabError(f"That clip has no {stage} output.")
        path = (sequence_service.clip_dir(seq, clip) / stage / Path(fname).name).resolve()
        if not path.exists():
            raise GameLabError("Sequence clip output file is missing.")
        return path, _media_kind_for(path), (clip.name or Path(fname).stem)

    if stype == "sequence_export":
        kind = str(source.get("kind", "final"))
        if kind not in ("final", "merged"):
            raise GameLabError("Invalid sequence export kind.")
        try:
            seq = sequence_service.load_sequence(str(source.get("sequence_id", "")))
        except SequenceError as exc:
            raise GameLabError(str(exc)) from exc
        fname = getattr(seq.outputs, kind, None)
        if not fname:
            raise GameLabError(f"That sequence has no {kind} output.")
        path = (sequence_service.sequence_dir(seq.folder) / "exports" / kind / Path(fname).name).resolve()
        if not path.exists():
            raise GameLabError("Sequence output file is missing.")
        return path, _media_kind_for(path), f"{seq.name} ({kind})"

    raise GameLabError("Unknown media source.")


def _media_kind_for(path: Path) -> str:
    ext = path.suffix.lstrip(".").lower()
    if ext in settings.allowed_image_extensions:
        return "image"
    if ext in settings.allowed_audio_extensions:
        return "audio"
    return "video"


def import_media_from_source(game_id: str, source: dict) -> dict:
    """Copy a RadicaLab-owned media asset (VideoLab output OR Sequence Queue clip/
    export) into this game project. The original file is never moved or modified."""
    load_game(game_id)
    src, _kind, default_name = _resolve_source_media(source)
    result = _store_media_bytes(game_id, src.name, src.read_bytes())
    result["default_name"] = default_name
    return result


def list_importable_assets() -> list[dict]:
    """Discover importable video/image media from existing RadicaLab outputs:
    Single Clip outputs, completed Sequence Queue clips (best of final>fx>raw)
    and sequence-level final/merged exports. Reuses project/sequence services;
    never exposes absolute paths. Incomplete/failed outputs are skipped."""
    from app.services import project_service, sequence_service
    from app.services.project_service import ProjectError
    from app.services.sequence_service import SequenceError

    assets: list[dict] = []

    # VideoLab Single Clip generated outputs
    for summary in project_service.list_projects():
        try:
            project = project_service.load_project(summary.id)
        except ProjectError:
            continue
        for video in project.generated_videos:
            assets.append({
                "label": video.filename,
                "group": project.name,
                "media_kind": "video",
                "preview": (f"/media/projects/{project.id}/previews/{video.preview}"
                            if video.preview else None),
                "suggested_name": project.name,
                "source": {"source_type": "project_output",
                           "project_id": project.id, "filename": video.filename},
            })

    # Sequence Queue clip outputs (best available) + sequence exports
    try:
        seq_list = sequence_service.list_sequences()
    except Exception:  # noqa: BLE001 — discovery must never break the import UI
        seq_list = []
    for entry in seq_list:
        try:
            seq = sequence_service.load_sequence(entry["sequence_id"])
        except (SequenceError, KeyError):
            continue
        for clip in seq.clips:
            stage = ("final" if clip.outputs.final else
                     "fx" if clip.outputs.fx else
                     "raw" if clip.outputs.raw else None)
            if not stage:
                continue  # incomplete/failed clips are not selectable
            preview = (f"/media/sequences/{seq.sequence_id}/clip/{clip.clip_id}/preview"
                       if clip.outputs.preview else None)
            assets.append({
                "label": f"{clip.name or ('Clip ' + str(clip.index + 1))} · {stage}",
                "group": f"Sequence: {seq.name}",
                "media_kind": "video",
                "preview": preview,
                "suggested_name": clip.name or f"Clip {clip.index + 1}",
                "source": {"source_type": "sequence_clip",
                           "sequence_id": seq.sequence_id, "clip_id": clip.clip_id, "stage": stage},
            })
        for kind in ("final", "merged"):
            if getattr(seq.outputs, kind, None):
                assets.append({
                    "label": f"{seq.name} · sequence {kind}",
                    "group": f"Sequence: {seq.name}",
                    "media_kind": "video",
                    "preview": None,
                    "suggested_name": f"{seq.name} {kind}",
                    "source": {"source_type": "sequence_export",
                               "sequence_id": seq.sequence_id, "kind": kind},
                })
    return assets


def add_scene_with_media(game_id: str, media_path: str, media_kind: str,
                         name: str) -> tuple[GameProject, GameScene]:
    """Create a new scene that references already-copied media (used by import)."""
    scene_type = "image" if media_kind == "image" else "video"
    return add_scene(game_id, {
        "name": (name or "New Scene").strip()[:80],
        "scene_type": scene_type,
        "interaction_type": "none",
        "media_path": media_path,
    })


def move_scene(game_id: str, scene_id: str, direction: str) -> GameProject:
    """Move a scene up/down in the editorial list order. Does NOT rewrite game
    flow (next/success/failure links) — order and flow are independent."""
    project = load_game(game_id)
    idx = next((i for i, s in enumerate(project.scenes) if s.scene_id == scene_id), None)
    if idx is None:
        raise GameLabError(f"Scene '{scene_id}' does not exist.")
    swap = idx - 1 if direction == "up" else idx + 1
    if swap < 0 or swap >= len(project.scenes):
        return project  # already at an edge — no-op
    project.scenes[idx], project.scenes[swap] = project.scenes[swap], project.scenes[idx]
    save_game(project)
    return project


def delete_game(game_id: str) -> str:
    """Delete one GameLab project folder (and only that folder). Never touches
    VideoLab/Sequence Queue projects, models or the global Library."""
    gdir = game_dir(game_id)
    if not (gdir / GAME_FILE).exists():
        raise GameLabError(f"Game project '{game_id}' was not found.")
    title = load_game(game_id).title
    shutil.rmtree(gdir)
    logger.info("GameLab project deleted: '%s' (%s)", title, game_id)
    return title


def resolve_game_asset(game_id: str, sub: str, filename: str) -> Path:
    """Resolve an asset file for serving, refusing traversal. `sub` is one of
    videos|images|audio."""
    if sub not in ("videos", "images", "audio"):
        raise GameLabError("Invalid asset kind.")
    safe = Path(filename).name
    if not safe or safe != filename:
        raise GameLabError("Invalid file name.")
    base = (game_dir(game_id) / "assets" / sub).resolve()
    path = (base / safe).resolve()
    if base not in path.parents:
        raise GameLabError("Invalid asset path.")
    if not path.exists() or not path.is_file():
        raise GameLabError(f"Asset '{safe}' was not found.")
    return path


def asset_abs_path(game_id: str, media_path: str) -> Path | None:
    """Absolute path for a project-relative media_path like assets/videos/x.mp4.
    Returns None if the reference is empty/invalid/missing."""
    if not media_path:
        return None
    parts = media_path.replace("\\", "/").split("/")
    if len(parts) != 3 or parts[0] != "assets" or parts[1] not in ("videos", "images", "audio"):
        return None
    try:
        return resolve_game_asset(game_id, parts[1], parts[2])
    except GameLabError:
        return None


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def validate_game(project: GameProject, *, for_export: bool = False) -> list[str]:
    """Return a list of readable, actionable validation errors (empty = OK)."""
    errors: list[str] = []
    if not project.title.strip():
        errors.append("Game title must not be empty.")
    if not project.scenes:
        errors.append("Add at least one scene before saving or exporting.")

    ids = [s.scene_id for s in project.scenes]
    if len(ids) != len(set(ids)):
        errors.append("Every scene must have a unique id.")
    id_set = set(ids)

    if not project.start_scene_id:
        errors.append("Start scene is not set.")
    elif project.start_scene_id not in id_set:
        errors.append("Start scene does not exist.")

    for s in project.scenes:
        label = s.name or s.scene_id
        for attr, human in (("next_scene_id", "next scene"),
                            ("success_scene_id", "success target"),
                            ("failure_scene_id", "failure target")):
            ref = getattr(s, attr)
            if ref and ref not in id_set:
                errors.append(f"Scene '{label}' references a {human} that does not exist.")

        if s.interaction_type == "qte":
            if s.qte_key not in QTE_KEYS:
                errors.append(f"Scene '{label}' has an invalid QTE key.")
            if s.time_limit_seconds <= 0:
                errors.append(f"Scene '{label}': QTE time limit must be greater than zero.")
            if not s.success_scene_id:
                errors.append(f"Scene '{label}': QTE success target is not set.")
            if not s.failure_scene_id:
                errors.append(f"Scene '{label}': QTE failure target is not set.")
        elif s.interaction_type == "none" and s.scene_type not in ("end", "failure"):
            if not s.next_scene_id:
                errors.append(f"Scene '{label}': next scene is not set.")

        if s.scene_type == "failure" and s.after_scene_behavior not in (
                "restart_checkpoint", "restart_game", "game_over"):
            errors.append(f"Scene '{label}': invalid after-failure behavior.")

        # Media presence: end scenes may be text-only; everything else needs media.
        if s.scene_type != "end":
            if not s.media_path:
                errors.append(f"Scene '{label}' has no media assigned.")
            elif for_export and asset_abs_path(project.game_id, s.media_path) is None:
                errors.append(f"Scene '{label}': media file is missing ({s.media_path}).")

    return errors
