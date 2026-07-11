/* RadicaLab GameLab — Canvas2D Lane Runner template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN endless lane runner (Subway Surfers style) rendered
 * with a simple pseudo-3D forward perspective: fixed lanes converging to a
 * horizon, the world rushes toward the player who switches lanes, jumps over low
 * obstacles, ducks under overhead ones, must change lane for full blocks, and
 * collects coins. The game is fully described by a validated JSON configuration
 * (see ../schema.json); a generator produces configuration only — it never
 * rewrites this engine. Self-contained: HTML + CSS + vanilla JS, no frameworks,
 * no server calls, relative asset paths only, procedural fallback graphics.
 *
 * Public API:
 *   RadicaRunner.validateConfig(config) -> [readable error strings]
 *   RadicaRunner.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt); switchLane/jump/duck helpers.
 *
 * Controls: Left/Right (A/D) switch lane, Up/Space jump, Down/S duck,
 *           Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var OB_TYPES = ["jump", "duck", "block"];

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
    if (!(num(cfg.lanes) && cfg.lanes >= 2 && cfg.lanes <= 6)) bad("lanes must be a number between 2 and 6.");
    var p = cfg.player || {};
    if (!pos(p.width) || !pos(p.height)) bad("player.width and player.height must be positive numbers.");
    if (p.jump_duration != null && !pos(p.jump_duration)) bad("player.jump_duration must be a positive number when set.");
    if (p.duck_duration != null && !pos(p.duck_duration)) bad("player.duck_duration must be a positive number when set.");
    var s = cfg.speed || {};
    if (!pos(s.base)) bad("speed.base must be a positive number (world units/sec).");
    if (s.max != null && !pos(s.max)) bad("speed.max must be a positive number when set.");
    if (s.ramp != null && !nneg(s.ramp)) bad("speed.ramp must be a number >= 0.");
    var ids = {};
    if (!Array.isArray(cfg.obstacles) || !cfg.obstacles.length) bad("obstacles must be a non-empty array.");
    else cfg.obstacles.forEach(function (o, i) {
      var tag = "obstacles[" + i + "]";
      if (!str(o.id)) bad(tag + ".id must be a non-empty string."); else if (ids[o.id]) bad("Duplicate obstacle id '" + o.id + "'."); else ids[o.id] = true;
      if (OB_TYPES.indexOf(o.type) < 0) bad(tag + ".type must be one of: " + OB_TYPES.join(", ") + ".");
    });
    var sp = cfg.spawn || {};
    if (!pos(sp.interval_distance)) bad("spawn.interval_distance must be a positive number (world units between rows).");
    if (sp.obstacle_chance != null && !(num(sp.obstacle_chance) && sp.obstacle_chance >= 0 && sp.obstacle_chance <= 1)) bad("spawn.obstacle_chance must be between 0 and 1.");
    if (sp.coin_chance != null && !(num(sp.coin_chance) && sp.coin_chance >= 0 && sp.coin_chance <= 1)) bad("spawn.coin_chance must be between 0 and 1.");
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
    this.theme = cfg.theme || {};
    this.lanes = cfg.lanes;
    this.zFar = cfg.draw_distance || 900;
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
    this.stats = { coins: 0, dodged: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.className = "rg-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._onKeyDown = this._key.bind(this, true);
    this._onKeyUp = this._key.bind(this, false);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(k) >= 0 && ev.preventDefault) ev.preventDefault();
    if (!down) return;
    if (k === "Enter") { if (this.state !== "playing") this.startGame(); return; }
    if (this.state !== "playing") return;
    if (k === "ArrowLeft" || k === "a" || k === "A") this.switchLane(-1);
    else if (k === "ArrowRight" || k === "d" || k === "D") this.switchLane(1);
    else if (k === "ArrowUp" || k === "Space" || k === "w" || k === "W") this.jump();
    else if (k === "ArrowDown" || k === "s" || k === "S") this.duck();
  };

  Engine.prototype._resetRun = function () {
    this.player = { lane: Math.floor(this.lanes / 2), laneX: Math.floor(this.lanes / 2), air: 0, duck: 0, invuln: 0 };
    this.obstacles = [];
    this.coins = [];
    this.speed = this.cfg.speed.base;
    this.time = 0;
    this.score = 0;
    this.lives = this.cfg.lives;
    this.sinceSpawn = 0;
    this.stats = { coins: 0, dodged: 0 };
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype.switchLane = function (dir) {
    if (this.state !== "playing") return;
    this.player.lane = Math.max(0, Math.min(this.lanes - 1, this.player.lane + dir));
  };
  Engine.prototype.jump = function () {
    if (this.state !== "playing" || this.player.air > 0 || this.player.duck > 0) return;
    this.player.air = this.cfg.player.jump_duration || 0.6;
    this._airMax = this.player.air;
  };
  Engine.prototype.duck = function () {
    if (this.state !== "playing" || this.player.air > 0 || this.player.duck > 0) return;
    this.player.duck = this.cfg.player.duck_duration || 0.5;
  };

  Engine.prototype._spawnRow = function () {
    var sp = this.cfg.spawn;
    var lanesArr = []; for (var i = 0; i < this.lanes; i++) lanesArr.push(i);
    // obstacle
    if (Math.random() < (sp.obstacle_chance != null ? sp.obstacle_chance : 0.75)) {
      var lane = lanesArr[Math.floor(Math.random() * lanesArr.length)];
      var def = this.cfg.obstacles[Math.floor(Math.random() * this.cfg.obstacles.length)];
      this.obstacles.push({ lane: lane, z: this.zFar, def: def, resolved: false });
      lanesArr.splice(lanesArr.indexOf(lane), 1);
    }
    // coins in a different lane
    if (lanesArr.length && Math.random() < (sp.coin_chance != null ? sp.coin_chance : 0.6)) {
      var cl = lanesArr[Math.floor(Math.random() * lanesArr.length)];
      for (var c = 0; c < 4; c++) this.coins.push({ lane: cl, z: this.zFar + c * 60, taken: false });
    }
  };

  Engine.prototype.step = function (dt) {
    if (this.state !== "playing") { this.draw(); return; }
    this.time += dt;
    var s = this.cfg.speed;
    this.speed = Math.min(s.max || s.base * 3, s.base + (s.ramp || 0) * this.time);
    var travel = this.speed * dt;
    this.score += (this.cfg.score && this.cfg.score.distance_per_unit != null ? this.cfg.score.distance_per_unit : 0.1) * travel;

    // player timers + lane tween
    var p = this.player;
    if (p.air > 0) p.air -= dt;
    if (p.duck > 0) p.duck -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    p.laneX += (p.lane - p.laneX) * Math.min(1, dt * 12);

    // spawn
    this.sinceSpawn += travel;
    if (this.sinceSpawn >= this.cfg.spawn.interval_distance) { this.sinceSpawn -= this.cfg.spawn.interval_distance; this._spawnRow(); }

    // advance world
    var self = this;
    this.obstacles.forEach(function (o) { o.z -= travel; });
    this.coins.forEach(function (c) { c.z -= travel; });

    // resolve obstacles crossing the player plane
    this.obstacles.forEach(function (o) {
      if (o.resolved || o.z > 0) return;
      o.resolved = true;
      if (o.lane === p.lane && p.invuln <= 0) {
        var safe = (o.def.type === "jump" && p.air > 0) || (o.def.type === "duck" && p.duck > 0);
        if (!safe) self._hit();
        else self.stats.dodged++;
      } else self.stats.dodged++;
    });
    this.obstacles = this.obstacles.filter(function (o) { return o.z > -80; });

    // coins
    this.coins.forEach(function (c) {
      if (c.taken || c.z > 0) return;
      c.taken = true;
      if (c.lane === p.lane) { self.score += (self.cfg.coins && self.cfg.coins.value != null ? self.cfg.coins.value : 10); self.stats.coins++; }
    });
    this.coins = this.coins.filter(function (c) { return c.z > -80; });

    this.draw();
  };

  Engine.prototype._hit = function () {
    this.lives--;
    if (this.lives <= 0) { this.state = "gameover"; return; }
    this.player.invuln = 1.5;
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  // pseudo-3D projection helpers
  Engine.prototype._scale = function (z) { return 1 - Math.max(0, Math.min(1, z / this.zFar)); };
  Engine.prototype._screenY = function (z) {
    var horizon = this.H * 0.30, base = this.H * 0.9;
    return base - (base - horizon) * (Math.max(0, Math.min(1, z / this.zFar)));
  };
  Engine.prototype._roadHalf = function (z) {
    var s = this._scale(z);
    return this.W * 0.08 + (this.W * 0.44 - this.W * 0.08) * s;
  };
  Engine.prototype._laneX = function (lane, laneFloat, z) {
    var l = laneFloat != null ? laneFloat : lane;
    var frac = (l + 0.5) / this.lanes * 2 - 1;
    return this.W / 2 + frac * this._roadHalf(z);
  };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, th = this.theme, W = this.W, H = this.H;
    var horizon = this.H * 0.30;
    ctx.fillStyle = th.sky_color || "#1a2340"; ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = th.ground_color || "#12331f"; ctx.fillRect(0, horizon, W, H - horizon);
    // road trapezoid
    var rNear = this._roadHalf(0), rFar = this._roadHalf(this.zFar);
    ctx.fillStyle = th.road_color || "#3a3a44";
    ctx.beginPath();
    ctx.moveTo(W / 2 - rFar, horizon); ctx.lineTo(W / 2 + rFar, horizon);
    ctx.lineTo(W / 2 + rNear, this._screenY(0)); ctx.lineTo(W / 2 - rNear, this._screenY(0));
    ctx.closePath(); ctx.fill();
    // lane dividers
    ctx.strokeStyle = th.lane_color || "rgba(255,255,255,0.35)"; ctx.lineWidth = 2;
    for (var l = 1; l < this.lanes; l++) {
      var fracL = l / this.lanes * 2 - 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 + fracL * rFar, horizon);
      ctx.lineTo(W / 2 + fracL * rNear, this._screenY(0));
      ctx.stroke();
    }

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "←/→ lane · ↑ jump · ↓ duck · collect coins"); return; }

    // draw coins + obstacles far-to-near
    var items = [];
    var self = this;
    this.coins.forEach(function (c) { if (!c.taken && c.z < self.zFar + 240 && c.z > -80) items.push({ kind: "coin", z: c.z, o: c }); });
    this.obstacles.forEach(function (o) { if (o.z < self.zFar + 40 && o.z > -80) items.push({ kind: "ob", z: o.z, o: o }); });
    items.sort(function (a, b) { return b.z - a.z; });
    items.forEach(function (it) {
      var z = Math.max(0, it.z), sc = self._scale(z), y = self._screenY(z), x = self._laneX(it.o.lane, null, z);
      if (it.kind === "coin") {
        var img = self._sprite("coin");
        var r = Math.max(2, 16 * sc);
        if (img) ctx.drawImage(img, x - r, y - r * 2, r * 2, r * 2);
        else { ctx.fillStyle = (self.cfg.coins && self.cfg.coins.color) || th.coin_color || "#ffd24a";
          ctx.beginPath(); ctx.arc(x, y - r, r, 0, Math.PI * 2); ctx.fill(); }
      } else {
        var od = it.o.def, ow = Math.max(4, (od.width || 60) * sc), oh;
        var img2 = self._sprite("obstacle_" + od.id);
        var color = od.color || (od.type === "jump" ? "#ff5a6a" : od.type === "duck" ? "#5ac8fa" : "#ffb03a");
        if (od.type === "jump") oh = Math.max(4, 26 * sc);              // low barrier
        else if (od.type === "duck") oh = Math.max(4, 30 * sc);         // overhead bar (drawn high)
        else oh = Math.max(6, 70 * sc);                                 // full block
        if (img2) ctx.drawImage(img2, x - ow / 2, (od.type === "duck" ? y - 90 * sc : y - oh), ow, oh);
        else {
          ctx.fillStyle = color;
          if (od.type === "duck") ctx.fillRect(x - ow / 2, y - 92 * sc, ow, oh);
          else ctx.fillRect(x - ow / 2, y - oh, ow, oh);
        }
      }
    });

    // player
    var p = this.player, T = this.cfg.player;
    var px = this._laneX(0, p.laneX, 0), pbase = this._screenY(0);
    var jumpH = p.air > 0 ? Math.sin((1 - p.air / (this._airMax || 0.6)) * Math.PI) * 70 : 0;
    var pw = T.width, ph = T.height * (p.duck > 0 ? 0.55 : 1);
    if (!(p.invuln > 0 && Math.floor(this.time * 12) % 2 === 0)) {
      var pimg = this._sprite("player");
      if (pimg) ctx.drawImage(pimg, px - pw / 2, pbase - ph - jumpH, pw, ph);
      else {
        ctx.fillStyle = T.color || th.accent_color || "#7c5cfa";
        ctx.fillRect(px - pw / 2, pbase - ph - jumpH, pw, ph);
        ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillRect(px - pw / 2, pbase - ph - jumpH, pw, 5);
      }
    }
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath();
    ctx.ellipse(px, pbase, pw * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();

    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff"; ctx.font = "bold 14px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("SCORE " + Math.floor(this.score), 8, 8);
    ctx.textAlign = "center"; ctx.fillText("◎ " + this.stats.coins, W / 2, 8);
    ctx.textAlign = "right"; ctx.fillText("♥ " + this.lives, W - 8, 8);

    if (this.state === "gameover") this._overlay("GAME OVER", "Score " + Math.floor(this.score) + "  ·  " + this.stats.coins + " coins", "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa"; ctx.font = "bold 28px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 32);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff"; ctx.font = "14px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 28);
  };

  window.RadicaRunner = {
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
