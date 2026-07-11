# Generation Rules — canvas2d_vertical_shooter

Rules for any generator (LLM or tool) that produces game configurations for this
template. Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output a single JSON object that validates against `schema.json`.
2. Set `"template": "canvas2d_vertical_shooter"`.
3. Do not invent config keys. Unknown keys are rejected (`additionalProperties: false`).
4. Do not reference asset files that are not known to exist. When unsure, omit the
   sprite mapping — the runtime draws procedural fallbacks. Never fabricate paths.
5. Asset paths must be relative (no leading `/`, no `..`, no drive letters).
6. Every `waves[].enemy_id` must match an `enemies[].id`. Every id must be unique,
   lowercase `[a-z0-9_]`.
7. Keep numbers inside the schema ranges. Sensible arcade values:
   - canvas: 480×640 (portrait)
   - player.speed 200–320, fire_rate 4–8
   - bullets.player.speed 400–600; bullets.enemy.speed 150–260
   - enemy speed 60–140, hp 1–3 (5+ only for rare "boss-like" heavies)
   - wave count 3–8, interval 0.25–1.5, start_delay 1–2
   - drop_chance 0.02–0.12 per powerup; lives 3
8. At most one `extra_life` powerup; keep its drop_chance ≤ 0.03.
9. `interaction`: the game is keyboard-only. Do not describe touch/mouse features.
10. Enemy look: when the user EXPLICITLY asks for a specific enemy look, set
    `enemies[].shape` to the matching value — box/square/cube/block → `"box"`,
    circle/round/ball/orb → `"circle"`, diamond/rhombus/gem → `"diamond"`,
    triangle → `"triangle"`, ship/spaceship → `"ship"`. Otherwise OMIT `shape`
    (the runtime defaults to the classic ship look). `shape` only affects the
    procedural drawing; it is ignored for enemies with a mapped sprite. Never
    invent shape values outside the schema enum.

## Design guidance

- 4–8 waves with an escalation arc: easy straight enemies → mixed patterns →
  a heavier wave near the end. Waves loop with `difficulty.wave_speedup` ramping.
- Use `movement` variety across waves (straight/zigzag/sine/dive) instead of
  raising speeds aggressively.
- Enable `fire` only on 1–2 enemy types and define `bullets.enemy` whenever any
  enemy fires (validation requires it).
- Theme colors: dark background (`#050a18`–`#12081f` range), one accent, readable HUD.
- Titles: short, arcade-flavored, English.

## Honesty rules

- Never claim features the runtime does not support (no bosses with phases, no
  homing missiles, no touch controls, no music system).
- If asked for something unsupported, produce the closest valid configuration and
  state the limitation in prose — do not encode fake keys.
