# GameLab Template — Canvas2D Pseudo-3D Racing

**Template id:** `canvas2d_pseudo3d_racing` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** pseudo-3D road racer (OutRun
style) for RadicaLab GameLab. It uses the classic projected-road-segment technique
— a track built from straight/curve/hill sections and projected each frame from a
chase camera to fake 3D on a flat 2D canvas (**no real 3D, no Three.js**). A game is
fully described by one JSON file validated against `schema.json`; the runtime engine
is stable and is never rewritten per game.

## Structure

```text
canvas2d_pseudo3d_racing/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ coast_highway.json      ("Coast Highway")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_pseudo3d_racing
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** ArrowUp/W accelerate · ArrowDown/S brake · Left/Right or A/D steer ·
Enter starts/restarts.

## Configuration overview

See `schema.json`. Summary:

- `title`, `canvas {width,height}`, `theme` (sky/grass/rumble/road/lane/hud colors)
- `road {segment_length, rumble_segments, road_width, lanes, draw_distance, fov, camera_height}`
- `car {max_speed, accel, brake, decel, off_road_decel, off_road_limit, centrifugal, steer, color}`
  — speeds are world units/sec; a good `max_speed` is roughly `segment_length * 60`
- `track[]`: ordered sections `{length (in segments), curve (−20..20), hill (elevation delta)}`
  built into the road; the track loops
- `laps` (default 1)
- `traffic {count, speed_factor}` (optional) — simple cars that loop the track; rear-ending one slows you

## Physics notes

Steering scales with speed (you can't steer while stopped); curves apply a
centrifugal push toward the outside; driving onto the grass (`|x| > 1`) caps and
bleeds speed. This is a lap **time trial** with optional traffic — there is no
branching route in v1.

## Assets and fallbacks

`assets.sprites` maps `car` and `traffic` to **relative** images; missing/unloadable
sprites are drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time.

## Invalid configurations

`RadicaOutrun.mount()` validates first and, on errors, renders a readable error list
instead of starting — no silent fallback game, no fake behavior.
