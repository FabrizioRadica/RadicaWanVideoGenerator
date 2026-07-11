# Validation Rules — canvas2d_flappy

A configuration is playable only if it passes BOTH layers. On failure the runtime
shows a readable error list and refuses to start — never a silent fallback game.

## Layer 1 — Schema (`schema.json`)
Required keys, types, numeric ranges, `additionalProperties: false`,
relative-path patterns for assets.

## Layer 2 — Runtime (`RadicaFlappy.validateConfig`)
- `title` non-empty.
- `canvas.width/height` numbers within 160–1920.
- `gravity` and `flap_velocity` positive.
- `bird.width`/`bird.height` positive.
- `pipes.gap`/`pipes.width`/`pipes.spacing`/`pipes.speed` positive.
- `pipes.gap > bird.height * 1.5` (the bird must be able to pass).
- `lives` (when set) 1–99; `score_per_pipe` (when set) `>= 0`.

## Asset safety
Sprite paths must be relative; entries with `..`, a leading `/` or `:` are ignored
(procedural fallback). A missing sprite never fails the game.

## Export requirements
The exported build runs without FastAPI or any server; the only network activity is
the initial config fetch, skipped when the config is inlined into `index.html`.
