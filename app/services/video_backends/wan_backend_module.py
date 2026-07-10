"""Wan 2.2 video backend module (PATCH ModularVideoBackendArchitecture v1).

Thin wrapper/adaptor that exposes the existing, tested Wan generation flow
through the VideoBackendModule interface. It does NOT duplicate Wan inference
logic — `generate()` delegates to the existing generation engine
(`generation_service.get_backend()`), so behavior is identical to before the
patch: the real WanDirectBackend runs, or the developer-only mock backend when
GENERATION_BACKEND=mock is set in development.
"""

from __future__ import annotations

from app.models.generation_models import SAMPLER_NAMES, SCHEDULER_NAMES
from app.services.video_backends.base import VideoBackendModule, _never_cancel


class WanVideoBackendModule(VideoBackendModule):
    backend_id = "wan_22"
    display_name = "Wan 2.2"
    description = ("Wan 2.2 local video generation via diffusers — text-to-video "
                   "and image-to-video, with Model Bundles, Wan presets and "
                   "ModelSamplingSD3.")
    supported_modes = ["text2video", "image2video"]
    available = True

    # -- capabilities / schema ------------------------------------------------
    def get_capabilities(self) -> dict:
        caps = {
            "modes": list(self.supported_modes),
            "samplers": list(SAMPLER_NAMES),
            "schedulers": list(SCHEDULER_NAMES),
            "supports_source_image": True,
            "supports_model_sampling_sd3": True,
            "supports_wan_presets": True,
            "supports_comfyui_routing": True,
        }
        # Real, live capability of the direct backend / ComfyUI routing. Never
        # breaks the description if the backend cannot be probed right now.
        try:
            from app.services import generation_service

            caps["sampling_support"] = generation_service.wan_sampling_capabilities()
            caps["model_sampling_support"] = generation_service.model_sampling_capabilities()
        except Exception:  # noqa: BLE001 — capability probing must never raise here
            pass
        return caps

    def get_common_parameter_defaults(self) -> dict:
        """Common video-generation parameters shared by most backends (§8.1)."""
        return {
            "mode": "text2video",
            "prompt": "",
            "negative_prompt": "",
            "width": 832,
            "height": 480,
            "frames": 81,
            "fps": 16,
            "steps": 24,
            "guidance_scale": 3.5,
            "seed": -1,
            "denoise": 1.0,
            "output_format": "mp4",
        }

    def get_backend_parameter_schema(self) -> dict:
        """Wan-specific parameters (§8.2) — kept separate so a future backend
        never inherits these Wan-only controls."""
        return {
            "backend_id": self.backend_id,
            "wan_specific": True,
            "parameters": {
                "model_bundle_id": {"type": "string"},
                "wan_preset": {"type": "string", "default": "manual"},
                "sampler_name": {"type": "enum", "values": list(SAMPLER_NAMES)},
                "scheduler": {"type": "enum", "values": list(SCHEDULER_NAMES)},
                "denoise": {"type": "float", "min": 0.0, "max": 1.0, "default": 1.0},
                "model_sampling": {
                    "enabled": {"type": "bool", "default": False},
                    "type": {"type": "enum", "values": ["sd3"], "default": "sd3"},
                    "shift": {"type": "float", "min": 0.0, "max": 100.0, "default": 8.0},
                },
                "precision": {"type": "enum", "values": ["bf16", "fp16", "fp32"]},
                "device": {"type": "enum", "values": ["cuda", "cpu"]},
                "offload_policy": {"type": "string"},
                "unload_model_after_generation": {"type": "bool", "default": False},
            },
        }

    def get_presets(self) -> list[dict]:
        """Wan preset catalogue, each tagged with this backend_id (§14)."""
        try:
            from app.services import preset_service

            defs = preset_service.preset_definitions()
        except Exception:  # noqa: BLE001 — never break the module description
            return []
        for d in defs:
            d.setdefault("backend_id", self.backend_id)
        return defs

    def validate_request(self, request) -> dict:
        """Honest, lightweight validation. `request` is an in-memory Project.
        The authoritative preflight still runs in the job manager / queue — this
        is the module-level contract for API/future use."""
        errors: list[str] = []
        warnings: list[str] = []
        mode = getattr(getattr(request, "generation_mode", None), "value", None)
        if mode and mode not in self.supported_modes:
            errors.append(f"Wan 2.2 does not support '{mode}' generation.")
        if not getattr(request, "model_id", ""):
            errors.append("No model bundle selected for the Wan backend.")
        return {"ok": not errors, "errors": errors, "warnings": warnings}

    # -- generation -----------------------------------------------------------
    def generate(self, project, seed, output_stem, output_dir, preview_dir,
                 progress, should_cancel=_never_cancel, confirm_fallback=False):
        """Delegate to the existing Wan generation engine (real inference, or the
        developer-only mock in dev). No inference logic is duplicated here."""
        from app.services import generation_service

        engine = generation_service.get_backend()
        return engine.generate(
            project, seed, output_stem, output_dir, preview_dir, progress,
            should_cancel=should_cancel, confirm_fallback=confirm_fallback,
        )
