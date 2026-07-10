"""Home (project editor) and About pages."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.config import settings
from app.routes.shared import page_context, templates
from app.services import camera_motion_service, model_service, project_service

router = APIRouter()


def _editor_context(request: Request, project_id: str | None):
    projects = project_service.list_projects()
    current = None
    if project_id:
        try:
            current = project_service.load_project(project_id)
        except project_service.ProjectError:
            current = None
    if current is None and projects:
        try:
            current = project_service.load_project(projects[0].id)
        except project_service.ProjectError:
            current = None
    try:
        models = model_service.list_models()
    except model_service.ModelError:
        models = []
    return page_context(
        request,
        "videolab",
        projects=projects,
        current_project=current,
        current_project_json=current.to_wanproj_dict() if current else None,
        models=[m.model_dump(mode="json") for m in models],
        camera_options=camera_motion_service.get_options(),
        defaults={
            "resolution": f"{settings.default_resolution[0]}x{settings.default_resolution[1]}",
            "test_presets": {
                "test_low_landscape": settings.test_low_landscape,
                "test_low_portrait": settings.test_low_portrait,
                "test_quick_landscape": settings.test_quick_landscape,
                "test_quick_portrait": settings.test_quick_portrait,
            },
        },
    )


@router.get("/", response_class=HTMLResponse)
async def home(request: Request, project: str | None = None):
    return templates.TemplateResponse(request, "home.html", _editor_context(request, project))


@router.get("/about", response_class=HTMLResponse)
async def about(request: Request):
    return templates.TemplateResponse(request, "about.html", page_context(request, "about"))


# --- Planned modules (RadicaLab Modular Platform Shell) -----------------------
# These are honest, navigable "planned module" pages. They expose NO working
# tools, start no jobs, call no fake APIs and create no files. VideoLab is the
# only operational module in this shell; GameLab/AudioLab/RoboticsLab are future
# work. Do not turn these into fake editors/exporters/players.

_PLANNED_MODULES = {
    "game-lab": {
        "active": "gamelab",
        "title": "GameLab",
        "tagline": "Interactive web game tools are planned for a future release.",
        "intro": "GameLab will reuse videos, images, audio and assets generated inside "
                 "RadicaLab to build standalone interactive web games.",
        "items": [
            {"title": "Interactive Video Game Builder", "note": "Assemble branching interactive video experiences."},
            {"title": "Scene Flow", "note": "Connect scenes and outcomes into a playable flow."},
            {"title": "QTE Events", "note": "Quick-time events layered over generated video."},
            {"title": "Test Play", "note": "Play through a project inside RadicaLab."},
            {"title": "Standalone Web Export", "note": "Export a self-contained web build."},
        ],
        "footer": "The next planned patch will implement GameLab as a real interactive "
                  "web game builder. Nothing here is functional yet.",
    },
    "audio-lab": {
        "active": "audiolab",
        "title": "AudioLab",
        "tagline": "Audio tools are planned for a future release.",
        "intro": "AudioLab will provide reusable audio assets for video and game projects "
                 "across RadicaLab.",
        "items": [
            {"title": "Sound design", "note": None},
            {"title": "Music beds", "note": None},
            {"title": "Voiceover tools", "note": None},
            {"title": "Audio post-processing", "note": None},
            {"title": "Reusable audio assets", "note": "Shared across video and game projects."},
        ],
        "footer": "Audio post-processing for finished videos already lives inside VideoLab "
                  "(Audio Tracks). AudioLab as a standalone module is not implemented yet.",
    },
    "robotics-lab": {
        "active": "roboticslab",
        "title": "RoboticsLab",
        "tagline": "Robotics and simulation tools are planned for a future release.",
        "intro": "RoboticsLab will explore simulation and AI-controlled systems as a future "
                 "RadicaLab module.",
        "items": [
            {"title": "Simulation workflows", "note": None},
            {"title": "Robotics task planning", "note": None},
            {"title": "AI-controlled systems", "note": None},
            {"title": "Digital twin experiments", "note": None},
        ],
        "footer": "This module is a direction, not an implementation. No robotics "
                  "integration, simulation or ROS controls are available yet.",
    },
    "more-modules": {
        "active": "more-modules",
        "title": "More Modules",
        "tagline": "RadicaLab is a modular platform — more creative and technical modules are planned.",
        "intro": "VideoLab is the first operational module. Additional modules will be added "
                 "over time and will reuse assets generated across RadicaLab.",
        "items": [
            {"title": "GameLab", "note": "Interactive web game builder."},
            {"title": "AudioLab", "note": "Sound design and audio assets."},
            {"title": "RoboticsLab", "note": "Simulation and robotics workflows."},
        ],
        "footer": "The backend and module architecture is prepared for future modules. "
                  "No unavailable module is presented as functional.",
    },
}


def _planned_page(request: Request, slug: str):
    spec = _PLANNED_MODULES[slug]
    return templates.TemplateResponse(
        request,
        "planned_module.html",
        page_context(
            request,
            spec["active"],
            module_title=spec["title"],
            module_tagline=spec["tagline"],
            module_intro=spec["intro"],
            planned_items=spec["items"],
            module_footer=spec["footer"],
        ),
    )


@router.get("/game-lab", response_class=HTMLResponse)
async def game_lab(request: Request):
    return _planned_page(request, "game-lab")


@router.get("/audio-lab", response_class=HTMLResponse)
async def audio_lab(request: Request):
    return _planned_page(request, "audio-lab")


@router.get("/robotics-lab", response_class=HTMLResponse)
async def robotics_lab(request: Request):
    return _planned_page(request, "robotics-lab")


@router.get("/more-modules", response_class=HTMLResponse)
async def more_modules(request: Request):
    return _planned_page(request, "more-modules")
