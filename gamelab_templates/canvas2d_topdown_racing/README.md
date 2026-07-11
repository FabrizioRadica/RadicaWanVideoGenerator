# GameLab Template — Canvas2D Top-down Racing

**Template id:** `canvas2d_topdown_racing` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** top-down time-trial racing game
for RadicaLab GameLab. The whole track is shown at once; drive a car through
ordered checkpoints for a number of laps against the clock. A game is fully
described by one JSON file validated against `schema.json`; the runtime engine is
stable and is never rewritten per game.

## Structure

```text
canvas2d_topdown_racing/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ circuit_time_trial.json      ("Neon Circuit")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_topdown_racing
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** ArrowUp/W accelerate · ArrowDown/S brake & reverse · Left/Right or
A/D steer · Enter starts/restarts.

## Configuration overview

See `schema.json`. Summary:

- `title`, `tile_size`, `theme {road/wall/grass/accent/hud colors}`
- `map`: equal-length strings; `#` = wall (stops the car), `.` = road, any other
  char (e.g. `g`) = grass (drivable but speed-capped)
- `start {col,row,heading_deg}` (0° faces +x / right)
- `checkpoints[]`: ordered `{col,row}`, **index 0 is the start/finish line**. A lap
  completes after crossing every checkpoint in order and returning to index 0.
- `laps` (number to finish)
- `car {width,length,accel,max_speed,grass_max_speed,brake,turn_rate (rad/s),friction (0..1 coast decay),color}`
- `assets`

Start and every checkpoint are validated to be on non-wall tiles.

## Physics notes

Steering scales with speed (you can't spin in place) and works in reverse. Grass
caps the car's speed; hitting a wall kills momentum on that axis. This is a **time
trial** — there are no AI opponents in v1.

## Assets and fallbacks

`assets.sprites.car` may map to a **relative** image; a missing/unloadable sprite is
drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time.

## Invalid configurations

`RadicaRacer.mount()` validates first and, on errors, renders a readable error list
instead of starting — no silent fallback game, no fake behavior.
