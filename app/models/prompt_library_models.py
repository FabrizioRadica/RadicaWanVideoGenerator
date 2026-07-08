"""Project-local Prompt Library data models (PATCH_ProjectPromptLibrary).

Three portable JSON asset types stored under `<app root>/prompts/`:

    single_clip_prompt   — a Single Clip positive/negative prompt asset
    sequence_preset      — a full VideoSequenceQueue preset (multiple clips)
    shared_negative_prompt — a reusable negative prompt

Plus a rebuildable `prompt_library_index/1` cache. These are pure state; the
`prompt_library_service` reads/writes them and integrates with the EXISTING
Single Clip fields and SequenceQueue model/service — it never duplicates them.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field

SINGLE_CLIP_SCHEMA = "single_clip_prompt/1"
SEQUENCE_PRESET_SCHEMA = "sequence_preset/1"
SHARED_NEGATIVE_SCHEMA = "shared_negative_prompt/1"
INDEX_SCHEMA = "prompt_library_index/1"

# type -> library subfolder (mirrored under trash/)
TYPE_DIRS = {
    "single_clip_prompt": "single_clips",
    "sequence_preset": "sequence_presets",
    "shared_negative_prompt": "shared_negative",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SingleClipPrompt(BaseModel):
    schema_version: str = Field(default=SINGLE_CLIP_SCHEMA, alias="schema_version")
    id: str = ""
    type: str = "single_clip_prompt"
    name: str = "Untitled Prompt"
    positive_prompt: str = ""
    negative_prompt: str = ""
    tags: list[str] = Field(default_factory=list)
    mode: str = "text2video"  # text2video | image2video
    model_hint: str = ""
    generation_settings: dict = Field(default_factory=dict)
    color_look: dict = Field(default_factory=dict)
    project_relative_image: str | None = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    source: str = "manual"
    notes: str = ""

    model_config = {"populate_by_name": True, "extra": "ignore"}


class SequencePresetClip(BaseModel):
    index: int = 0
    clip_name: str = ""
    clip_type: str = "prompt_only"  # prompt_only | image_reference
    duration: float = 4.0
    positive_prompt: str = ""
    negative_prompt: str = ""
    generation_overrides: dict = Field(default_factory=dict)
    color_look_mode: str = "global"  # global | custom | off
    custom_color_look: dict = Field(default_factory=dict)
    project_relative_image: str | None = None
    continuity_notes: str = ""
    ai_notes: str = ""

    model_config = {"extra": "ignore"}


class SequencePreset(BaseModel):
    schema_version: str = Field(default=SEQUENCE_PRESET_SCHEMA, alias="schema_version")
    id: str = ""
    type: str = "sequence_preset"
    name: str = "Untitled Sequence Preset"
    tags: list[str] = Field(default_factory=list)
    shared_negative_prompt: str = ""
    sequence_settings: dict = Field(default_factory=dict)
    clips: list[SequencePresetClip] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    source: str = "manual"
    notes: str = ""

    model_config = {"populate_by_name": True, "extra": "ignore"}


class SharedNegativePrompt(BaseModel):
    schema_version: str = Field(default=SHARED_NEGATIVE_SCHEMA, alias="schema_version")
    id: str = ""
    type: str = "shared_negative_prompt"
    name: str = "Untitled Negative"
    negative_prompt: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    source: str = "manual"
    notes: str = ""

    model_config = {"populate_by_name": True, "extra": "ignore"}


class PromptLibraryIndexItem(BaseModel):
    id: str
    type: str
    name: str
    path: str
    tags: list[str] = Field(default_factory=list)
    source: str = "manual"
    updated_at: str = ""
    preview: str = ""
    trashed: bool = False


class PromptLibraryIndex(BaseModel):
    schema_version: str = Field(default=INDEX_SCHEMA, alias="schema_version")
    updated_at: str = Field(default_factory=now_iso)
    items: list[PromptLibraryIndexItem] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


MODEL_FOR_TYPE = {
    "single_clip_prompt": SingleClipPrompt,
    "sequence_preset": SequencePreset,
    "shared_negative_prompt": SharedNegativePrompt,
}
