# Generation Rules — canvas2d_pseudo3d_racing

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_pseudo3d_racing"`.
2. Do not invent keys (`additionalProperties: false`).
3. `track` is a non-empty ordered list of sections; each `length` is a segment
   count (1–2000). `curve` −20..20 (0 = straight); `hill` is an elevation delta
   over the section (positive = up, negative = down).
4. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
5. Keep numbers in range.

## Design guidance (playable defaults)

- Landscape canvas ~640×400.
- `road.segment_length` 180–220, `road_width` ~1800–2200, `lanes` 3,
  `draw_distance` 120–200, `fov` 90–110, `camera_height` ~1000.
- `car.max_speed` ≈ `segment_length * 60` (e.g. 12000 for segment_length 200);
  `accel` ≈ max/5, `brake` ≈ max, `decel` ≈ max/5, `off_road_decel` ≈ max/2,
  `off_road_limit` ≈ max/4, `centrifugal` 0.25–0.35, `steer` 2–2.5.
- Build a varied but drivable loop: alternate straights with moderate curves
  (|curve| 2–6) and gentle hills; avoid long stretches of maximum curve.
- `laps` 2–3. `traffic.count` 0–12 with `speed_factor` 0.4–0.6 for weaving.

## Honesty rules

- Do not claim features the runtime lacks (no branching routes, no scenery sprites
  beyond simple traffic, no damage model, no nitro, no real 3D). Produce the closest
  valid config and state limitations in prose — never encode fake keys.
