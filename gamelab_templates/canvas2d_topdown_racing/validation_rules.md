# Validation Rules — canvas2d_topdown_racing

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, numeric ranges, `additionalProperties: false`,
relative-path patterns for assets.

## Layer 2 — Runtime (`RadicaRacer.validateConfig`)
- `title` non-empty; `tile_size` positive.
- `map` non-empty, rectangular, non-empty width.
- `start` present, inside the map, on a non-wall tile; `start.heading_deg` numeric
  when set.
- `checkpoints` has at least 2 entries; every checkpoint inside the map on a
  non-wall tile.
- `car.width`, `car.length`, `car.accel`, `car.max_speed`, `car.turn_rate` positive;
  `car.brake`/`car.grass_max_speed` positive when set; `car.friction` in [0, 1].
- `laps` 1–99.

## Asset safety
The car sprite path must be relative; entries with `..`, a leading `/` or `:` are
ignored (procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
