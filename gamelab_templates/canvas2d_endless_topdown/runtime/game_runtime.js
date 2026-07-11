/* RadicaLab GameLab — Canvas2D Endless Top-down template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN endless top-down survival/dodger engine. The world
 * scrolls downward; the player moves freely in 2D to dodge obstacles and grab
 * pickups. Score grows with distance survived plus pickups; difficulty ramps
 * over time. The game is fully described by a validated JSON configuration (see
 * ../schema.json); a generator produces configuration only — it never rewrites
 * this engine. Self-contained: HTML + CSS + vanilla JS, no frameworks, no server
 * calls, relative asset paths only, procedural fallback graphics.
 *
 * Public API:
 *   RadicaEndless.validateConfig(config) -> [readable error strings]
 *   RadicaEndless.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt).
 *
 * Controls: Arrow keys / WASD move, Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var EFFECTS = ["score", "extra_life"];

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
    var p = cfg.player || {};
    if (!pos(p.width) || !pos(p.height)) bad("player.width and player.height must be positive numbers.");
    if (!pos(p.speed)) bad("player.speed must be a positive number.");
    if (p.hitbox_scale != null && !(num(p.hitbox_scale) && p.hitbox_scale > 0 && p.hitbox_scale <= 1)) bad("player.hitbox_scale must be between 0 (exclusive) and 1.");
    var sc = cfg.scroll || {};
    if (!pos(sc.speed)) bad("scroll.speed must be a positive number.");
    var ids = {};
    if (!Array.isArray(cfg.obstacles) || !cfg.obstacles.length) bad("obstacles must be a non-empty array.");
    else cfg.obstacles.forEach(function (o, i) {
      var tag = "obstacles[" + i + "]";
      if (!str(o.id)) bad(tag + ".id must be a non-empty string."); else if (ids[o.id]) bad("Duplicate obstacle id '" + o.id + "'."); else ids[o.id] = true;
      if (!pos(o.width) || !pos(o.height)) bad(tag + ".width/height must be positive numbers.");
      if (o.speed_bonus != null && !nneg(o.speed_bonus)) bad(tag + ".speed_bonus must be a number >= 0.");
    });
    var sp = cfg.spawn || {};
    if (!pos(sp.interval)) bad("spawn.interval must be a positive number (seconds between obstacles).");
    if (sp.min_interval != null && !pos(sp.min_interval)) bad("spawn.min_interval must be a positive number when set.");
    var pids = {};
    (cfg.pickups || []).forEach(function (u, i) {
      var tag = "pickups[" + i + "]";
      if (!str(u.id)) bad(tag + ".id must be a non-empty string."); else if (pids[u.id]) bad("Duplicate pickup id '" + u.id + "'."); else pids[u.id] = true;
      if (!pos(u.size)) bad(tag + ".size must be a positive number.");
      if (u.effect && EFFECTS.indexOf(u.effect) < 0) bad(tag + ".effect must be one of: " + EFFECTS.join(", ") + ".");
      if ((!u.effect || u.effect === "score") && !nneg(u.score)) bad(tag + ".score must be a number >= 0.");
      if (u.spawn_interval != null && !pos(u.spawn_interval)) bad(tag + ".spawn_interval must be a positive number when set.");
    });
    if (!(num(cfg.lives) && cfg.lives >= 1 && cfg.lives <= 99)) bad("lives must be a number between 1 and 99.");
    var s = cfg.score || {};
    if (s.distance_per_second != null && !nneg(s.distance_per_second)) bad("score.distance_per_second must be a number >= 0.");
    var d = cfg.difficulty || {};
    if (d.ramp != null && !nneg(d.ramp)) bad("difficulty.ramp must be a number >= 0.");
    if (d.max_ramp != null && !pos(d.max_ramp)) bad("difficulty.max_ramp must be a positive number when set.");
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
    this.theme = cfg.theme || {};
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
    this.stats = { dodged: 0, collected: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.className = "rg-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._onKeyDown = this._key.bind(this, true);
    this._onKeyUp = this._key.bind(this, false);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    this._lines = this._makeLines();
    this._resetRun();
    this._raf = null; this._last = 0;
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(k) >= 0 && ev.preventDefault) ev.preventDefault();
    if (down && k === "Enter" && this.state !== "playing") this.startGame();
  };

  Engine.prototype._makeLines = function () {
    var a = [];
    for (var i = 0; i < 40; i++) a.push({ x: Math.random() * this.W, y: Math.random() * this.H, len: 8 + Math.random() * 20 });
    return a;
  };

  Engine.prototype._resetRun = function () {
    var p = this.cfg.player;
    this.player = { x: this.W / 2, y: this.H * 0.78, w: p.width, h: p.height, invuln: 0 };
    this.obstacles = [];
    this.pickups = [];
    this.score = 0;
    this.lives = this.cfg.lives;
    this.t = 0;
    this.obTimer = 0;
    this.pickTimers = (this.cfg.pickups || []).map(function (u) { return u.spawn_interval || 6; });
    this._scroll = 0;
    this.stats = { dodged: 0, collected: 0 };
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype._ramp = function () {
    var d = this.cfg.difficulty || {};
    var r = 1 + this.t * (d.ramp != null ? d.ramp : 0.02);
    return d.max_ramp ? Math.min(r, d.max_ramp) : Math.min(r, 6);
  };

  Engine.prototype._spawnObstacle = function () {
    var list = this.cfg.obstacles, def = list[Math.floor(Math.random() * list.length)];
    this.obstacles.push({ def: def, x: def.width / 2 + Math.random() * (this.W - def.width),
      y: -def.height, w: def.width, h: def.height });
  };

  Engine.prototype._spawnPickup = function (def) {
    this.pickups.push({ def: def, x: def.size + Math.random() * (this.W - def.size * 2), y: -def.size });
  };

  Engine.prototype.step = function (dt) {
    var ramp = this.state === "playing" ? this._ramp() : 1;
    var scroll = this.cfg.scroll.speed * ramp;
    this._scroll = (this._scroll + scroll * dt) % 40;
    if (this.state !== "playing") { this.draw(); return; }
    this.t += dt;
    this.score += (this.cfg.score && this.cfg.score.distance_per_second != null ? this.cfg.score.distance_per_second : 10) * ramp * dt;

    var p = this.player, sp = this.cfg.player.speed;
    var vx = 0, vy = 0;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) vx -= 1;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) vx += 1;
    if (this.keys.ArrowUp || this.keys.w || this.keys.W) vy -= 1;
    if (this.keys.ArrowDown || this.keys.s || this.keys.S) vy += 1;
    p.x = Math.max(p.w / 2, Math.min(this.W - p.w / 2, p.x + vx * sp * dt));
    p.y = Math.max(p.h / 2, Math.min(this.H - p.h / 2, p.y + vy * sp * dt));
    if (p.invuln > 0) p.invuln -= dt;

    // spawn obstacles
    this.obTimer -= dt;
    var interval = Math.max((this.cfg.spawn.min_interval || 0.4), this.cfg.spawn.interval / ramp);
    if (this.obTimer <= 0) { this.obTimer = interval; this._spawnObstacle(); }
    // spawn pickups
    var self = this;
    (this.cfg.pickups || []).forEach(function (def, i) {
      self.pickTimers[i] -= dt;
      if (self.pickTimers[i] <= 0) { self.pickTimers[i] = def.spawn_interval || 6; self._spawnPickup(def); }
    });

    // move obstacles
    this.obstacles = this.obstacles.filter(function (o) {
      o.y += (scroll + (o.def.speed_bonus || 0)) * dt;
      if (o.y - o.h / 2 > self.H) { self.stats.dodged++; return false; }
      return true;
    });
    this.pickups = this.pickups.filter(function (u) { u.y += scroll * dt; return u.y - u.def.size < self.H; });

    // collisions
    var hs = this.cfg.player.hitbox_scale != null ? this.cfg.player.hitbox_scale : 0.8;
    var pw = p.w * hs, ph = p.h * hs;
    if (p.invuln <= 0) {
      for (var i = 0; i < this.obstacles.length; i++) {
        var o = this.obstacles[i];
        if (Math.abs(o.x - p.x) * 2 < o.w * 0.9 + pw && Math.abs(o.y - p.y) * 2 < o.h * 0.9 + ph) {
          this._hit(); break;
        }
      }
    }
    this.pickups = this.pickups.filter(function (u) {
      if (Math.abs(u.x - p.x) * 2 < u.def.size + pw && Math.abs(u.y - p.y) * 2 < u.def.size + ph) {
        if (u.def.effect === "extra_life") self.lives = Math.min(self.lives + 1, 99);
        else self.score += u.def.score || 50;
        self.stats.collected++;
        return false;
      }
      return true;
    });
    this.draw();
  };

  Engine.prototype._hit = function () {
    this.lives--;
    if (this.lives <= 0) { this.state = "gameover"; return; }
    this.player.invuln = 1.5;
    // clear obstacles overlapping the player so respawn is fair
    var p = this.player, self = this;
    this.obstacles = this.obstacles.filter(function (o) { return Math.abs(o.y - p.y) > self.H * 0.2; });
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, th = this.theme, W = this.W, H = this.H;
    ctx.fillStyle = th.background_color || "#0e1424"; ctx.fillRect(0, 0, W, H);
    // scrolling motion streaks
    ctx.strokeStyle = th.line_color || "rgba(255,255,255,0.08)"; ctx.lineWidth = 2;
    var self = this;
    this._lines.forEach(function (l) {
      var y = (l.y + self._scroll * 3) % H;
      ctx.beginPath(); ctx.moveTo(l.x, y); ctx.lineTo(l.x, y + l.len); ctx.stroke();
    });

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "Arrows / WASD to dodge — survive!"); return; }

    // pickups
    this.pickups.forEach(function (u) {
      var img = self._sprite("pickup_" + u.def.id);
      if (img) { ctx.drawImage(img, u.x - u.def.size, u.y - u.def.size, u.def.size * 2, u.def.size * 2); return; }
      ctx.fillStyle = u.def.color || (u.def.effect === "extra_life" ? "#ff5a6a" : "#4ade80");
      ctx.beginPath(); ctx.arc(u.x, u.y, u.def.size, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0b0b12"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(u.def.effect === "extra_life" ? "+" : "$", u.x, u.y + 1);
    });
    // obstacles
    this.obstacles.forEach(function (o) {
      var img = self._sprite("obstacle_" + o.def.id);
      if (img) ctx.drawImage(img, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      else {
        ctx.fillStyle = o.def.color || "#ff5a6a";
        ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, 4);
      }
    });
    // player
    var p = this.player;
    if (!(p.invuln > 0 && Math.floor(this.t * 10) % 2 === 0)) {
      var pimg = this._sprite("player");
      if (pimg) ctx.drawImage(pimg, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      else {
        ctx.fillStyle = (this.cfg.player && this.cfg.player.color) || th.accent_color || "#7c5cfa";
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.h / 2); ctx.lineTo(p.x - p.w / 2, p.y + p.h / 2);
        ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2); ctx.closePath(); ctx.fill();
      }
    }
    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff"; ctx.font = "bold 14px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("SCORE " + Math.floor(this.score), 8, 8);
    ctx.textAlign = "right"; ctx.fillText("♥ " + this.lives, W - 8, 8);

    if (this.state === "gameover") this._overlay("GAME OVER", "Score " + Math.floor(this.score), "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa"; ctx.font = "bold 28px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 32);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff"; ctx.font = "15px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 28);
  };

  window.RadicaEndless = {
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
