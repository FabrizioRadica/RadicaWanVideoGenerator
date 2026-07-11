"""GameLab module — page, project/scene API, media import, export, media serving.

GameLab is an interactive web game builder inside RadicaLab. It never calls Wan
or any video backend, and never exposes absolute filesystem paths. All media is
copied into the game project; game.json stores project-relative paths only.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from app.models.gamelab_models import (
    AFTER_FAILURE_BEHAVIORS,
    INTERACTION_TYPES,
    QTE_KEYS,
    SCENE_TYPES,
    THEMES,
    TEMPLATES,
)
from app.routes.shared import page_context, templates
from app.services import (
    gamelab_ai_service,
    gamelab_export_service,
    gamelab_service,
    gamelab_template_service,
    media_service,
)
from app.services.ai_assistant.providers import AIProviderError
from app.services.gamelab_service import GameLabError
from app.services.gamelab_template_service import GameLabTemplateError

router = APIRouter()


def _err(exc: GameLabError, default_status: int = 400) -> HTTPException:
    status = 404 if "not found" in str(exc).lower() else default_status
    return HTTPException(status_code=status, detail=str(exc))


# --------------------------------------------------------------------------- #
# Page
# --------------------------------------------------------------------------- #
@router.get("/gamelab", response_class=HTMLResponse)
async def gamelab_page(request: Request):
    return templates.TemplateResponse(
        request,
        "gamelab.html",
        page_context(
            request,
            "gamelab",
            gamelab_options={
                "scene_types": list(SCENE_TYPES),
                "interaction_types": list(INTERACTION_TYPES),
                "qte_keys": list(QTE_KEYS),
                "after_failure": list(AFTER_FAILURE_BEHAVIORS),
                "themes": list(THEMES),
                "templates": list(TEMPLATES),
            },
        ),
    )


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
@router.get("/api/gamelab/projects")
async def api_list_games():
    return {"ok": True, "projects": gamelab_service.list_games()}


@router.post("/api/gamelab/projects")
async def api_create_game(payload: dict):
    title = str((payload or {}).get("title", "")).strip()
    try:
        project = gamelab_service.create_game(title)
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "project": project.model_dump()}


@router.get("/api/gamelab/projects/{game_id}")
async def api_get_game(game_id: str):
    try:
        project = gamelab_service.load_game(game_id)
    except GameLabError as exc:
        raise _err(exc, 404)
    return {
        "ok": True,
        "project": project.model_dump(),
        "validation": gamelab_service.validate_game(project),
    }


@router.put("/api/gamelab/projects/{game_id}")
async def api_update_game(game_id: str, payload: dict):
    try:
        project = gamelab_service.update_game_settings(game_id, payload or {})
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.delete("/api/gamelab/projects/{game_id}")
async def api_delete_game(game_id: str):
    try:
        title = gamelab_service.delete_game(game_id)
    except GameLabError as exc:
        raise _err(exc, 404)
    return {"ok": True, "message": f"Game project '{title}' deleted.", "game_id": game_id}


# --------------------------------------------------------------------------- #
# Scenes
# --------------------------------------------------------------------------- #
@router.post("/api/gamelab/projects/{game_id}/scenes")
async def api_add_scene(game_id: str, payload: dict | None = None):
    try:
        project, scene = gamelab_service.add_scene(game_id, payload or {})
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "scene": scene.model_dump(), "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.put("/api/gamelab/projects/{game_id}/scenes/{scene_id}")
async def api_update_scene(game_id: str, scene_id: str, payload: dict):
    try:
        project, scene = gamelab_service.update_scene(game_id, scene_id, payload or {})
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "scene": scene.model_dump(), "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.post("/api/gamelab/projects/{game_id}/scenes/{scene_id}/duplicate")
async def api_duplicate_scene(game_id: str, scene_id: str):
    try:
        project, scene = gamelab_service.duplicate_scene(game_id, scene_id)
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "scene": scene.model_dump(), "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.delete("/api/gamelab/projects/{game_id}/scenes/{scene_id}")
async def api_delete_scene(game_id: str, scene_id: str):
    try:
        project = gamelab_service.delete_scene(game_id, scene_id)
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.post("/api/gamelab/projects/{game_id}/scenes/{scene_id}/move")
async def api_move_scene(game_id: str, scene_id: str, payload: dict):
    direction = str((payload or {}).get("direction", "")).lower()
    if direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'.")
    try:
        project = gamelab_service.move_scene(game_id, scene_id, direction)
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


# --------------------------------------------------------------------------- #
# Media import + export
# --------------------------------------------------------------------------- #
def _apply_media(game_id: str, result: dict, as_new_scene: bool, scene_id: str | None) -> dict:
    """After a media file has been copied into the game, either create a NEW
    scene that uses it (import flow) or set it on an existing scene."""
    media_path, kind = result["media_path"], result["kind"]
    if as_new_scene:
        name = result.get("default_name") or media_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        project, scene = gamelab_service.add_scene_with_media(game_id, media_path, kind, name)
    else:
        if not scene_id:
            raise GameLabError("No scene selected to attach the media to.")
        project, scene = gamelab_service.update_scene(game_id, scene_id, {"media_path": media_path})
    return {"ok": True, "media_path": media_path, "kind": kind,
            "scene": scene.model_dump(), "project": project.model_dump(),
            "validation": gamelab_service.validate_game(project)}


@router.post("/api/gamelab/projects/{game_id}/media/upload")
async def api_upload_media(
    game_id: str,
    file: UploadFile = File(...),
    as_new_scene: bool = Form(False),
    scene_id: str | None = Form(None),
):
    """Upload a local video/image file. Copies it into the game project and
    either creates a new scene (as_new_scene) or sets it on the given scene."""
    try:
        data = await file.read()
        result = gamelab_service.import_media_upload(game_id, file.filename or "media", data)
        return _apply_media(game_id, result, as_new_scene, scene_id)
    except GameLabError as exc:
        raise _err(exc)


@router.post("/api/gamelab/projects/{game_id}/media/import")
async def api_import_media(game_id: str, payload: dict):
    """Import an existing RadicaLab media asset (VideoLab output or Sequence
    Queue clip/export, described by `source`) as a NEW scene by default."""
    source = (payload or {}).get("source")
    if not isinstance(source, dict):
        raise HTTPException(status_code=400, detail="A media 'source' is required.")
    as_new_scene = bool(payload.get("as_new_scene", True))
    scene_id = payload.get("scene_id")
    try:
        result = gamelab_service.import_media_from_source(game_id, source)
        return _apply_media(game_id, result, as_new_scene, scene_id)
    except GameLabError as exc:
        raise _err(exc)


@router.get("/api/gamelab/library-assets")
async def api_library_assets():
    """Importable video/image media from Single Clip outputs, completed Sequence
    Queue clips (best of final>fx>raw) and sequence final/merged exports."""
    return {"ok": True, "assets": gamelab_service.list_importable_assets()}


@router.post("/api/gamelab/projects/{game_id}/export")
async def api_export_game(game_id: str):
    try:
        result = gamelab_export_service.export_game(game_id)
    except GameLabError as exc:
        raise _err(exc)
    return {"ok": True, "message": "Web build exported successfully.", **result}


# --------------------------------------------------------------------------- #
# AI Game Generator (PATCH_GameLabPromptToGameConfig_v1)
# --------------------------------------------------------------------------- #
@router.get("/api/gamelab/ai/templates")
async def api_ai_templates():
    """Templates discovered by scanning gamelab_templates/ — no hardcoded ids."""
    return {"ok": True, **gamelab_template_service.discover_templates()}


@router.post("/api/gamelab/projects/{game_id}/ai/generate")
async def api_ai_generate(game_id: str, payload: dict):
    """Generate a validated template configuration from a prompt through the
    shared AI Assistant provider layer. Never generates runtime code."""
    body = payload or {}
    try:
        return await gamelab_ai_service.generate_config(
            game_id,
            str(body.get("template_id", "")),
            str(body.get("prompt", "")),
            provider=body.get("provider"),
            model_name=body.get("model_name"),
        )
    except (GameLabError, GameLabTemplateError) as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400,
                            detail=str(exc))
    except AIProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/api/gamelab/projects/{game_id}/ai/config")
async def api_ai_update_config(game_id: str, payload: dict):
    """Store a manually edited config (preview area) and revalidate it."""
    config_obj = (payload or {}).get("config")
    try:
        return gamelab_ai_service.apply_edited_config(game_id, config_obj)
    except (GameLabError, GameLabTemplateError) as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400,
                            detail=str(exc))


@router.post("/api/gamelab/projects/{game_id}/ai/build")
async def api_ai_build(game_id: str):
    """Build the standalone game from the locked template runtime + stored
    validated config. The same build serves Test Play and is the export."""
    try:
        return gamelab_ai_service.build_game(game_id)
    except (GameLabError, GameLabTemplateError) as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400,
                            detail=str(exc))


@router.get("/media/gamelab/{game_id}/ai-build/{build_token}/{rel_path:path}")
async def serve_ai_build_file(game_id: str, build_token: str, rel_path: str):
    """Serve files of the current AI game build for in-app Test Play.

    `build_token` (derived from built_at) namespaces every build's URLs so the
    browser can never reuse a cached runtime/config from a PREVIOUS build of a
    different template — the exact failure that made the Test Play modal report
    "inline configuration is not valid JSON" while the exported build worked.
    `no-store` keeps even same-build responses out of the cache."""
    try:
        path = gamelab_ai_service.resolve_build_file(game_id, rel_path)
    except GameLabError as exc:
        raise _err(exc, 404)
    return FileResponse(path, media_type=media_service.content_type_for(path),
                        headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- #
# Media serving (Test Play uses these; the exported build uses relative paths)
# --------------------------------------------------------------------------- #
@router.get("/media/gamelab/{game_id}/asset/{sub}/{filename}")
async def serve_gamelab_asset(game_id: str, sub: str, filename: str):
    try:
        path = gamelab_service.resolve_game_asset(game_id, sub, filename)
    except GameLabError as exc:
        raise _err(exc)
    return FileResponse(path, media_type=media_service.content_type_for(path))
