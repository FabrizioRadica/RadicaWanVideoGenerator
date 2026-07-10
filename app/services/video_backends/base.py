"""Video backend module contract (PATCH ModularVideoBackendArchitecture v1).

A *video backend module* wraps ONE real video generation engine behind a common
interface, so the application is no longer internally tied only to Wan. Wan 2.2
is the first registered module (see wan_backend_module.WanVideoBackendModule);
future engines (e.g. LTX Video 2.3+) can be added as new modules without
touching Single Clip or VideoSequenceQueue.

This layer never fakes generation. A module that cannot really render must
report `available = False` and must not be selectable for rendering — the
registry refuses to start a generation on an unavailable backend.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable


class VideoBackendError(Exception):
    """Raised for backend-module resolution/selection problems with a
    user-readable message (unknown id, unavailable backend, etc.)."""


def _never_cancel() -> bool:
    return False


class VideoBackendModule(ABC):
    """Common interface every video backend module exposes.

    The descriptive methods below describe REAL backend behavior — a module must
    not advertise parameters it cannot honor. Only `generate` is abstract; the
    metadata methods have safe defaults so a concrete module overrides just what
    it actually supports.
    """

    backend_id: str = ""
    display_name: str = ""
    description: str = ""
    supported_modes: list[str] = []
    # Only available modules may be used for rendering (see registry). A future,
    # not-yet-implemented backend must keep this False.
    available: bool = False

    def get_capabilities(self) -> dict:
        """What the backend can really do (modes, samplers, feature flags)."""
        return {"modes": list(self.supported_modes)}

    def get_common_parameter_defaults(self) -> dict:
        """Defaults for parameters shared by most video backends."""
        return {}

    def get_backend_parameter_schema(self) -> dict:
        """Backend-specific parameters, kept separate from the common ones so a
        future backend never inherits Wan-only controls."""
        return {}

    def get_presets(self) -> list[dict]:
        """Presets associated with THIS backend (each tagged with backend_id)."""
        return []

    def validate_request(self, request) -> dict:
        """Lightweight, honest validation of a generation request for this
        backend. Returns {"ok": bool, "errors": [...], "warnings": [...]}."""
        return {"ok": True, "errors": [], "warnings": []}

    @abstractmethod
    def generate(self, project, seed: int, output_stem: str, output_dir,
                 preview_dir, progress: Callable[[int, str], None],
                 should_cancel: Callable[[], bool] = _never_cancel,
                 confirm_fallback: bool = False):
        """Run a real generation and return a generation_service.BackendResult.

        Wraps/delegates to the engine actually implementing the backend — this
        method must never fabricate an output file."""
        ...

    def describe(self, is_default: bool = False) -> dict:
        """API/UI-friendly description. Never exposes local absolute paths."""
        return {
            "backend_id": self.backend_id,
            "display_name": self.display_name,
            "description": self.description,
            "available": bool(self.available),
            "default": bool(is_default),
            "supported_modes": list(self.supported_modes),
            "capabilities": self.get_capabilities(),
        }
