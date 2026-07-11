# RadicaLab · Local AI Creative Studio

**Alpha RC 1.2 — experimental local AI creative platform**

```text
RadicaLab
Local AI Creative Studio
Concept & Design: Fabrizio Radica
Project by RadicaDesign
```

RadicaLab is a modular, local-first creative platform for AI-assisted video generation, prompt workflows, post-processing, interactive web games, Canvas2D game generation and future experimental modules.

The project started as **Radica - WanVideoGenerator**, a local browser-based video generation tool focused on Wan 2.2. It is now evolving into **RadicaLab**, a broader modular platform where Wan is no longer the identity of the application, but one selectable video backend inside **VideoLab**.

---

## Development status

RadicaLab is currently distributed as:

```text
Alpha RC 1.2
```

This means the application is usable and many systems are already functional, but the project is still in active research and development.

Some modules, workflows, UI sections, parameters, templates or internal behaviors may change before the final release. Some experimental features may be renamed, replaced, redesigned, merged, removed or made unavailable in later builds if they are not stable enough or no longer fit the platform direction.

This project should be considered a working research platform, not a finished commercial product.

Important expectations:

```text
- features are evolving;
- compatibility may change;
- template schemas may change;
- UI organization may change;
- exported formats may be refined;
- some experimental modules may be temporary;
- some features may require manual testing and validation;
- generated games and videos may need iteration.
```

The core rule remains unchanged:

```text
No fake generation.
No fake export.
No fake preview.
No placeholder output presented as real functionality.
```

If something is not implemented, it should be clearly reported as not implemented.

---

## Platform vision

RadicaLab is designed as a modular local AI creative studio.

The long-term direction is:

```text
RadicaLab
  VideoLab
    Single Clip
    Sequence Queue
    Modular video backends
      Wan 2.2
      Future LTX Video 2.3+
      Future video engines

  GameLab
    QTE Games
    AI Game Generator
    Canvas2D Template Repository
    Standalone browser game export

  AudioLab
    Audio post-processing
    Future voice/music/audio tools

  RoboticsLab
    Future simulation / robotics experiments

  Workspace
    Projects
    Library
    Models
    Workflows
    Settings
```

RadicaLab is not meant to become a random collection of tools. The goal is to create a coherent local production environment where modules can share projects, assets, models, media, prompts and exports.

---

## Core principles

- **Local-first**: the main workflow is designed to run on the user's machine.
- **Modular**: Wan, LTX or other engines must be treated as modules/backends, not as the whole application.
- **Real functionality only**: no fake preview, no fake export, no fake generated output.
- **No heavy frontend stack**: no Node, no npm, no React, no Vue, no Angular, no Svelte, no Electron, no Tauri.
- **Server-rendered web UI**: FastAPI, templates, CSS and vanilla JavaScript.
- **Patch-friendly development**: changes should be incremental, reviewable and tracked.
- **Backend honesty**: requested and effective parameters must be visible and diagnosable.
- **Safe local files**: projects, outputs and exports should use controlled local folders and relative paths where possible.
- **User control**: AI assistants may help generate prompts, plans or configurations, but they should not secretly start renders or rewrite engines.

---

## Current modules

### VideoLab

VideoLab is the current production-oriented video module.

It contains:

```text
Single Clip
Sequence Queue
AI Prompt Assistant
Color & Look
Audio Tracks
Model Bundles
Backend diagnostics
ComfyUI workflow export
System/resource monitor
```

The current active video backend is Wan 2.2, but it should be treated as:

```text
Video backend: Wan 2.2
```

not as the application identity.

Future video engines such as LTX Video 2.3+ should be integrated through the modular backend layer instead of duplicating or rewriting the app.

---

### GameLab

GameLab is the experimental game-development module inside RadicaLab.

It currently has two main areas:

```text
QTE Games
AI Game Generator
```

#### QTE Games

QTE Games is an interactive video game builder.

It allows the user to create simple nostalgic browser games based on:

