# Generation Rules — canvas2d_endless_topdown

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_endless_topdown"`.
2. Do not invent keys (`additionalProperties: false`).
3. `obstacles[].id` and `pickups[].id` unique, lowercase `[a-z0-9_]`.
4. A `score`-effect pickup needs a non-negative `score`; `extra_life` pickups do not.
5. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
6. Keep numbers in range.

## Design guidance (playable defaults)

- Portrait canvas ~480×640.
- `player.speed` 260–320 so the player can weave between lanes.
- `scroll.speed` 180–260; `spawn.interval` 0.8–1.2 with `min_interval` 0.3–0.4.
- 2–4 obstacle types with varied sizes; keep the widest obstacle well under the
  canvas width so a gap always exists.
- Pickups: a common `score` coin (spawn_interval 4–7) and a rare `extra_life`
  (spawn_interval 18–30, low frequency).
- `difficulty.ramp` 0.02–0.05 with `max_ramp` 3–5 so it gets hard but stays fair.
- This is a DODGER: no weapons. Do not describe shooting.

## Honesty rules

- Do not claim features the runtime lacks (no shooting, no bosses, no lane snapping,
  no vehicle handling model). Produce the closest valid config and state limitations
  in prose — never encode fake keys.
