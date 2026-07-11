# Generation Rules — canvas2d_space_scroller

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_space_scroller"`.
2. Do not invent keys (`additionalProperties: false`).
3. `map` rows must all be the same length (rectangular). Enclose the level in `#`
   walls (out-of-bounds is treated as solid anyway).
4. `player_spawn`, `exit` and every `collectibles` position must be on an **open**
   tile (not `#`, not the hazard char), inside the map.
5. **Leave a continuous open flight path from spawn to exit** — do not seal the ship
   in or wall off the exit. A clear corridor band a few tiles tall works well; hang
   wall/hazard "stalactites" from the top and "stalagmites" from the bottom without
   closing the corridor.
6. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
7. Keep numbers in range.

## Design guidance (playable defaults)

- Wide level for horizontal scrolling (e.g. 48×14 at tile_size 32; canvas ~640×448).
- `ship.thrust` 500–700, `ship.max_speed` 200–260, `ship.damping` 1.0–1.6 so the ship
  is drifty but controllable; `hitbox_scale` ~0.7 so collision feels fair.
- Use 3–4 `parallax` layers with increasing `speed` (0.15 → 0.8) for depth; a low-alpha
  `color` layer makes a nice nebula base.
- Place hazards (`X`) sparingly at the tips of obstacles the player can route around.
- 5–10 collectibles along the flight path; `lives` 3.

## Honesty rules

- Do not claim features the runtime lacks (no shooting, no enemies, no gravity wells,
  no fuel, no procedural cave generation, no real 3D). Produce the closest valid config
  and state limitations in prose — never encode fake keys.
