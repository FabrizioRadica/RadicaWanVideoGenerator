/* RadicaLab GameLab — Canvas2D Space Scroller template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN space cave-flyer: pilot a ship with inertial thrust
 * through a scrolling TILEMAP level with real per-axis wall collision, over
 * multi-layer PARALLAX starfields. Solid tiles block the ship, hazard tiles
 * destroy it (lives), collectibles add score, reach the exit to complete the
 * level. The game is fully described by a validated JSON configuration (see
 * ../schema.json); a generator produces configuration only — it never rewrites
 * this engine. Self-contained: HTML + CSS + vanilla JS, no frameworks, no server
 * calls, relative asset paths only, procedural fallback graphics.
 *
 * Public API:
 *   RadicaSpace.validateConfig(config) -> [readable error strings]
 *   RadicaSpace.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt).
 *
 * Controls: Arrow keys / WASD thrust, Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var LAYER_TYPES = ["stars", "color"];

  function num(v) { return typeof v === "number" && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }
  function nneg(v) { return num(v) && v >= 0; }
  function str(v) { return typeof v === "string" && v.length > 0; }

  function validateConfig(cfg) {
    var e = [];
    function bad(m) { e.push(m); }
    if (!cfg || typeof cfg !== "object") return ["Configuration must be a JSON object."];
    if (!str(cfg.title)) bad("title must be a non-empty string.");
    var cv = cfg.canvas || {};
    if (!(num(cv.width) && cv.width >= 160 && cv.width <= 1920)) bad("canvas.width must be a number between 160 and 1920.");
    if (!(num(cv.height) && cv.height >= 160 && cv.height <= 1920)) bad("canvas.height must be a number between 160 and 1920.");
    if (!pos(cfg.tile_size)) bad("tile_size must be a positive number.");

    var hazard = (cfg.hazard_char || "X");
    var rows = 0, cols = 0, grid = null;
    if (!Array.isArray(cfg.map) || !cfg.map.length) bad("map must be a non-empty array of strings.");
    else {
      rows = cfg.map.length; cols = cfg.map[0].length;
      if (cfg.map.some(function (r) { return typeof r !== "string"; })) bad("every map row must be a string.");
      else if (!cols) bad("map rows must not be empty.");
      else if (cfg.map.some(function (r) { return r.length !== cols; })) bad("map must be rectangular (all rows same length).");
      else grid = cfg.map;
    }
    function free(c, r) { return grid && r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== "#" && grid[r][c] !== hazard; }
    function coordOk(o, label, mustBeFree) {
      if (!o || !num(o.col) || !num(o.row)) { bad(label + " must have numeric col/row."); return; }
      if (o.col < 0 || o.col >= cols || o.row < 0 || o.row >= rows) { bad(label + " is outside the map."); return; }
      if (mustBeFree && !free(o.col, o.row)) bad(label + " must be on an empty (non-wall, non-hazard) tile.");
    }
    if (grid) {
      if (!cfg.player_spawn) bad("player_spawn is required."); else coordOk(cfg.player_spawn, "player_spawn", true);
      if (!cfg.exit) bad("exit is required."); else coordOk(cfg.exit, "exit", true);
      (cfg.collectibles || []).forEach(function (c, i) { coordOk(c, "collectibles[" + i + "]", true); });
    }
    var s = cfg.ship || {};
    if (!pos(s.width) || !pos(s.height)) bad("ship.width and ship.height must be positive numbers.");
    if (!pos(s.thrust)) bad("ship.thrust must be a positive number.");
    if (!pos(s.max_speed)) bad("ship.max_speed must be a positive number.");
    if (s.damping != null && !(num(s.damping) && s.damping >= 0 && s.damping <= 10)) bad("ship.damping must be between 0 and 10 when set.");
    if (s.hitbox_scale != null && !(num(s.hitbox_scale) && s.hitbox_scale > 0 && s.hitbox_scale <= 1)) bad("ship.hitbox_scale must be between 0 (exclusive) and 1.");
    if (Array.isArray(cfg.parallax)) cfg.parallax.forEach(function (l, i) {
      var tag = "parallax[" + i + "]";
      if (LAYER_TYPES.indexOf(l.type) < 0) bad(tag + ".type must be one of: " + LAYER_TYPES.join(", ") + ".");
      if (l.speed != null && !nneg(l.speed)) bad(tag + ".speed must be a number >= 0.");
      if (l.density != null && !nneg(l.density)) bad(tag + ".density must be a number >= 0.");
    });
    if (!(num(cfg.lives) && cfg.lives >= 1 && cfg.lives <= 99)) bad("lives must be a number between 1 and 99.");
    return e;
  }

  function loadSprites(cfg) {
    var out = {}, assets = cfg.assets || {}, base = assets.base_path || "assets/", map = assets.sprites || {};
    if (typeof Image === "undefined") return out;
    Object.keys(map).forEach(function (key) {
      var rel = String(map[key] || "");
      if (!rel || rel.indexOf("..") >= 0 || rel.charAt(0) === "/" || rel.indexOf(":") >= 0) return;
      var entry = { ready: false, img: new Image() };
      entry.img.onload = function () { entry.ready = true; };
      entry.img.onerror = function () { entry.ready = false; };
      entry.img.src = base + rel;
      out[key] = entry;
    });
    return out;
  }

  function Engine(root, cfg, opts) {
    opts = opts || {};
    this.cfg = cfg;
    this.W = cfg.canvas.width; this.H = cfg.canvas.height;
    this.T = cfg.tile_size;
    this.rows = cfg.map.length; this.cols = cfg.map[0].length;
    this.levelW = this.cols * this.T; this.levelH = this.rows * this.T;
    this.hazard = cfg.hazard_char || "X";
    this.theme = cfg.theme || {};
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
    this.stats = { collected: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.className = "rg-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._onKeyDown = this._key.bind(this, true);
    this._onKeyUp = this._key.bind(this, false);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    this._layers = this._makeLayers();
    this._resetRun();
    this._raf = null; this._last = 0; this._t = 0;
    if (!opts.noLoop && typeof requestAnimationFrame === "function") this._loop(); else this.draw();
  }

  Engine.prototype.destroy = function () {
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    if (this._raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._raf);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  Engine.prototype._loop = function () {
    var self = this;
    this._raf = requestAnimationFrame(function tick(ts) {
      var dt = self._last ? Math.min((ts - self._last) / 1000, 0.05) : 1 / 60;
      self._last = ts; self.step(dt); self._raf = requestAnimationFrame(tick);
    });
  };

  Engine.prototype._key = function (down, ev) {
    var k = ev.key === " " || ev.key === "Spacebar" ? "Space" : ev.key;
    this.keys[k] = down;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(k) >= 0 && ev.preventDefault) ev.preventDefault();
    if (down && k === "Enter" && this.state !== "playing") this.startGame();
  };

  Engine.prototype._makeLayers = function () {
    var self = this;
    var defs = Array.isArray(this.cfg.parallax) && this.cfg.parallax.length ? this.cfg.parallax
      : [{ type: "stars", speed: 0.2, density: 40, color: "#6d7aa8" }, { type: "stars", speed: 0.5, density: 60, color: "#cfe6ff" }];
    return defs.map(function (def) {
      var layer = { def: def, stars: [] };
      if (def.type === "stars") {
        var d = def.density != null ? def.density : 50;
        for (var i = 0; i < d; i++) layer.stars.push({ x: Math.random() * self.W, y: Math.random() * self.H, s: (def.size || 2) * (0.5 + Math.random()) });
      }
      return layer;
    });
  };

  Engine.prototype._resetRun = function () {
    var s = this.cfg.player_spawn, T = this.T;
    this.ship = { x: (s.col + 0.5) * T, y: (s.row + 0.5) * T, vx: 0, vy: 0, angle: 0, invuln: 0 };
    this.lives = this.cfg.lives;
    this.score = 0;
    this.collectibles = (this.cfg.collectibles || []).map(function (c) { return { col: c.col, row: c.row, taken: false }; });
    this.camX = 0; this.camY = 0;
    this.stats = { collected: 0 };
    this._updateCamera();
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype._charAt = function (col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return "#"; // out of bounds = solid
    return this.cfg.map[row][col];
  };
  Engine.prototype._solidAABB = function (cx, cy, kind) {
    var hw = this._hw, hh = this._hh, T = this.T;
    var pts = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx - hw, cy + hh], [cx + hw, cy + hh]];
    for (var i = 0; i < pts.length; i++) {
      var ch = this._charAt(Math.floor(pts[i][0] / T), Math.floor(pts[i][1] / T));
      if (kind === "solid" && ch === "#") return true;
      if (kind === "hazard" && ch === this.hazard) return true;
    }
    return false;
  };

  Engine.prototype._updateCamera = function () {
    this.camX = Math.max(0, Math.min(this.levelW - this.W, this.ship.x - this.W / 2));
    this.camY = Math.max(0, Math.min(this.levelH - this.H, this.ship.y - this.H / 2));
    if (this.levelW <= this.W) this.camX = (this.levelW - this.W) / 2;
    if (this.levelH <= this.H) this.camY = (this.levelH - this.H) / 2;
  };

  Engine.prototype.step = function (dt) {
    this._t += dt;
    if (this.state !== "playing") { this.draw(); return; }
    var s = this.ship, cfg = this.cfg.ship;
    this._hw = (cfg.width / 2) * (cfg.hitbox_scale != null ? cfg.hitbox_scale : 0.8);
    this._hh = (cfg.height / 2) * (cfg.hitbox_scale != null ? cfg.hitbox_scale : 0.8);

    // thrust
    var ax = 0, ay = 0;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) ax -= 1;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) ax += 1;
    if (this.keys.ArrowUp || this.keys.w || this.keys.W) ay -= 1;
    if (this.keys.ArrowDown || this.keys.s || this.keys.S) ay += 1;
    s.vx += ax * cfg.thrust * dt;
    s.vy += ay * cfg.thrust * dt;
    // damping (space drag for control)
    var damp = Math.max(0, 1 - (cfg.damping != null ? cfg.damping : 1.2) * dt);
    s.vx *= damp; s.vy *= damp;
    // clamp speed
    var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (sp > cfg.max_speed) { s.vx = s.vx / sp * cfg.max_speed; s.vy = s.vy / sp * cfg.max_speed; }
    if (ax || ay) s.angle = Math.atan2(s.vy || ay, s.vx || ax);
    if (s.invuln > 0) s.invuln -= dt;

    // move X then resolve solid, move Y then resolve solid (blocking)
    var nx = s.x + s.vx * dt;
    if (this._solidAABB(nx, s.y, "solid")) { s.vx = 0; } else s.x = nx;
    var ny = s.y + s.vy * dt;
    if (this._solidAABB(s.x, ny, "solid")) { s.vy = 0; } else s.y = ny;

    // hazard = crash
    if (s.invuln <= 0 && this._solidAABB(s.x, s.y, "hazard")) this._crash();

    // collectibles
    var pc = Math.floor(s.x / this.T), pr = Math.floor(s.y / this.T), self = this;
    this.collectibles.forEach(function (c) {
      if (!c.taken && c.col === pc && c.row === pr) { c.taken = true; self.stats.collected++; self.score += (self.cfg.score && self.cfg.score.collectible != null ? self.cfg.score.collectible : 100); }
    });
    // exit
    if (pc === this.cfg.exit.col && pr === this.cfg.exit.row) {
      if (!this.cfg.exit_requires_all_collectibles || this.stats.collected >= this.collectibles.length) this.state = "win";
    }

    this._updateCamera();
    this.draw();
  };

  Engine.prototype._crash = function () {
    this.lives--;
    if (this.lives <= 0) { this.state = "gameover"; return; }
    var s = this.cfg.player_spawn, T = this.T;
    this.ship.x = (s.col + 0.5) * T; this.ship.y = (s.row + 0.5) * T;
    this.ship.vx = this.ship.vy = 0; this.ship.invuln = 1.5;
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, th = this.theme, W = this.W, H = this.H, T = this.T;
    ctx.fillStyle = th.space_color || "#05060f"; ctx.fillRect(0, 0, W, H);
    // parallax
    var self = this;
    this._layers.forEach(function (layer) {
      var def = layer.def, spd = def.speed != null ? def.speed : 0.3;
      if (def.type === "color") { ctx.globalAlpha = def.alpha != null ? def.alpha : 0.15; ctx.fillStyle = def.color || "#20264a"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; return; }
      ctx.fillStyle = def.color || "#cfe6ff";
      layer.stars.forEach(function (st) {
        var x = (st.x - self.camX * spd) % W; if (x < 0) x += W;
        var y = (st.y - self.camY * spd * 0.6) % H; if (y < 0) y += H;
        ctx.fillRect(x, y, st.s, st.s);
      });
    });

    // tiles in view
    var c0 = Math.max(0, Math.floor(this.camX / T)), c1 = Math.min(this.cols - 1, Math.floor((this.camX + W) / T));
    var r0 = Math.max(0, Math.floor(this.camY / T)), r1 = Math.min(this.rows - 1, Math.floor((this.camY + H) / T));
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var ch = this.cfg.map[r][c];
      var sx = Math.round(c * T - this.camX), sy = Math.round(r * T - this.camY);
      if (ch === "#") {
        ctx.fillStyle = th.wall_color || "#2c3358"; ctx.fillRect(sx, sy, T, T);
        ctx.strokeStyle = th.wall_edge_color || "rgba(120,160,255,0.25)"; ctx.strokeRect(sx + 0.5, sy + 0.5, T - 1, T - 1);
      } else if (ch === this.hazard) {
        ctx.fillStyle = th.hazard_color || "#ff5a6a";
        ctx.beginPath(); ctx.moveTo(sx, sy + T); ctx.lineTo(sx + T / 2, sy + T * 0.2); ctx.lineTo(sx + T, sy + T); ctx.closePath(); ctx.fill();
      }
    }
    // exit
    var ex = this.cfg.exit, exx = ex.col * T - this.camX, exy = ex.row * T - this.camY;
    ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this._t * 4); ctx.fillStyle = th.exit_color || "#4ade80";
    ctx.fillRect(exx + 3, exy + 3, T - 6, T - 6); ctx.globalAlpha = 1;
    ctx.strokeStyle = th.exit_color || "#4ade80"; ctx.strokeRect(exx + 3, exy + 3, T - 6, T - 6);
    // collectibles
    this.collectibles.forEach(function (cc) {
      if (cc.taken) return;
      var x = (cc.col + 0.5) * T - self.camX, y = (cc.row + 0.5) * T - self.camY;
      var img = self._sprite("collectible");
      if (img) ctx.drawImage(img, x - T * 0.2, y - T * 0.2, T * 0.4, T * 0.4);
      else { ctx.fillStyle = th.collectible_color || "#ffd24a";
        ctx.save(); ctx.translate(x, y); ctx.rotate(self._t * 2); ctx.fillRect(-T * 0.15, -T * 0.15, T * 0.3, T * 0.3); ctx.restore(); }
    });

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to launch", "Arrows / WASD thrust · avoid walls & hazards · reach the exit"); return; }

    // ship
    var s = this.ship, sc = this.cfg.ship, sx = s.x - this.camX, sy = s.y - this.camY;
    if (!(s.invuln > 0 && Math.floor(this._t * 12) % 2 === 0)) {
      var img = this._sprite("ship");
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(s.angle);
      if (img) ctx.drawImage(img, -sc.width / 2, -sc.height / 2, sc.width, sc.height);
      else {
        ctx.fillStyle = sc.color || th.accent_color || "#7c5cfa";
        ctx.beginPath(); ctx.moveTo(sc.width / 2, 0); ctx.lineTo(-sc.width / 2, -sc.height / 2); ctx.lineTo(-sc.width * 0.25, 0); ctx.lineTo(-sc.width / 2, sc.height / 2); ctx.closePath(); ctx.fill();
        if (this.keys.ArrowLeft || this.keys.ArrowRight || this.keys.ArrowUp || this.keys.ArrowDown ||
            this.keys.w || this.keys.a || this.keys.s || this.keys.d) {
          ctx.fillStyle = "#ffb03a"; ctx.beginPath(); ctx.moveTo(-sc.width / 2, -3); ctx.lineTo(-sc.width * 0.8, 0); ctx.lineTo(-sc.width / 2, 3); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }

    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff"; ctx.font = "bold 13px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("♥ " + this.lives, 8, 6);
    ctx.textAlign = "center"; ctx.fillText("SCORE " + this.score, W / 2, 6);
    var total = this.collectibles.length;
    ctx.textAlign = "right"; ctx.fillText(total ? "◆ " + this.stats.collected + "/" + total : "", W - 8, 6);

    if (this.state === "win") this._overlay("LEVEL CLEARED", "Score " + this.score, "Press Enter to play again");
    if (this.state === "gameover") this._overlay("SHIP LOST", "Score " + this.score, "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa"; ctx.font = "bold 26px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 30);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff"; ctx.font = "14px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "11px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 26);
  };

  window.RadicaSpace = {
    validateConfig: validateConfig,
    mount: function (root, config, opts) {
      var errors = validateConfig(config);
      if (errors.length) {
        var box = document.createElement("div"); box.className = "rg-error";
        var h = document.createElement("h1"); h.textContent = "Invalid game configuration"; box.appendChild(h);
        var ul = document.createElement("ul");
        errors.forEach(function (m) { var li = document.createElement("li"); li.textContent = m; ul.appendChild(li); });
        box.appendChild(ul); root.appendChild(box); return null;
      }
      return new Engine(root, config, opts);
    }
  };
})();
