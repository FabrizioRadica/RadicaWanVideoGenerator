# Validation Rules — canvas2d_maze

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, enums, numeric ranges, `additionalProperties: false`,
id/relative-path patterns.

## Layer 2 — Runtime (`RadicaMaze.validateConfig`)
- `title` non-empty; `tile_size` positive.
- `map` non-empty, every row a string of equal length (rectangular), non-empty width.
- `player_spawn` and `exit` present, inside the map, on a non-wall tile.
- Every `collectibles`/`keys`/`doors`/`enemies` coordinate inside the map and on a
  non-wall tile.
- `keys[].id` present and unique; `doors[].key_id` (when set) matches a key id.
- `enemies[].behavior` (when set) is `patrol` or `chase`; `enemies[].speed` positive.
- `lives` 1–99.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback used). A missing sprite never fails the game.

## Export requirements
The exported build (runtime + config + referenced assets) runs without FastAPI or
any server; the only network activity is the initial config fetch, skipped when the
config is inlined into `index.html`.
