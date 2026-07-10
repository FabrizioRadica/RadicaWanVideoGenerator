"""Video backend registry (PATCH ModularVideoBackendArchitecture v1).

Lists the available video backend modules, resolves a module by id, and gates
generation so an unknown or unavailable backend can never start a render.

Initial registry contains ONLY `wan_22`. LTX and other engines must not appear
here until a real implementation exists — no placeholder/fake backends.
"""

from __future__ import annotations

from app.config import logger
from app.services.video_backends.base import VideoBackendError, VideoBackendModule
from app.services.video_backends.wan_backend_module import WanVideoBackendModule

# The default backend used when a project/sequence/model has no backend_id, and
# after this patch the only real, available backend.
DEFAULT_BACKEND_ID = "wan_22"

# Insertion order = display order. Only Wan is registered in this patch.
_MODULES: dict[str, VideoBackendModule] = {}


def register(module: VideoBackendModule) -> None:
    bid = (module.backend_id or "").strip().lower()
    if not bid:
        raise VideoBackendError("A backend module must declare a non-empty backend_id.")
    _MODULES[bid] = module
    logger.info("Video backend module registered: %s (%s, available=%s)",
                bid, module.display_name, module.available)


register(WanVideoBackendModule())


def list_backends() -> list[VideoBackendModule]:
    """All registered backend modules, in display order."""
    return list(_MODULES.values())


def available_backends() -> list[VideoBackendModule]:
    """Only the modules that can really render."""
    return [m for m in _MODULES.values() if m.available]


def is_default(backend_id: str) -> bool:
    return (backend_id or "").strip().lower() == DEFAULT_BACKEND_ID


def normalize_backend_id(raw: str | None) -> str:
    """Backward-compatible normalization for STORED data (§9/§10): a missing or
    empty backend id becomes the default `wan_22`. A non-empty value is kept
    as-is (lower-cased) so a future backend id survives round-trips; whether it
    can actually render is enforced separately by `require_available`."""
    bid = (raw or "").strip().lower()
    return bid or DEFAULT_BACKEND_ID


def get_backend(backend_id: str | None) -> VideoBackendModule:
    """Resolve a backend module by id. Empty/None resolves to the default.
    An unknown id raises VideoBackendError (never a silent substitution)."""
    bid = normalize_backend_id(backend_id)
    module = _MODULES.get(bid)
    if module is None:
        raise VideoBackendError(
            f"Unknown video backend '{bid}'. Available backends: "
            f"{', '.join(_MODULES) or 'none'}.")
    return module


def require_available(backend_id: str | None) -> VideoBackendModule:
    """Resolve a backend and ensure it can really render. Used before starting a
    generation so an unavailable/placeholder backend blocks with a clear error
    instead of a fake or failed render (§6/§20)."""
    module = get_backend(backend_id)
    if not module.available:
        raise VideoBackendError(
            f"Video backend '{module.backend_id}' ({module.display_name}) is not "
            "available for rendering yet.")
    return module


def describe_all() -> dict:
    """Registry description for the API/UI (§17). No local absolute paths."""
    return {
        "ok": True,
        "default": DEFAULT_BACKEND_ID,
        "backends": [m.describe(is_default=is_default(m.backend_id))
                     for m in _MODULES.values()],
    }
