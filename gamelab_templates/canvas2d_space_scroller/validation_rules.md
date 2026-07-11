# Validation Rules — canvas2d_space_scroller

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, enums, numeric ranges, `additionalProperties: false`,
id/relative-path patterns.

## Layer 2 — Runtime (`RadicaSpace.validateConfig`)
- `title` non-empty; `canvas.width/height` within 160–1920; `tile_size` positive.
- `map` non-empty, rectangular, non-empty width.
- `player_spawn` and `exit` present, inside the map, on an open tile (not `#`, not the
  hazard char).
- Every `collectibles` coordinate inside the map and on an open tile.
- `ship.width/height/thrust/max_speed` positive; `damping` in [0, 10] when set;
  `hitbox_scale` in (0, 1] when set.
- `parallax[]` (when present): `type` one of `stars|color`; `speed`/`density >= 0`.
- `lives` 1–99.

> Note: schema/runtime cannot prove the level is *solvable* (that a clear path exists
> from spawn to exit). Generators must guarantee a continuous open flight path — see
> `generation_rules.md`.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
