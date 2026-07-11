# GameLab Template — Canvas2D Horizontal Shooter

**Template id:** `canvas2d_horizontal_shooter` · **Engine:** Canvas2D (vanilla JS) · **Version:** 1.0.0
**Concept & Design:** Fabrizio Radica — **Project by:** RadicaDesign

A controlled, reusable, **configuration-driven** horizontal side-scrolling arcade
shooter template for RadicaLab GameLab, inspired by classic horizontal shoot 'em
ups. A game is fully described by one JSON file validated against `schema.json`;
the runtime engine is stable and is never rewritten per game.

## Structure

```text
canvas2d_horizontal_shooter/
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
    space_horizontal_shooter.json   working demo config ("Nebula Runner")
  assets/
    fallback/            optional static fallback images (procedural fallbacks are code-drawn)
```

## Playing the example

Browsers block `fetch()` on `file://` pages, so serve the template folder over HTTP:

```text
cd gamelab_templates/canvas2d_horizontal_shooter
python -m http.server 8080
# open http://127.0.0.1:8080/runtime/
```

The loader falls back to `examples/space_horizontal_shooter.json` when no
`game_config.json` sits next to `index.html`.

**Controls:** Arrow keys / WASD move · Space fires · Enter starts/restarts.

## Configuration overview

See `schema.json` for the authoritative shape. Beyond the shared shooter core
(`title`, `canvas`, `theme`, `player`, `bullets`, `powerups`, `score`, `lives`,
`difficulty`, `assets`) this template adds:

- `background.layers[]` — ordered parallax layers, back to front, each
  `{type: starfield|color|image, speed, density, color}` scrolling right-to-left
- `formations[]` — named entry shapes `{id, arrangement: line|column|vee|random, spacing}`
- `waves[]` — `{enemy_id, formation_id, count, interval, start_delay, y_spread}`;
  waves loop endlessly with a difficulty ramp (`difficulty.wave_speedup`)
- enemy `movement`: `straight | sine | drift` (drift homes vertically toward the player)
- enemy `fire.pattern`: `straight | aimed | spread` (spread = 3-way fan)

## Assets and fallbacks

`assets.sprites` maps keys (`player`, `background_<layer index>`, `bullet_player`,
`bullet_enemy`, `enemy_<id>`, `powerup_<id>`) to **relative** paths under
`assets.base_path`. Any sprite that is unmapped or fails to load is drawn
procedurally — the game always runs; it never shows a broken image or pretends a
missing asset loaded.

## Standalone export

An exported build is `runtime/` + a `game_config.json` (or an inline
`<script type="application/json" id="rs-config">` block) + any referenced
`assets/`. The runtime performs **no server calls** besides loading its config
file, uses relative paths only, and needs no FastAPI/RadicaLab at play time.

## Invalid configurations

`RadicaShooter.mount()` validates first and, on errors, renders a readable
error list instead of starting — no silent fallback game, no fake behavior.