```text
video scenes
image scenes
QTE events
success targets
failure targets
scene flow
test play
standalone web export
```

Typical use case:

```text
VideoLab generates cinematic clips
GameLab imports those clips as scenes
The user adds QTE logic and branching flow
GameLab exports a standalone browser game
```

QTE Games is intended for Dragon's Lair / laserdisc-style interactive video experiences.

The exported game should be a browser build, not a Python application.

---

#### AI Game Generator

AI Game Generator is the experimental prompt-to-game area.

The goal is to generate complete 2D browser games from a natural language prompt, using controlled Canvas2D templates.

Example prompt:

```text
Create a retro horizontal arcade shooter with box enemies, power-ups, score, lives and increasing waves.
```

The intended flow is:

```text
user prompt
↓
selected Canvas2D template
↓
AI provider
↓
generated JSON configuration
↓
schema validation
↓
runtime build
↓
test play
↓
standalone web export
```

Important limitation:

```text
The AI must generate validated configuration data.
It must not freely rewrite the game runtime by default.
```

This keeps the system safer and more predictable, especially when using local LLMs.

---

## GameLab Template Repository

GameLab can use an internal template repository:

```text
gamelab_templates/
```

Templates are discovered from the folders inside this repository. The system should not hardcode each template name manually.

A template may contain:

```text
template.json
schema.json
generation_rules.md
validation_rules.md
README.md
examples/
runtime/
assets/
```

Each template defines what the AI is allowed to generate and what the runtime can actually execute.

Examples of possible template categories:

```text
Canvas2D Horizontal Shooter
Canvas2D Vertical Shooter
Canvas2D Maze
Canvas2D Rogue-like
Canvas2D Platformer
Canvas2D Lane Runner
Interactive Video QTE
```

The templates are controlled, reusable and config-driven.

A generated game should be based on:

```text
template runtime
validated game_config.json
local assets or procedural fallback sprites
```

not on arbitrary runtime code generated by the LLM.

---

## Canvas2D game export

GameLab browser games are intended to export as standalone static builds:

```text
index.html
style.css
game_runtime.js
game_config.json
assets/
```

The exported game must not require:

```text
Python
FastAPI
RadicaLab running in background
Node
npm
React
Vue
Angular
Svelte
Electron
Tauri
```

For local testing, you may still need to serve the exported folder through a simple static server because browsers can block JSON/media loading from `file://`.

Example:

```bash
cd exported_game_folder
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/
```

Python is used only as a static server for testing. The exported game itself remains HTML/CSS/JavaScript.

---

## AI Assistant and providers

RadicaLab includes an optional AI Assistant provider layer.

It can be used for:

```text
Single Clip prompt generation
Sequence planning
GameLab prompt-to-config generation
future module-specific assistants
```

Supported provider direction:

```text
Ollama
LM Studio / OpenAI-compatible local endpoint
OpenAI
Anthropic
DeepSeek
```

The exact provider list depends on the current build and configuration.

Local LLMs can consume RAM and sometimes VRAM. When video generation is running, the app should respect resource-management rules and avoid overloading the machine.

Provider calls should be routed through the shared AI Assistant/provider abstraction. GameLab must not create a separate hardcoded provider system.

---

## VideoLab: Single Clip

Single Clip is the stable video workflow.

Typical pipeline:

```text
prompt / negative prompt
generation settings
selected backend
model bundle
render
preview
Color & Look
Audio Tracks
final output
```

Supported flow includes Text2Video and Image2Video depending on the selected backend and model bundle.

The raw generated video is never modified directly. Post-processing creates derived output files.

---

## VideoLab: Sequence Queue

Sequence Queue allows ordered multi-clip video generation.

A sequence can contain:

```text
prompt-only clips
image-reference clips
per-clip prompts
per-clip audio
per-clip Color & Look
global generation settings
global sequence audio
optional final merge
```

The queue renders sequentially:

```text
Clip 01
then Clip 02
then Clip 03
...
```

