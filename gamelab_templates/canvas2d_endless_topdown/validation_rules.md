# Validation Rules — canvas2d_endless_topdown

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, enums, numeric ranges, `additionalProperties: false`,
id/relative-path patterns.

## Layer 2 — Runtime (`RadicaEndless.validateConfig`)
- `title` non-empty; `canvas.width/height` numbers within 160–1920.
- `player.width/height/speed` positive; `hitbox_scale` in (0, 1].
- `scroll.speed` positive.
- `obstacles` non-empty; ids unique; `width/height` positive; `speed_bonus >= 0`.
- `spawn.interval` positive; `spawn.min_interval` positive when set.
- `pickups[]` ids unique; `size` positive; `effect` one of `score|extra_life`;
  `score >= 0` for score pickups; `spawn_interval` positive when set.
- `lives` 1–99; `score.distance_per_second >= 0`; `difficulty.ramp >= 0`;
  `difficulty.max_ramp` positive when set.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
