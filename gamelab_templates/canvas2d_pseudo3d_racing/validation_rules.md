# Validation Rules — canvas2d_pseudo3d_racing

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, numeric ranges, `additionalProperties: false`,
relative-path patterns for assets.

## Layer 2 — Runtime (`RadicaOutrun.validateConfig`)
- `title` non-empty; `canvas.width/height` within 160–1920.
- `road.segment_length` and `road.road_width` positive; `lanes` 1–8 (when set);
  `draw_distance` 30–600 (when set); `fov` in (10, 170) (when set);
  `camera_height`/`rumble_segments` positive (when set).
- `car.max_speed` and `car.accel` positive; `brake`/`decel`/`off_road_decel`/
  `off_road_limit`/`steer` positive when set; `centrifugal >= 0` when set.
- `track` non-empty; each section `length` 1–2000; `curve`/`hill` numeric when set.
- `laps` 1–99 when set.
- `traffic` (when set): `count` 0–60; `speed_factor` in [0, 1).

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