This is safer for VRAM/RAM than rendering multiple clips at once.

Stop/resume behavior should preserve completed clips and allow regeneration/resume from the interrupted clip.

---

## Color & Look

Color & Look is ffmpeg-based post-processing.

It can include controls such as:

```text
saturation
contrast
brightness
gamma
temperature
shadows
highlights
vignette
film grain
sharpness
VHS effect
```

It creates a new processed output and does not overwrite the raw generated video.

---

## Audio Tracks

Audio Tracks is a post-processing system.

It can be used for:

```text
clip ambience
sound effects
music beds
sequence-wide audio
voiceover workflows in future
```

In sequences:

```text
Clip Audio Tracks
→ applied before merge

Sequence Audio Tracks
→ applied after merge
```

---

## Models

The Models area is intended to manage local model bundles and backend-specific model assets.

For VideoLab, current production usage is Wan-oriented.

Future direction:

```text
Video models
LLM models
Audio models
Game-related assets/models
Backend-specific model registries
```

Model support must remain honest. The UI should not claim that a backend or model type is usable unless there is real support for it.

---

## Library

The Library is intended to become a shared asset browser for RadicaLab.

It may include:

```text
generated videos
sequence outputs
images
audio
GameLab media
exports
future assets
```

GameLab should be able to import real media assets from Library / VideoLab / Sequence Queue when needed.

Library items must represent real files, not fake placeholders.

---

## Workflows

Workflows are reusable generation or export structures.

Current direction includes:

```text
ComfyUI workflow export
generation metadata
future reusable pipelines
template/runtime workflows
```

Workflow functionality should remain tied to real exportable data.

---

## Settings

Settings are global to RadicaLab and may include module-specific sections.

Important settings areas include:

```text
General
VideoLab
AI Assistant
Models
System
Advanced
```

Sensitive values such as API keys should not be echoed back into the browser in plain text.

---

## System monitor

The top bar may show:

```text
CPU
RAM
GPU
VRAM
Disk usage / free space
backend readiness
AI status
```

If monitoring fails, generation should not fail just because the monitor is unavailable.

---

## Stack

RadicaLab uses:

```text
Python
FastAPI
Jinja2 / server-rendered templates
CSS
Vanilla JavaScript
ffmpeg / imageio-ffmpeg
PyTorch
diffusers
transformers
safetensors
```

Hard constraints:

```text
No Node
No npm
No React
No Vue
No Angular
No Svelte
No Electron
No Tauri
```

---

## Requirements

### Hardware

| Component | Minimum | Recommended |
|---|---:|---:|
| GPU | NVIDIA GPU, 8 GB VRAM with offload | NVIDIA RTX, 12 GB+ VRAM |
| RAM | 16 GB | 32 GB |
| Disk | 25 GB+ free for video models | SSD with generous free space |

GameLab Canvas2D exported games are lightweight and do not need a GPU to play. Video generation does.

### Software

- Python 3.10+
- Python 3.11 recommended
- NVIDIA driver compatible with your PyTorch CUDA build
- ffmpeg
- Python packages from `requirements.txt`

---

## Installation

### 1. Clone or copy the repository

```bash
git clone <your-repo-url> RadicaLab
cd RadicaLab
```

### 2. Create a virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Linux/macOS:

```bash
python -m venv .venv
source .venv/bin/activate
```

### 3. Install PyTorch CUDA first

Example for CUDA 12.8:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu128
```

Check CUDA:

```bash
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

### 4. Install project dependencies

```bash
pip install -r requirements.txt
```

### 5. Configure `.env`

Copy the example:

```bash
cp .env.example .env
```

On Windows CMD:

```bat
copy .env.example .env
```

Then edit `.env` according to your machine and backend configuration.

### 6. Add model files

Put your video model files under `models/` or another stable local folder and register them through the app if supported.

### 7. Start RadicaLab

Preferred:

```bash
python -m app.main
```

Alternative:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

---

## Quick start: VideoLab

