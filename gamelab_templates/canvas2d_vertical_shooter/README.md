# GameLab Template — Canvas2D Vertical Shooter

**Template id:** `canvas2d_vertical_shooter` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** vertical scrolling arcade shooter template
for RadicaLab GameLab. A game is fully described by one JSON file validated against
`schema.json`; the runtime engine is stable and is never rewritten per game.

## Structure

```text
canvas2d_vertical_shooter/
  template.json          template metadata (capabilities, entry point, constraints)
  schema.json            JSON Schema (draft-07) for game configurations
  README.md              this file
  generation_rules.md    rules for generating configurations (LLM/tooling)
  validation_rules.md    validation checklist enforced by schema + runtime
  runtime/
    index.html           loader (inline config → game_config.json → bundled example)
    style.css            page/canvas shell
    game_runtime.js      the engine (RadicaShooter.mount / RadicaShooter.validateConfig)
  examples/
    airplane_vertical_shooter.json   working demo config ("Sky Raiders")
  assets/
    fallback/            optional static fallback images (procedural fallbacks are code-drawn)
```

## Playing the example

Browsers block `fetch()` on `file://` pages, so serve the template folder over HTTP:

```text
cd gamelab_templates/canvas2d_vertical_shooter
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

The loader falls back to `examples/airplane_vertical_shooter.json` when no
`game_config.json` sits next to `index.html`.

**Controls:** Arrow keys / WASD move · Space fires · Enter starts/restarts.

## Configuration overview

See `schema.json` for the authoritative shape. Summary:

- `title`, `canvas {width,height}`, `theme {background_color,hud_color,accent_color}`
- `background {type: starfield|color|image, speed, density, color}`
- `player {width,height,speed,fire_rate,hitbox_scale,color,sprite}`
- `bullets.player {speed,width,height,damage}` and optional `bullets.enemy`
- `enemies[] {id,hp,speed,width,height,score,movement,fire{enabled,rate,pattern}}`
  — movement: `straight | sine | zigzag | dive`; fire pattern: `straight | aimed`
- `waves[] {enemy_id,count,formation,interval,start_delay,x_spread}`
  — formation: `line | column | vee | random`; waves loop endlessly with a
  difficulty ramp (`difficulty.wave_speedup`) after the last wave
- `powerups[] {id,effect,multiplier,duration,drop_chance}`
  — effects: `fire_rate | double_shot | shield | extra_life`
- `score {kill_multiplier,wave_clear_bonus}`, `lives`, `difficulty`, `assets`

## Assets and fallbacks

`assets.sprites` maps keys (`player`, `background`, `bullet_player`, `bullet_enemy`,
`enemy_<id>`, `powerup_<id>`) to **relative** paths under `assets.base_path`.
Any sprite that is unmapped or fails to load is drawn procedurally (ships,
triangles, glow bullets, lettered power-up tokens) — the game always runs; it
never shows a broken image or pretends a missing asset loaded.

## Standalone export

An exported build is `runtime/` + a `game_config.json` (or an inline
`<script type="application/json" id="rs-config">` block) + any referenced
`assets/`. The runtime performs **no server calls** besides loading its config
file, uses relative paths only, and needs no FastAPI/RadicaLab at play time.

## Invalid configurations

`RadicaShooter.mount()` validates first and, on errors, renders a readable
error list instead of starting — no silent fallback game, no fake behavior.
