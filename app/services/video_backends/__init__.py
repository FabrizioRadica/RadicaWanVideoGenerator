"""Modular video backend architecture (PATCH ModularVideoBackendArchitecture v1).

The backend module architecture is prepared for future video backends. In this
patch the only registered, available backend is Wan 2.2 (`wan_22`).
"""

from __future__ import annotations

from app.services.video_backends.base import VideoBackendError, VideoBackendModule
from app.services.video_backends.registry import (
    DEFAULT_BACKEND_ID,
    available_backends,
    describe_all,
    get_backend,
    is_default,
    list_backends,
    normalize_backend_id,
    register,
    require_available,
)

__all__ = [
    "DEFAULT_BACKEND_ID",
    "VideoBackendError",
    "VideoBackendModule",
    "available_backends",
    "describe_all",
    "get_backend",
    "is_default",
    "list_backends",
    "normalize_backend_id",
    "register",
    "require_available",
]
