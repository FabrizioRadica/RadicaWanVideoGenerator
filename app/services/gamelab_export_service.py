"""GameLab standalone web export.

Builds a real, self-contained static web build under
<GAMELAB_ROOT>/<game_id>/exports/<slug>_web/ that plays WITHOUT RadicaLab/FastAPI:

    <slug>_web/
        index.html
        style.css
        game.js            (the shared runtime, copied verbatim)
        game_data.json     (the runtime data — relative paths only)
        assets/videos/  assets/images/  assets/audio/

Only media actually referenced by the game is copied. No source files, models,
temp files or unrelated projects are ever exported. The runtime uses relative
paths only and never calls a server API.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.config import logger
from app.services import gamelab_service
from app.services.gamelab_service import GameLabError

# The single source of truth for the browser runtime. Test Play loads this exact
# file too (served statically), so exported and in-app behaviour cannot diverge.
_EXPORT_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "static" / "export_templates" / "gamelab"
_RUNTIME_JS = _EXPORT_TEMPLATE_DIR / "game_runtime.js"
_RUNTIME_CSS = _EXPORT_TEMPLATE_DIR / "style.css"


def _render_index_html(title: str, game_data: dict) -> str:
    """Standalone index.html. It embeds game_data inline so it also works from a
    file:// URL (where fetch() is blocked), and still attempts to fetch the
    game_data.json file first when served over http."""
    safe_title = (title or "RadicaLab Game").replace("<", "&lt;").replace(">", "&gt;")
    # Escape "<" so user-controlled strings (title, scene names, media paths) can
    # never close the embedded <script> early and inject markup into the exported
    # standalone file. JSON.parse reads < back as "<". Mirrors Test Play.
    embedded = json.dumps(game_data, ensure_ascii=False).replace("<", "\\u003c")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="RadicaLab GameLab">
  <title>{safe_title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="game-root" class="rg-root"></div>
  <script type="application/json" id="rg-embedded-data">{embedded}</script>
  <script src="game.js"></script>
  <script>
    (function () {{
      function boot(data) {{
        RadicaGame.mount(document.getElementById("game-root"), data, {{}});
      }}
      var inline = JSON.parse(document.getElementById("rg-embedded-data").textContent);
      // Prefer the game_data.json file when served over http; fall back to the
      // inline copy for file:// (browsers block fetch on local files).
      try {{
        fetch("game_data.json").then(function (r) {{
          return r.ok ? r.json() : inline;
        }}).then(boot).catch(function () {{ boot(inline); }});
      }} catch (e) {{ boot(inline); }}
    }})();
  </script>
</body>
</html>
"""


def export_game(game_id: str) -> dict:
    project = gamelab_service.load_game(game_id)

    errors = gamelab_service.validate_game(project, for_export=True)
    if errors:
        raise GameLabError("Export blocked — fix these first:\n- " + "\n- ".join(errors))

    if not _RUNTIME_JS.exists() or not _RUNTIME_CSS.exists():
        raise GameLabError("GameLab runtime template is missing from the installation.")

    slug = gamelab_service.slugify(project.title)
    out_dir = (gamelab_service.game_dir(game_id) / "exports" / f"{slug}_web").resolve()
    # Fresh build every time.
    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "assets" / "videos").mkdir(parents=True, exist_ok=True)
    (out_dir / "assets" / "images").mkdir(parents=True, exist_ok=True)
    (out_dir / "assets" / "audio").mkdir(parents=True, exist_ok=True)

    # Copy only referenced, existing media (deduplicated by relative path).
    copied: list[str] = []
    for media_path in sorted({s.media_path for s in project.scenes if s.media_path}):
        src = gamelab_service.asset_abs_path(game_id, media_path)
        if src is None:
            raise GameLabError(f"Export failed because an asset is missing: {media_path}")
        dst = out_dir / media_path
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(media_path)

    game_data = project.runtime_data()
    (out_dir / "game_data.json").write_text(
        json.dumps(game_data, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / "index.html").write_text(
        _render_index_html(project.title, game_data), encoding="utf-8")
    shutil.copy2(_RUNTIME_JS, out_dir / "game.js")
    shutil.copy2(_RUNTIME_CSS, out_dir / "style.css")

    logger.info("GameLab exported '%s' -> %s (%d assets)", project.title, out_dir, len(copied))
    return {
        "export_dir": f"{slug}_web",
        "files": ["index.html", "style.css", "game.js", "game_data.json"],
        "assets_copied": copied,
        "asset_count": len(copied),
        "note": "Open index.html in a browser. Some browsers block video playback "
                "from file:// URLs — if so, serve the folder with any static web "
                "server (e.g. `python -m http.server` inside the export folder).",
    }
