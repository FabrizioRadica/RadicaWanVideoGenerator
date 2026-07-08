"""Project-local Prompt Library API (PATCH_ProjectPromptLibrary).

CRUD + trash + import/export + search for portable prompt assets, plus thin
integrations that reuse the existing SequenceQueue service. No render, AI
generation, or SequenceQueue-refresh logic is touched here (patch §1.2).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app.services import prompt_library_service as lib
from app.services.prompt_library_service import PromptLibraryError

router = APIRouter()


async def _json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 — optional/invalid body
        return {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _err(exc: PromptLibraryError) -> HTTPException:
    status = 404 if "not found" in str(exc).lower() else 400
    return HTTPException(status_code=status, detail=str(exc))


# ==========================================================================
# Listing / search
# ==========================================================================
@router.get("/api/prompt-library")
async def api_list(type: str = "all", q: str = "", trash: bool = False):
    try:
        return {"items": lib.list_items(type_filter=type, query=q, include_trash=trash)}
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/rebuild-index")
async def api_rebuild_index():
    return lib.rebuild_index()


@router.post("/api/prompt-library/trash/empty")
async def api_empty_trash():
    return lib.empty_trash()


@router.post("/api/prompt-library/import")
async def api_import(request: Request, file: UploadFile | None = File(None)):
    data: dict | None = None
    if file is not None:
        raw = await file.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="Uploaded file is not valid JSON.")
    else:
        body = await _json_body(request)
        data = body.get("asset") if isinstance(body.get("asset"), dict) else body
    try:
        return lib.import_asset(data)
    except PromptLibraryError as exc:
        raise _err(exc)


# ==========================================================================
# Sequence / clip integrations (reuse existing sequence_service — patch §8)
# ==========================================================================
@router.post("/api/prompt-library/from-sequence/{sequence_id}")
async def api_from_sequence(sequence_id: str, request: Request):
    body = await _json_body(request)
    try:
        return lib.preset_from_sequence(sequence_id, body.get("name", ""))
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/from-clip/{sequence_id}/{clip_id}")
async def api_from_clip(sequence_id: str, clip_id: str, request: Request):
    body = await _json_body(request)
    try:
        return lib.single_clip_from_sequence_clip(sequence_id, clip_id, body.get("name", ""))
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/{preset_id}/apply-to-sequence/{sequence_id}")
async def api_apply_to_sequence(preset_id: str, sequence_id: str, request: Request):
    body = await _json_body(request)
    try:
        return lib.apply_preset_to_sequence(preset_id, sequence_id, body.get("mode", "append"))
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/{negative_id}/apply-negative-to-sequence/{sequence_id}")
async def api_apply_negative(negative_id: str, sequence_id: str):
    try:
        return lib.apply_shared_negative_to_sequence(negative_id, sequence_id)
    except PromptLibraryError as exc:
        raise _err(exc)


# ==========================================================================
# CRUD by id
# ==========================================================================
@router.post("/api/prompt-library")
async def api_save(request: Request):
    body = await _json_body(request)
    if not body:
        raise HTTPException(status_code=400, detail="Request body must be a prompt asset object.")
    try:
        return lib.save(body)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.get("/api/prompt-library/{item_id}")
async def api_get(item_id: str):
    try:
        return {"item": lib.load(item_id)}
    except PromptLibraryError as exc:
        raise _err(exc)


@router.put("/api/prompt-library/{item_id}")
async def api_update(item_id: str, request: Request):
    body = await _json_body(request)
    try:
        return lib.update(item_id, body)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/{item_id}/duplicate")
async def api_duplicate(item_id: str):
    try:
        return lib.duplicate(item_id)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/{item_id}/rename")
async def api_rename(item_id: str, request: Request):
    body = await _json_body(request)
    try:
        return lib.rename(item_id, body.get("name", ""))
    except PromptLibraryError as exc:
        raise _err(exc)


@router.delete("/api/prompt-library/{item_id}")
async def api_delete(item_id: str):
    try:
        return lib.soft_delete(item_id)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.post("/api/prompt-library/{item_id}/restore")
async def api_restore(item_id: str):
    try:
        return lib.restore(item_id)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.delete("/api/prompt-library/{item_id}/permanent")
async def api_permanent_delete(item_id: str):
    try:
        return lib.permanent_delete(item_id)
    except PromptLibraryError as exc:
        raise _err(exc)


@router.get("/api/prompt-library/{item_id}/export")
async def api_export(item_id: str):
    try:
        path = lib.export_path(item_id)
    except PromptLibraryError as exc:
        raise _err(exc)
    return FileResponse(path, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{path.name}"'})
