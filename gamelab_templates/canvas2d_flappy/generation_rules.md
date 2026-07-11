# Generation Rules — canvas2d_flappy

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_flappy"`.
2. Do not invent keys (`additionalProperties: false`).
3. `pipes.gap` MUST exceed `bird.height * 1.5` so the bird can physically pass
   (runtime enforces this).
4. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
5. Keep numbers in range and physically sane.

## Design guidance (playable defaults)

- Portrait canvas ~400×600.
- `gravity` 1200–1800, `flap_velocity` ~0.3× gravity-ish (400–520) so a tap
  clearly arrests the fall without flying off-screen.
- `bird` ~30–36 px; `pipes.gap` 140–180; `pipes.width` 50–70;
  `pipes.spacing` 200–260 (horizontal distance); `pipes.speed` 120–180.
- Harder variants: smaller gap (but keep > bird.height*1.5), faster speed,
  tighter spacing. Do not make it impossible.
- `lives` 1 for classic; 2–3 for a gentler variant.

## Honesty rules

- Do not claim features the runtime lacks (no moving/rotating pipes, no power-ups,
  no day/night cycle, no multiplayer). Produce the closest valid config and state
  limitations in prose — never encode fake keys.
