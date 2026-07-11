# Generation Rules — canvas2d_maze

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_maze"`.
2. Do not invent keys (`additionalProperties: false`).
3. `map` rows must all be the same length (rectangular). Enclose the maze in `#`
   walls so the player cannot leave the grid.
4. `player_spawn`, `exit`, every `collectibles`/`keys`/`doors`/`enemies` position
   must sit on a **floor** tile (not `#`) and inside the map.
5. Every `doors[].key_id` must reference a defined `keys[].id`. Ids lowercase `[a-z0-9_]`.
6. Do not reference asset files that are not known to exist; omit sprite mappings
   to use procedural fallbacks. Asset paths are relative (no `/`, `..`, drive letters).
7. Keep numbers in schema ranges. Sensible values: tile_size 24–40, player.speed
   `tile_size*4`, enemy speed 60–120, lives 3.

## Design guidance

- Ensure the exit is actually reachable from the spawn (leave connected corridors).
- Place a locked `door` on the only path to the exit and its `key` elsewhere, so
  the key matters. Do not lock the player away from the key.
- 1–3 enemies for a small maze; mix `chase` (pressure) and `patrol` (ambient).
  A pure-`chase` swarm on a tight maze can be unfair — keep corridors escapable.
- Collectibles add score and optional gating (`exit_requires_all_collectibles`).
- Dark floor, one accent, contrasting walls; readable HUD.

## Honesty rules

- Do not claim features the runtime lacks (no procedural maze generation, no fog
  of war, no inventory beyond keys, no combat). Produce the closest valid config
  and state limitations in prose — never encode fake keys.
