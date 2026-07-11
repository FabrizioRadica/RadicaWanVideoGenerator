# GameLab Template — Canvas2D Lane Runner

**Template id:** `canvas2d_lane_runner` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** endless lane runner (Subway
Surfers style) for RadicaLab GameLab, drawn with a simple pseudo-3D forward
perspective (lanes converging to a horizon). A game is fully described by one JSON
file validated against `schema.json`; the runtime engine is stable and is never
rewritten per game.

## Structure

```text
canvas2d_lane_runner/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ city_runner.json      ("Neon Sprint")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_lane_runner
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** ←/→ (A/D) switch lane · ↑/Space jump · ↓/S duck · Enter starts/restarts.

## Obstacle types

- `jump` — a low barrier: **jump over** it (Up) or it hits you.
- `duck` — an overhead bar: **duck under** it (Down) or it hits you.
- `block` — a full block: you **cannot** jump or duck it; **change lane**.

Coins are collected when you are in their lane as they reach you.

## Configuration overview

See `schema.json`. Summary:

- `title`, `canvas {width,height}`, `theme`
- `lanes` (2–6), optional `draw_distance`
- `player {width,height,color,jump_duration,duck_duration}`
- `speed {base, ramp, max}` — forward world speed (ramps with time)
- `obstacles[] {id,type: jump|duck|block,width,color}`
- `spawn {interval_distance, obstacle_chance, coin_chance}`
- `coins {value,color}`, `lives`, `score {distance_per_unit}`, `assets`

## Assets and fallbacks

`assets.sprites` maps `player`, `coin`, `obstacle_<id>` to **relative** paths.
Missing sprites are drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time. Pseudo-3D here means a flat 2D projection
— there is no real 3D and no Three.js.

## Invalid configurations

`RadicaRunner.mount()` validates first and, on errors, renders a readable error list
instead of starting — no silent fallback game, no fake behavior.
