# Generation Rules — canvas2d_topdown_racing

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_topdown_racing"`.
2. Do not invent keys (`additionalProperties: false`).
3. `map` rows equal length (rectangular). Enclose the track in `#` walls.
4. `start` and every `checkpoints[]` entry must be on a non-wall tile (`.` road or
   grass), inside the map.
5. `checkpoints[0]` is the start/finish line; place `start` on or just before it,
   with `heading_deg` pointing along the track direction (0° = right, 90° = down,
   180° = left, 270° = up).
6. Order the checkpoints so following them traces one full lap around the circuit;
   include enough (3–8) that the car cannot shortcut across the infield.
7. Make the racing line at least 2 tiles wide so the car can actually corner
   (`car.width` should be well under `tile_size`).
8. Do not reference unknown asset files; omit the car sprite for a procedural
   fallback. Asset paths relative (no `/`, `..`, drive letters).

## Design guidance (playable defaults)

- tile_size 32–48; car width ~half a tile, length ~0.8 tile.
- accel 300–400, max_speed 220–260, brake ~1.3× accel, turn_rate 2.8–3.4,
  friction 0.6–0.8, grass_max_speed ~0.35× max_speed.
- laps 2–3.
- Use grass (`g` or any non-`#`/`.` char) on run-off areas to punish cutting
  corners without a hard wall.

## Honesty rules

- Do not claim features the runtime lacks (no AI opponents, no scrolling camera, no
  tyre/drift model, no pit stops, no power-ups). Produce the closest valid config
  and state limitations in prose — never encode fake keys.
