# GameLab Template — Canvas2D Flappy

**Template id:** `canvas2d_flappy` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** "flap through the gaps" arcade
game (Flappy Bird style) for RadicaLab GameLab. A game is fully described by one
JSON file validated against `schema.json`; the runtime engine is stable and is
never rewritten per game.

## Structure

```text
canvas2d_flappy/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ classic_flappy.json      ("Sky Hopper")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_flappy
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** Space / ArrowUp / Enter or click to flap (and to start/restart).

## Configuration overview

See `schema.json`. Summary:

- `title`, `canvas {width,height}`, `theme {background/ground/hud/accent colors}`
- `gravity` (px/s² pull down), `flap_velocity` (upward impulse on tap)
- `bird {width,height,x,color}`
- `pipes {gap, width, spacing (horizontal distance between pipes), speed, color}`
- `lives` (default 1), `score_per_pipe` (default 1), `assets`

Validation ensures the gap is large enough for the bird to pass
(`gap > bird.height * 1.5`) and all numbers are safe.

## Assets and fallbacks

`assets.sprites` maps `bird`, `pipe`, `background` to **relative** paths under
`assets.base_path`. Missing/unloadable sprites are drawn procedurally — the game
always runs and never shows a broken image.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`.
Relative paths only, no server calls at play time.

## Invalid configurations

`RadicaFlappy.mount()` validates first and, on errors, renders a readable error
list instead of starting — no silent fallback game, no fake behavior.
