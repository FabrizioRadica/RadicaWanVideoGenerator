# Validation Rules — canvas2d_roguelike

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, enums, numeric ranges, `additionalProperties: false`,
id/relative-path patterns.

## Layer 2 — Runtime (`RadicaRogue.validateConfig`)
- `title` non-empty; `tile_size` positive.
- `map` non-empty, rectangular, non-empty width.
- `player_spawn` and `exit` present, inside the map, on a non-wall tile.
- All `treasure`/`potions`/`keys`/`doors`/`enemies` coordinates inside the map and
  on non-wall tiles.
- `potions[].heal` positive.
- `keys[].id` present and unique; `doors[].key_id` (when set) matches a key id.
- `enemies[].behavior` (when set) is `wander` or `chase`; `enemies[].hp` and
  `enemies[].damage` positive.
- `player.max_hp` and `player.attack` positive.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
