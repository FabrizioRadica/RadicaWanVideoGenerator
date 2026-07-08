"""AI Prompt Assistant data models (AIPromptAssistantSequenceAutomationModule).

Pure state + validation for the optional, provider-based AI Prompt Assistant.
Nothing here reaches a network or renders anything — the services in
`app/services/ai_assistant/` consume these models.

The assistant is layered on top of the existing project without touching the
Single Clip editor, Generation Parameters, SequenceQueue model or render
pipeline (patch §2.1). It only *produces* prompts/plans and hands them to the
existing SequenceQueue via `sequence_service`.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

AI_ASSISTANT_SCHEMA = "ai_assistant_config/1"


class AssistantMode(str, Enum):
    SINGLE_CLIP = "single_clip"
    SEQUENCE = "sequence"


class AIProvider(str, Enum):
    OLLAMA = "ollama"
    LMSTUDIO = "lmstudio"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    DEEPSEEK = "deepseek"


# Provider-specific defaults (patch §3.2). Local providers need no key; cloud
# providers require one. Base URLs are the conventional local/cloud endpoints.
PROVIDER_DEFAULTS: dict[str, dict] = {
    AIProvider.OLLAMA.value: {
        "label": "Ollama",
        "base_url": "http://localhost:11434",
        "default_model": "llama3.1",
        "requires_key": False,
        "local": True,
        "supports_unload": True,
    },
    AIProvider.LMSTUDIO.value: {
        "label": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "default_model": "local-model",
        "requires_key": False,
        "local": True,
        "supports_unload": False,
    },
    AIProvider.OPENAI.value: {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "requires_key": True,
        "local": False,
        "supports_unload": False,
    },
    AIProvider.ANTHROPIC.value: {
        "label": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "default_model": "claude-sonnet-5",
        "requires_key": True,
        "local": False,
        "supports_unload": False,
    },
    AIProvider.DEEPSEEK.value: {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "requires_key": True,
        "local": False,
        "supports_unload": False,
    },
}


class PromptAssistantSettings(BaseModel):
    """patch §3.1 — global enable + entry-point + apply behavior."""
    enabled: bool = False
    default_mode: AssistantMode = AssistantMode.SINGLE_CLIP
    show_button_single_clip: bool = True
    show_button_sequence: bool = True
    auto_apply_prompts: bool = False
    require_confirmation_sequence: bool = True


class AIProviderSettings(BaseModel):
    """patch §3.2 — selected provider + common fields."""
    provider: AIProvider = AIProvider.OLLAMA
    model_name: str = ""
    base_url: str = ""
    api_key: str = ""
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    timeout_seconds: int = Field(default=120, ge=5, le=1200)
    system_prompt_override: str = ""

    def effective_base_url(self) -> str:
        url = (self.base_url or "").strip()
        if url:
            return url.rstrip("/")
        return PROVIDER_DEFAULTS[self.provider.value]["base_url"].rstrip("/")

    def effective_model(self) -> str:
        name = (self.model_name or "").strip()
        return name or PROVIDER_DEFAULTS[self.provider.value]["default_model"]

    def is_local(self) -> bool:
        return bool(PROVIDER_DEFAULTS[self.provider.value]["local"])

    def requires_key(self) -> bool:
        return bool(PROVIDER_DEFAULTS[self.provider.value]["requires_key"])

    def supports_explicit_unload(self) -> bool:
        return bool(PROVIDER_DEFAULTS[self.provider.value]["supports_unload"])


class AIResourceSettings(BaseModel):
    """patch §3.3 — memory/GPU protection so WAN always has VRAM/RAM."""
    release_after_generation: bool = True
    block_during_render: bool = True
    allow_during_render: bool = False  # explicit override of block_during_render (§5.2)
    warn_high_vram: bool = True
    warn_high_ram: bool = True
    min_free_vram_gb: float | None = None
    min_free_ram_gb: float | None = None
    min_free_vram_for_render_gb: float | None = None
    min_free_ram_for_render_gb: float | None = None
    cooldown_after_release_seconds: float = Field(default=1.5, ge=0.0, le=60.0)


class AudioFeedbackSettings(BaseModel):
    """patch §3.4 — reusable UI sound feedback settings."""
    enabled: bool = True
    volume: float = Field(default=0.7, ge=0.0, le=1.0)
    on_single_clip_complete: bool = True
    on_sequence_complete: bool = True
    on_ai_sequence_created: bool = True
    on_warning: bool = False
    on_error: bool = True


class AIAssistantConfig(BaseModel):
    """Full persisted configuration (patch §12)."""
    schema_version: str = Field(default=AI_ASSISTANT_SCHEMA, alias="schema")
    prompt_assistant: PromptAssistantSettings = Field(default_factory=PromptAssistantSettings)
    provider: AIProviderSettings = Field(default_factory=AIProviderSettings)
    resources: AIResourceSettings = Field(default_factory=AIResourceSettings)
    audio_feedback: AudioFeedbackSettings = Field(default_factory=AudioFeedbackSettings)

    model_config = {"populate_by_name": True}

    def to_json_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)

    def safe_dict(self) -> dict:
        """Config for the UI with the API key redacted (patch §12 — keys handled
        carefully and never echoed back to the browser)."""
        data = self.to_json_dict()
        key = self.provider.api_key or ""
        data["provider"]["api_key"] = ""
        data["provider"]["api_key_set"] = bool(key.strip())
        return data


# --------------------------------------------------------------------------
# Generation results (patch §7)
# --------------------------------------------------------------------------

class SingleClipPromptResult(BaseModel):
    positive_prompt: str = ""
    negative_prompt: str = ""
    notes: str = ""
    raw: str = ""
    parsed_json: bool = False


class ClipPlanType(str, Enum):
    TEXT2VIDEO = "Text2Video"
    IMAGE2VIDEO = "Image2Video"


class SequencePlanClip(BaseModel):
    clip_name: str = ""
    clip_type: ClipPlanType = ClipPlanType.TEXT2VIDEO
    positive_prompt: str = ""
    negative_prompt: str = ""
    duration_seconds: float = Field(default=4.0, ge=0.1, le=120.0)
    camera_notes: str = ""
    motion_notes: str = ""
    continuity_notes: str = ""
    image_reference_required: bool = False


class SequencePlan(BaseModel):
    sequence_title: str = ""
    global_style: str = ""
    global_negative_prompt: str = ""
    clips: list[SequencePlanClip] = Field(default_factory=list)
    raw: str = ""
    parsed_json: bool = False
