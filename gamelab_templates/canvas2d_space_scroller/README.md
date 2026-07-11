# GameLab Template — Canvas2D Space Scroller

**Template id:** `canvas2d_space_scroller` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** space cave-flyer for RadicaLab
GameLab: pilot a ship with inertial thrust through a **scrolling tilemap level with
real wall collision**, over **multi-layer parallax starfields**. A game is fully
described by one JSON file validated against `schema.json`; the runtime engine is
stable and is never rewritten per game.

## Structure

```text
canvas2d_space_scroller/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ asteroid_cavern.json      ("Asteroid Cavern")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_space_scroller
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** Arrow keys / WASD thrust · Enter starts/restarts. The ship has inertia
(space drift) — tap against your direction of travel to slow down.

## How it works

- The level is a **tilemap**: `#` = solid wall (blocks the ship), the `hazard_char`
  (default `X`) = hazard (crashes the ship), anything else = open space. Out-of-bounds
  counts as solid.
- The **camera** follows the ship and is clamped to the level, so parallax layers
  scroll behind at their configured fractional speeds for depth.
- **Collision** is resolved per-axis (AABB): the ship slides along walls and cannot
  pass through them; touching a hazard costs a life and respawns at the start with
  brief invulnerability.
- Fly over **collectibles** for score; reach the **exit** tile to clear the level.

## Configuration overview

See `schema.json`. Summary:

- `title`, `canvas {width,height}`, `tile_size`, optional `hazard_char`, `theme`
- `map`: equal-length strings (`#` wall / hazard char / open)
- `player_spawn`, `exit` `{col,row}` (must be open tiles); `exit_requires_all_collectibles`
- `collectibles[] {col,row}`
- `ship {width,height,thrust,max_speed,damping,hitbox_scale,color}`
- `parallax[] {type: stars|color, speed, density, size, alpha, color}`
- `lives`, `score {collectible}`, `assets`

## Assets and fallbacks

`assets.sprites` maps `ship` and `collectible` to **relative** paths; missing sprites
are drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time.

## Invalid configurations

`RadicaSpace.mount()` validates first and, on errors, renders a readable error list
instead of starting — no silent fallback game, no fake behavior.