1. Open RadicaLab.
2. Select **VideoLab**.
3. Use **Single Clip** for one video or **Sequence Queue** for multiple clips.
4. Select a backend/model bundle.
5. Write prompts or use the AI Prompt Assistant.
6. Render.
7. Apply Color & Look and Audio Tracks if needed.
8. Export or save outputs.

---

## Quick start: GameLab QTE Games

1. Open **GameLab**.
2. Select **QTE Games**.
3. Create or open a game.
4. Import video/image scenes from Library or VideoLab outputs.
5. Configure QTE keys, success targets and failure targets.
6. Use **Test Play**.
7. Export the browser build.

---

## Quick start: GameLab AI Game Generator

1. Open **GameLab**.
2. Select **AI Game Generator**.
3. Select a Canvas2D template from the Template Repository.
4. Write a game prompt.
5. Select an AI provider/model.
6. Generate the game configuration.
7. Validate the schema.
8. Build the game.
9. Use Test Play.
10. Export the standalone web build.

Experimental note:

```text
The generated config may need refinement.
Local LLMs may produce valid but unbalanced gameplay.
Some features requested in the prompt may be adapted to the selected template capabilities.
```

---

## Troubleshooting

### Exported GameLab game does not open by double-click

Some browsers block local JSON/media loading from `file://`.

Use a static server:

```bash
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/
```

### AI generated config is invalid

The AI may produce values outside the template schema.

Use validation messages to correct the JSON or regenerate with a clearer prompt.

Future builds may include stronger repair and capability-matching systems.

### Prompt asks for unsupported features

If a selected template does not support a requested feature, the system should adapt it safely or warn you.

Example:

```text
tilemap requested in a shooter template
→ adapted to parallax/background layers if possible
```

Unsupported features must not be faked.

### Too many enemy bullets or unbalanced gameplay

This usually means the generated configuration is valid but poorly balanced.

Adjust enemy fire rate, wave count, enemy classes or generation rules.

### Backend not ready

Check CUDA, PyTorch, `.env`, model paths and backend status.

### Model file not found

Check exact file paths and spelling.

### AI provider unreachable

Check that Ollama / LM Studio is running, or that API keys and base URLs are correctly configured.

---

## Known limitations in Alpha RC 1.2

- GameLab AI generation is experimental.
- Template schemas may change.
- Some templates may be incomplete or under active testing.
- Local LLM output quality depends heavily on the selected model.
- Generated games may require manual balancing.
- Test Play and export behavior may differ while templates are being refined.
- Some VideoLab backend modularization work is still in progress.
- LTX Video support is a future direction unless explicitly available in your build.
- AudioLab and RoboticsLab are roadmap modules, not guaranteed production features.
- UI layout and module naming may still change.
- Some features visible in development builds may not be present in final releases.

---

## Failure behavior

If something fails, RadicaLab should fail clearly.

No placeholder videos.
No fake game export.
No fake preview.
No fake AI success.
No hidden fallback presented as the requested output.

---

## Disclaimer

This project is provided as is, without any warranty regarding functionality, stability, compatibility, or safety on your system.

I do not accept any responsibility, in any way, for any damage, malfunction, instability, data loss, crashes, overheating, melting, or even partial failure of GPUs, CPUs, power supplies, motherboards, drives, RAM, or any other hardware component, past, present, or future.

Installation, configuration, and execution of this project are entirely at your own risk and under your full responsibility.

Use it as you see fit, according to your technical skills and the limits of your hardware.

By downloading, installing, or running this project, you declare that you have read, understood, and fully accepted this disclaimer.

---

## Credits

```text
RadicaLab
Local AI Creative Studio
Concept & Design: Fabrizio Radica
Project by RadicaDesign
```

## Please Donate

https://www.paypal.com/donate/?hosted_button_id=TTBHUJ7CFE78N

RadicaLab currently builds on the shoulders of Python, FastAPI, PyTorch, ffmpeg, Hugging Face diffusers, Wan 2.2 and the broader open-source AI ecosystem.
