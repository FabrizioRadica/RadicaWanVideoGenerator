"""VideoSequenceQueue data models (patchRC2).

A *video sequence* is a separate project type from the existing single-clip
`.wanproj`. It persists to `projects/<folder>/sequence.json` and owns a list of
clips that are rendered strictly one at a time. It reuses the existing
`VideoEffects` (Color & Look) and `AudioTrack` models so there is exactly one
color engine and one audio mixer in the app (patchRC2 §7/§8).

Nothing here renders anything — it is pure state. The queue runner
(app/services/sequence_queue_service.py) drives real renders through the
existing generation backend.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from app.models.project_models import AudioTrack, VideoEffects

SEQUENCE_SCHEMA = "video_sequence/1"

# Default video backend module id (PATCH ModularVideoBackendArchitecture v1).
# Sequences without a backend_id load as Wan sequences (§11). Backend selection
# is global at sequence level in v1 — no per-clip backend override.
DEFAULT_BACKEND_ID = "wan_22"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ClipType(str, Enum):
    IMAGE_REFERENCE = "image_reference"  # Image-to-Video
    PROMPT_ONLY = "prompt_only"          # Text-to-Video


class ClipStatus(str, Enum):
    READY = "ready"
    QUEUED = "queued"
    RENDERING = "rendering"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    STOPPED = "stopped"
    NEEDS_REGENERATION = "needs_regeneration"
    SKIPPED = "skipped"


class ColorLookMode(str, Enum):
    GLOBAL = "global"
    CUSTOM = "custom"
    OFF = "off"


class SequenceStatus(str, Enum):
    IDLE = "idle"
    RENDERING = "rendering"
    STOPPING = "stopping"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"


class OutputMode(str, Enum):
    CLIPS_ONLY = "clips_only"
    CLIPS_AND_MERGE = "clips_and_merge"
    SELECTED_ONLY = "selected_only"


class VramMode(str, Enum):
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"
    RELOAD = "reload"


class GlobalGenerationSettings(BaseModel):
    """Defaults applied to every clip unless the clip overrides them (§4.3)."""
    model_id: str = ""
    negative_prompt: str = ""
    wan_preset: str = "manual"
    orientation: str = "landscape"
    width: int = Field(default=832, ge=16, le=8192)
    height: int = Field(default=480, ge=16, le=8192)
    frames: int = Field(default=49, ge=1, le=1000)
    fps: int = Field(default=16, ge=1, le=120)
    steps: int = Field(default=18, ge=1, le=200)
    guidance_scale: float = Field(default=3.5, ge=0.0, le=30.0)
    sampler_name: str = "euler"
    scheduler: str = "simple"
    denoise: float = Field(default=1.0, ge=0.0, le=1.0)
    seed_mode: str = "random"  # random | fixed
    seed: int = Field(default=-1, ge=-1)
    # ComfyUI-compatible seed control, shared with Single Clip (patchSeq §16).
    control_after_generate: str = "fixed"
    model_sampling_enabled: bool = True
    model_sampling_shift: float = Field(default=8.0, ge=0.0, le=100.0)
    precision: str = "bf16"
    device: str = "cuda"
    memory_optimization: bool = True
    model_offload: bool = False
    save_intermediate_frames: bool = False
    unload_model_after_generation: bool = False


class ClipGenerationOverrides(BaseModel):
    """Per-clip overrides — only fields the user explicitly changes are set."""
    width: int | None = None
    height: int | None = None
    frames: int | None = None
    fps: int | None = None
    steps: int | None = None
    guidance_scale: float | None = None
    sampler_name: str | None = None
    scheduler: str | None = None
    denoise: float | None = None
    seed_mode: str | None = None  # random | fixed
    seed: int | None = None
    model_sampling_shift: float | None = None
    negative_prompt: str | None = None


class ContinuityFrame(BaseModel):
    """Metadata of a clip's extracted last frame (SequenceFrameContinuityModule v1).

    `path` is always sequence-relative (assets/continuity_frames/<file>) — never
    an absolute filesystem path. Older sequences without this field load with
    available=False (pydantic default)."""
    available: bool = False
    frame_type: str = "last_frame"
    path: str = ""
    source_output: str = ""
    created_at: str = ""


class CreatedFromFrame(BaseModel):
    """Traceability for clips created from a saved continuity frame."""
    source_clip_id: str = ""
    source_frame_path: str = ""
    source_frame_type: str = "last_frame"
    created_at: str = Field(default_factory=utc_now)


class FrameContinuitySettings(BaseModel):
    """Sequence Frame Continuity options (v1: extraction + card previews only).
    This module never starts rendering and never auto-uses previous frames."""
    save_last_frame: bool = True
    show_preview_in_cards: bool = True


class ClipOutputs(BaseModel):
    """Filenames (relative to the clip's own folder) of the rendered stages."""
    raw: str | None = None
    fx: str | None = None
    final: str | None = None
    preview: str | None = None
    archived: list[str] = Field(default_factory=list)


class SequenceClip(BaseModel):
    clip_id: str
    index: int = 0
    name: str = ""
    type: ClipType = ClipType.PROMPT_ONLY
    status: ClipStatus = ClipStatus.READY
    # Asset filename inside assets/images (image_reference clips only).
    source_image: str | None = None
    image_fit: str = "contain"  # contain | cover
    prompt: str = ""
    negative_prompt: str = ""
    use_global_generation_settings: bool = True
    generation_overrides: ClipGenerationOverrides = Field(default_factory=ClipGenerationOverrides)
    color_look_mode: ColorLookMode = ColorLookMode.GLOBAL
    custom_color_look: VideoEffects = Field(default_factory=VideoEffects)
    clip_audio_tracks: list[AudioTrack] = Field(default_factory=list)
    progress: int = Field(default=0, ge=0, le=100)
    stage: str = ""
    seed_used: int | None = None
    outputs: ClipOutputs = Field(default_factory=ClipOutputs)
    continuity_frame: ContinuityFrame = Field(default_factory=ContinuityFrame)
    created_from_frame: CreatedFromFrame | None = None
    diagnostics: dict | None = None
    last_error: str | None = None
    needs_regeneration_reason: str | None = None
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class SequenceRenderState(BaseModel):
    status: SequenceStatus = SequenceStatus.IDLE
    current_clip_id: str | None = None
    current_clip_index: int = 0
    clips_completed: int = 0
    clips_total: int = 0
    overall_progress: int = 0
    current_stage: str = ""
    can_resume: bool = False
    last_error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class SequenceOutputs(BaseModel):
    merged: str | None = None   # exports/merged/<name>_merged_video.mp4 (filename)
    final: str | None = None    # exports/final/<name>_final.mp4 (filename)


class SequenceCredits(BaseModel):
    application: str = "RadicaLab"
    concept_and_design: str = "Fabrizio Radica"
    project_by: str = "RadicaDesign"


class VideoSequence(BaseModel):
    schema_version: str = Field(default=SEQUENCE_SCHEMA, alias="schema")
    sequence_id: str
    project_type: str = "video_sequence"
    name: str
    folder: str
    description: str = ""
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)

    # Sequence Prompt Context: the shared visual/narrative context of the whole
    # sequence. The positive part lives here; the global NEGATIVE prompt reuses
    # the existing global_generation_settings.negative_prompt field (one prompt
    # system — no duplicate). Clip prompts are never overwritten by these.
    global_positive_prompt: str = ""

    # Selected video backend module for the whole sequence (§11). v1: global
    # only — every clip uses this backend; no per-clip backend override.
    # `backend_params` holds backend-specific values that are not already stored
    # in global_generation_settings (empty for Wan, whose params live there).
    backend_id: str = DEFAULT_BACKEND_ID
    backend_params: dict = Field(default_factory=dict)

    global_generation_settings: GlobalGenerationSettings = Field(default_factory=GlobalGenerationSettings)
    global_color_look: VideoEffects = Field(default_factory=VideoEffects)
    sequence_audio_tracks: list[AudioTrack] = Field(default_factory=list)
    frame_continuity: FrameContinuitySettings = Field(default_factory=FrameContinuitySettings)

    output_mode: OutputMode = OutputMode.CLIPS_ONLY
    vram_mode: VramMode = VramMode.BALANCED
    continue_on_error: bool = False

    clips: list[SequenceClip] = Field(default_factory=list)
    render_state: SequenceRenderState = Field(default_factory=SequenceRenderState)
    outputs: SequenceOutputs = Field(default_factory=SequenceOutputs)
    diagnostics: list[str] = Field(default_factory=list)
    credits: SequenceCredits = Field(default_factory=SequenceCredits)
    app_version: str = "1.0.0"

    model_config = {"populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def _migrate_prompt_context(cls, data):
        """Backward compatibility: an older/external sequence.json may carry a
        top-level `default_negative_prompt` (or `global_negative_prompt`). Load
        it into the canonical global_generation_settings.negative_prompt without
        touching clip prompts. Missing global_positive_prompt stays ''. """
        if isinstance(data, dict):
            legacy = data.pop("global_negative_prompt", None) or data.pop("default_negative_prompt", None)
            if isinstance(legacy, str) and legacy.strip():
                gs = data.get("global_generation_settings")
                if not isinstance(gs, dict):
                    gs = {}
                    data["global_generation_settings"] = gs
                if not (gs.get("negative_prompt") or "").strip():
                    gs["negative_prompt"] = legacy.strip()
            # Normalize a missing/empty backend id to the default (§11).
            bid = data.get("backend_id")
            if not (isinstance(bid, str) and bid.strip()):
                data["backend_id"] = DEFAULT_BACKEND_ID
            else:
                data["backend_id"] = bid.strip().lower()
        return data

    def reindex(self) -> None:
        for i, clip in enumerate(self.clips):
            clip.index = i

    def get_clip(self, clip_id: str) -> SequenceClip | None:
        return next((c for c in self.clips if c.clip_id == clip_id), None)

    def to_json_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)
