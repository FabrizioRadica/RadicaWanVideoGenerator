# GameLab Template — Canvas2D Maze

**Template id:** `canvas2d_maze` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** top-down maze game for RadicaLab
GameLab. A game is fully described by one JSON file validated against
`schema.json`; the runtime engine is stable and is never rewritten per game.

## Structure

```text
canvas2d_maze/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ classic_maze.json      ("Crypt Escape")
  assets/fallback/
```

## Playing the example

Browsers block `fetch()` on `file://`, so serve over HTTP:

```text
cd gamelab_templates/canvas2d_maze
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** Arrow keys / WASD move · Enter starts/restarts.

## Configuration overview

See `schema.json`. Summary:

- `title`, `tile_size`, `theme {wall/floor/accent/hud/exit/collectible colors}`
- `map`: array of equal-length strings; `#` = wall, anything else = floor. Canvas
  size = `cols*tile_size` × `rows*tile_size`.
- `player_spawn` / `exit`: `{col,row}` (must be on floor tiles)
- `exit_requires_all_collectibles` (default false)
- `collectibles[]`, `keys[] {id,col,row,color}`, `doors[] {key_id,col,row,color}`
  — a door opens when its `key_id` is collected
- `enemies[] {col,row,behavior: patrol|chase, speed, color}`
- `player {speed,color}`, `score {collectible}`, `lives`, `assets`

Coordinates are validated to be inside the map and on walkable (non-wall) tiles;
`doors[].key_id` must match a defined key.

## Assets and fallbacks

`assets.sprites` maps `player` and `enemy` to **relative** paths under
`assets.base_path`. Missing/unloadable sprites are drawn procedurally — the game
always runs and never shows a broken image.

## Standalone export

An exported build is `runtime/` + a `game_config.json` (or inline
`<script type="application/json" id="rg-config">`) + any referenced `assets/`.
Relative paths only; no server calls at play time.

## Invalid configurations

`RadicaMaze.mount()` validates first and, on errors, renders a readable error
list instead of starting — no silent fallback game, no fake behavior.
