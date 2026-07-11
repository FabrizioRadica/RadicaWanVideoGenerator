# Generation Rules — canvas2d_lane_runner

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_lane_runner"`.
2. Do not invent keys (`additionalProperties: false`).
3. `obstacles[].id` unique, lowercase `[a-z0-9_]`; `type` is one of `jump|duck|block`.
4. Provide at least one obstacle the player can avoid by action (a `jump` and/or
   `duck` type) — a config with only `block` obstacles is beatable only by lane
   changes and gets unfair fast; mix types.
5. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
6. Keep numbers in range.

## Design guidance (playable defaults)

- Portrait canvas ~480×640; `lanes` 3.
- `speed.base` 300–360, `speed.ramp` 8–15, `speed.max` 700–850.
- `player.jump_duration` ~0.5–0.7, `duck_duration` ~0.4–0.6.
- `spawn.interval_distance` 260–340 so rows are readable at speed;
  `obstacle_chance` 0.7–0.85, `coin_chance` 0.5–0.7.
- Always leave at least one safe lane per row (the engine spawns one obstacle per
  row, so a 3-lane track always has a clear lane). Coins go in a different lane.

## Honesty rules

- Do not claim features the runtime lacks (no double-jump, no power-ups, no
  hoverboard, no multiplayer, no real 3D). Produce the closest valid config and
  state limitations in prose — never encode fake keys.
