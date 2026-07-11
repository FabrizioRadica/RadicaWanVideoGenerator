# Validation Rules — canvas2d_lane_runner

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, enums, numeric ranges, `additionalProperties: false`,
id/relative-path patterns.

## Layer 2 — Runtime (`RadicaRunner.validateConfig`)
- `title` non-empty; `canvas.width/height` within 160–1920.
- `lanes` 2–6.
- `player.width/height` positive; `jump_duration`/`duck_duration` positive when set.
- `speed.base` positive; `speed.max` positive when set; `speed.ramp >= 0`.
- `obstacles` non-empty; ids unique; `type` one of `jump|duck|block`.
- `spawn.interval_distance` positive; `obstacle_chance`/`coin_chance` in [0, 1].
- `lives` 1–99.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
