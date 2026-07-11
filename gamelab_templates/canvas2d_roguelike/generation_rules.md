# Generation Rules — canvas2d_roguelike

Rules for any generator (LLM or tool) producing configurations for this template.
Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output one JSON object valid against `schema.json`. Set `"template": "canvas2d_roguelike"`.
2. Do not invent keys (`additionalProperties: false`).
3. `map` rows equal length (rectangular); enclose in `#` walls.
4. `player_spawn`, `exit`, all `treasure`/`potions`/`keys`/`doors`/`enemies`
   positions must be on floor tiles inside the map.
5. `enemies[].id` and `keys[].id` lowercase `[a-z0-9_]`; unique key ids; every
   `doors[].key_id` matches a defined key.
6. Do not reference unknown asset files; omit sprite mappings for procedural
   fallbacks. Asset paths relative (no `/`, `..`, drive letters).
7. Keep numbers in range. Sensible values: tile_size 28–36, player.max_hp 15–25,
   player.attack 4–6, enemy hp 4–12, enemy damage 2–5, sight 4–7.

## Design guidance

- Balance so the run is winnable: total enemy damage on the shortest path should
  be survivable with `max_hp` plus 1–2 potions. Do not wall off the exit.
- Mix `wander` (ambient) and `chase` (threat) enemies. A room of high-damage
  chasers with no potions is unfair.
- Put treasure slightly off the optimal path to reward exploration; use a locked
  door + key to gate an optional treasure room or the exit (place the key reachable).
- Bump-to-attack is the only combat: `player.attack` vs enemy `hp` decides how
  many hits a kill takes — tune so common enemies die in 1–3 hits.

## Honesty rules

- Do not claim features the runtime lacks (no ranged combat, no inventory beyond
  keys, no leveling/XP, no procedural generation, no line-of-sight fog). Produce
  the closest valid config and state limitations in prose — never fake keys.
