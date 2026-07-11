# Generation Rules — canvas2d_horizontal_shooter

Rules for any generator (LLM or tool) that produces game configurations for this
template. Generators produce **JSON only** — never runtime code.

## Hard rules

1. Output a single JSON object that validates against `schema.json`.
2. Set `"template": "canvas2d_horizontal_shooter"`.
3. Do not invent config keys. Unknown keys are rejected (`additionalProperties: false`).
4. Do not reference asset files that are not known to exist. When unsure, omit the
   sprite mapping — the runtime draws procedural fallbacks. Never fabricate paths.
5. Asset paths must be relative (no leading `/`, no `..`, no drive letters).
6. Cross-references must resolve: every `waves[].enemy_id` matches an
   `enemies[].id`; every `waves[].formation_id` matches a `formations[].id`.
   All ids unique, lowercase `[a-z0-9_]`.
7. Every enemy with `fire.enabled: true` requires `bullets.enemy` to be defined.
8. Keep numbers inside the schema ranges. Sensible arcade values:
   - canvas: 800×450 (landscape)
   - 2–3 background layers, slowest at the back (speed 15–30 → 50–90 front)
   - player.speed 220–300, fire_rate 4–8
   - bullets.player.speed 450–650; bullets.enemy.speed 150–260
   - enemy speed 50–150, hp 1–4 (4+ only for rare "gunship-like" heavies)
   - wave count 2–8, interval 0.25–1.6, start_delay 1–2
   - drop_chance 0.02–0.12 per powerup; lives 3
9. At most one `extra_life` powerup; keep its drop_chance ≤ 0.03.
10. The game is keyboard-only. Do not describe touch/mouse features.
11. Enemy look: when the user EXPLICITLY asks for a specific enemy look, set
    `enemies[].shape` to the matching value — box/square/cube/block → `"box"`,
    circle/round/ball/orb → `"circle"`, diamond/rhombus/gem → `"diamond"`,
    triangle → `"triangle"`, ship/spaceship → `"ship"`. Otherwise OMIT `shape`
    (the runtime defaults to the classic ship look). `shape` only affects the
    procedural drawing; it is ignored for enemies with a mapped sprite. Never
    invent shape values outside the schema enum.

## Design guidance

- 4–8 waves with an escalation arc: unarmed/straight enemies first, then aimed
  fire, a spread-firing heavy near the end. Waves loop with
  `difficulty.wave_speedup` ramping.
- Use formation variety (`line` wall, `column` convoy, `vee` arrow, `random`
  scatter) rather than only raising counts.
- Reserve `spread` fire for 1 heavy enemy type; `aimed` for hunters; most
  enemies should fire `straight` or not at all.
- Theme colors: dark background, one accent, readable HUD; parallax layer colors
  dimmer at the back, brighter at the front.
- Titles: short, arcade-flavored, English.

## Honesty rules

- Never claim features the runtime does not support (no bosses with phases, no
  homing missiles, no weapons upgrade trees, no touch controls, no music system).
- If asked for something unsupported, produce the closest valid configuration and
  state the limitation in prose — do not encode fake keys.
