# Fallback assets

Procedural fallback sprites (player ship, enemies, bullets, power-up tokens,
starfield) are **drawn in code** by `runtime/game_runtime.js` whenever a sprite
is unmapped or fails to load — no image files are required for the template to
run.

This folder may optionally hold static fallback images shared by configurations
of this template. Files placed here must be referenced through
`assets.sprites` with relative paths.
