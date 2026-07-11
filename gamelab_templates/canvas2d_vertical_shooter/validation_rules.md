# Validation Rules — canvas2d_vertical_shooter

A configuration is playable only if it passes BOTH layers below. On failure the
runtime shows a readable error list and refuses to start — never a silent
fallback game.

## Layer 1 — Schema (`schema.json`)

Structural validation: required keys, types, enums, numeric ranges,
`additionalProperties: false`, id patterns, relative-path patterns for assets.

## Layer 2 — Runtime (`RadicaShooter.validateConfig`)

Cross-reference and safety checks, each with a readable message:

- `title` is a non-empty string.
- `canvas.width/height` are numbers within 160–1920.
- `player` exists; `width/height/speed/fire_rate` positive; `hitbox_scale` in (0, 1].
- `bullets.player` exists with positive `speed/width/height/damage`.
- `enemies` is a non-empty array; every `id` unique; `hp/speed/width/height`
  positive; `score >= 0`; `movement` one of `straight|sine|zigzag|dive`;
  `shape` (optional) one of `ship|box|circle|diamond|triangle` — any other
  value is rejected; absent means the default `ship` look.
- Every enemy with `fire.enabled` has a positive `fire.rate`, a valid
  `fire.pattern` (`straight|aimed`) **and** `bullets.enemy` must be defined.
- `waves` is non-empty; every `waves[].enemy_id` references an existing enemy id;
  `count` 1–100; `interval`/`start_delay >= 0`; `x_spread` in (0, 1].
- `powerups[]` ids unique; `effect` one of
  `fire_rate|double_shot|shield|extra_life`; `drop_chance` in [0, 1];
  timed effects require positive `duration`; `fire_rate` requires positive
  `multiplier`.
- `lives` 1–99; `difficulty` multipliers positive; `wave_speedup >= 0`;
  `score` values `>= 0`.

## Asset safety

- Sprite paths must be relative: entries containing `..`, a leading `/` or a
  drive letter (`:`) are ignored (fallback used), never resolved.
- A missing or unloadable sprite NEVER fails the game: the runtime draws its
  procedural fallback for that entity and keeps playing.

## Export requirements

- The exported build (runtime files + config + referenced assets) runs without
  FastAPI or any server-side code; the only network activity is the initial
  config fetch, skipped entirely when the config is inlined into `index.html`.
