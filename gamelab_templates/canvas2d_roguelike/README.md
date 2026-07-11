# GameLab Template — Canvas2D Rogue-like

**Template id:** `canvas2d_roguelike` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** turn-based top-down rogue-like
for RadicaLab GameLab. A game is fully described by one JSON file validated
against `schema.json`; the runtime engine is stable and is never rewritten per game.

## Structure

```text
canvas2d_roguelike/
  template.json  schema.json  README.md  generation_rules.md  validation_rules.md
  runtime/ index.html  style.css  game_runtime.js
  examples/ dungeon_roguelike.json      ("Depths of Varrow")
  assets/fallback/
```

## Playing the example

```text
cd gamelab_templates/canvas2d_roguelike
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

**Controls:** Arrow keys / WASD step (turn-based) · step into an enemy to attack ·
Enter starts/restarts.

## How turns work

Each key press moves the player one tile **or** attacks an adjacent enemy you step
into; then every enemy takes one step (or attacks you if adjacent). This is the
core rogue-like loop — deliberate, turn-based, no real-time reflexes.

## Configuration overview

See `schema.json`. Summary:

- `title`, `tile_size`, `theme`
- `map`: equal-length strings; `#` = wall, else floor
- `player_spawn` / `exit` `{col,row}`; `exit_requires_all_treasure` (default false)
- `player {max_hp, attack, color}`
- `treasure[] {col,row,value}` (score), `potions[] {col,row,heal}` (HP),
  `keys[] {id,col,row,color}`, `doors[] {key_id,col,row,color}`
- `enemies[] {id,name,col,row,hp,damage,score,behavior: wander|chase,sight,color}`

Coordinates are validated to be inside the map and on floor tiles; `doors[].key_id`
must match a key id.

## Assets and fallbacks

`assets.sprites` maps `player` and `enemy_<id>` to **relative** paths. Missing
sprites are drawn procedurally — the game always runs.

## Standalone export

`runtime/` + `game_config.json` (or inline config) + referenced `assets/`. Relative
paths only, no server calls at play time.

## Invalid configurations

`RadicaRogue.mount()` validates first and, on errors, renders a readable error list
instead of starting — no silent fallback game, no fake behavior.
