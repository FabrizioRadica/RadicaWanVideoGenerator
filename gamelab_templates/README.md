# GameLab Template Repositories

Controlled, reusable, **config-driven** browser game templates for RadicaLab
GameLab. Each template ships a stable vanilla-JS runtime, a JSON Schema, a
working example configuration, generation/validation rules and documentation.
Generators (LLM or tooling) produce validated JSON configurations only — they
never rewrite a template's runtime engine. Every template is standalone-export
compatible (HTML/CSS/JS, relative paths, no server calls).

## Available templates

| Template id | Status | Description |
|---|---|---|
| `canvas2d_vertical_shooter` | available | Vertical scrolling arcade shooter (waves, patterns, power-ups) |
| `canvas2d_horizontal_shooter` | available | Horizontal side-scroller (parallax, formations, enemy fire patterns) |
| `canvas2d_maze` | available | Top-down maze: wall-collision movement, collectibles, keys/doors, patrol/chase enemies, exit |
| `canvas2d_roguelike` | available | Turn-based top-down rogue-like: bump-to-attack combat, HP, treasure, potions, keys/doors |
| `canvas2d_topdown_racing` | available | Top-down time-trial: car physics, tile track, ordered checkpoints, laps, lap timer |
| `canvas2d_endless_topdown` | available | Endless top-down survival/dodger: scrolling world, obstacles, pickups, difficulty ramp |
| `canvas2d_flappy` | available | Flappy-style: gravity + tap-to-flap, scrolling pipe gaps, score per pipe |
| `canvas2d_lane_runner` | available | Endless lane runner (Subway Surfers style): pseudo-3D lanes, jump/duck/switch, coins |
| `canvas2d_pseudo3d_racing` | available | Pseudo-3D road racer (OutRun style): projected road segments, curves/hills, laps, traffic |
| `canvas2d_space_scroller` | available | Space cave-flyer: parallax starfields, scrolling tilemap level with wall collision, hazards, collectibles |

## Planned templates (not implemented)

Per `GameLab_Template_Prompts.md`: `canvas2d_platformer`, and the formalization of
`interactive_video_qte` (whose runtime currently lives in
`app/static/export_templates/gamelab/`). Also open: wiring these template
repositories into the GameLab UI/service so users can pick a template, edit its
config and export a build.

## Layout convention

```text
gamelab_templates/<template_id>/
  template.json        metadata: capabilities, entry, constraints
  schema.json          JSON Schema for game configurations
  README.md            usage and configuration overview
  generation_rules.md  rules for config generators (LLM/tooling)
  validation_rules.md  schema + runtime validation checklist
  runtime/             index.html, style.css, game_runtime.js
  examples/            at least one working example config
  assets/fallback/     optional static fallbacks (procedural ones are code-drawn)
```

## start:
python -m http.server 8080
http://127.0.0.1:8080/runtime/

Concept & Design: Fabrizio Radica — Project by RadicaDesign
