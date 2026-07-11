# GameLab Template — Canvas2D Endless Top-down

**Template id:** `canvas2d_endless_topdown` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** endless top-down survival/dodger
for RadicaLab GameLab. The world scrolls downward; you move freely in 2D to dodge
obstacles and grab pickups while the difficulty ramps. A game is fully described by
one JSON file validated against `schema.json`; the runtime engine is stable and is
never rewritten per game.

## Structure

```text
canvas2d_endless_topdown/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ highway_dodge.json      ("Highway Dash")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_endless_topdown
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** Arrow keys / WASD move · Enter starts/restarts. There is no shooting —
survival is by dodging.

## Configuration overview

See `schema.json`. Summary:

- `title`, `canvas {width,height}`, `theme`
- `player {width,height,speed,hitbox_scale,color}`
- `scroll {speed}` — base downward world speed (scaled by the difficulty ramp)
- `obstacles[] {id,width,height,color,speed_bonus}` — spawned from the top
- `spawn {interval, min_interval}` — seconds between obstacles; interval shrinks as
  difficulty ramps, floored at `min_interval`
- `pickups[] {id,size,effect: score|extra_life,score,spawn_interval,color}`
- `lives`, `score {distance_per_second}`, `difficulty {ramp, max_ramp}`, `assets`

## Assets and fallbacks

`assets.sprites` maps `player`, `obstacle_<id>`, `pickup_<id>` to **relative** paths.
Missing sprites are drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time.

## Invalid configurations

`RadicaEndless.mount()` validates first and, on errors, renders a readable error
list instead of starting — no silent fallback game, no fake behavior.
