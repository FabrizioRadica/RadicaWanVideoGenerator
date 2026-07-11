/* RadicaLab GameLab — Canvas2D Top-down Racing template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN top-down time-trial racing engine. The whole track
 * is shown at once; you drive a car around a JSON tile track through ordered
 * checkpoints for a number of laps, against the clock (total time + best lap).
 * The game is fully described by a validated JSON configuration (see
 * ../schema.json); a generator produces configuration only — it never rewrites
 * this engine. Self-contained: HTML + CSS + vanilla JS, no frameworks, no server
 * calls, relative asset paths only, procedural fallback graphics.
 *
 * Time trial (no AI opponents in v1). Off-track grass slows the car; walls stop it.
 *
 * Public API:
 *   RadicaRacer.validateConfig(config) -> [readable error strings]
 *   RadicaRacer.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt).
 *
 * Controls: ArrowUp/W accelerate, ArrowDown/S brake/reverse, ArrowLeft/Right or
 *           A/D steer, Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  function num(v) { return typeof v === "number" && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }
  function nneg(v) { return num(v) && v >= 0; }
  function str(v) { return typeof v === "string" && v.length > 0; }

  function validateConfig(cfg) {
    var e = [];
    function bad(m) { e.push(m); }
    if (!cfg || typeof cfg !== "object") return ["Configuration must be a JSON object."];
    if (!str(cfg.title)) bad("title must be a non-empty string.");
    if (!pos(cfg.tile_size)) bad("tile_size must be a positive number.");

    var rows = 0, cols = 0, grid = null;
    if (!Array.isArray(cfg.map) || !cfg.map.length) bad("map must be a non-empty array of strings.");
    else {
      rows = cfg.map.length; cols = cfg.map[0].length;
      if (cfg.map.some(function (r) { return typeof r !== "string"; })) bad("every map row must be a string.");
      else if (!cols) bad("map rows must not be empty.");
      else if (cfg.map.some(function (r) { return r.length !== cols; })) bad("map must be rectangular (all rows same length).");
      else grid = cfg.map;
    }
    function drivable(c, r) { return grid && r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== "#"; }
    function coordOk(o, label) {
      if (!o || !num(o.col) || !num(o.row)) { bad(label + " must have numeric col/row."); return; }
      if (o.col < 0 || o.col >= cols || o.row < 0 || o.row >= rows) { bad(label + " is outside the map."); return; }
      if (!drivable(o.col, o.row)) bad(label + " is on a wall tile.");
    }
    if (grid) {
      if (!cfg.start) bad("start is required."); else { coordOk(cfg.start, "start"); if (cfg.start.heading_deg != null && !num(cfg.start.heading_deg)) bad("start.heading_deg must be a number."); }
      if (!Array.isArray(cfg.checkpoints) || cfg.checkpoints.length < 2) bad("checkpoints must be an array with at least 2 entries (including start/finish at index 0).");
      else cfg.checkpoints.forEach(function (c, i) { coordOk(c, "checkpoints[" + i + "]"); });
    }
    var car = cfg.car || {};
    if (!pos(car.width) || !pos(car.length)) bad("car.width and car.length must be positive numbers.");
    if (!pos(car.accel)) bad("car.accel must be a positive number.");
    if (!pos(car.max_speed)) bad("car.max_speed must be a positive number.");
    if (!pos(car.turn_rate)) bad("car.turn_rate must be a positive number (radians/sec).");
    if (car.brake != null && !pos(car.brake)) bad("car.brake must be a positive number when set.");
    if (car.grass_max_speed != null && !pos(car.grass_max_speed)) bad("car.grass_max_speed must be a positive number when set.");
    if (car.friction != null && !(num(car.friction) && car.friction >= 0 && car.friction <= 1)) bad("car.friction must be between 0 and 1 (coasting decay per second).");
    if (!(num(cfg.laps) && cfg.laps >= 1 && cfg.laps <= 99)) bad("laps must be a number between 1 and 99.");
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
    this.T = cfg.tile_size;
    this.rows = cfg.map.length; this.cols = cfg.map[0].length;
    this.W = this.cols * this.T; this.H = this.rows * this.T;
    this.theme = cfg.theme || {};
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(k) >= 0 && ev.preventDefault) ev.preventDefault();
    if (down && k === "Enter" && this.state !== "racing") this.startGame();
  };

  Engine.prototype._resetRun = function () {
    var s = this.cfg.start, T = this.T;
    this.car = { x: (s.col + 0.5) * T, y: (s.row + 0.5) * T,
      heading: (s.heading_deg != null ? s.heading_deg : 0) * Math.PI / 180, speed: 0 };
    this.time = 0;
    this.lap = 0;
    this.seqPos = 0; // index into checkpoints[] that must be crossed next
    this.lapTimes = [];
    this._lapStart = 0;
    this.bestLap = null;
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "racing"; };

  Engine.prototype._tileChar = function (px, py) {
    var c = Math.floor(px / this.T), r = Math.floor(py / this.T);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return "#";
    return this.cfg.map[r][c];
  };
  Engine.prototype._isWall = function (px, py) { return this._tileChar(px, py) === "#"; };
  Engine.prototype._isGrass = function (px, py) { var ch = this._tileChar(px, py); return ch !== "#" && ch !== "."; };

  Engine.prototype.step = function (dt) {
    if (this.state !== "racing") { this.draw(); return; }
    this.time += dt;
    var car = this.car, c = this.cfg.car;
    var accel = c.accel, maxS = c.max_speed, brake = c.brake || c.accel * 1.4;
    var grassMax = c.grass_max_speed || maxS * 0.4;
    var turn = c.turn_rate, friction = c.friction != null ? c.friction : 0.7;

    if (this.keys.ArrowUp || this.keys.w || this.keys.W) car.speed += accel * dt;
    else if (this.keys.ArrowDown || this.keys.s || this.keys.S) car.speed -= brake * dt;
    else car.speed *= Math.max(0, 1 - friction * dt); // coast

    // steering scales with speed and works in reverse
    var steer = 0;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) steer -= 1;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) steer += 1;
    var grip = Math.min(1, Math.abs(car.speed) / 40);
    car.heading += steer * turn * dt * grip * (car.speed < 0 ? -1 : 1);

    // clamp speed (surface aware)
    var onGrass = this._isGrass(car.x, car.y);
    var cap = onGrass ? grassMax : maxS;
    if (car.speed > cap) car.speed = cap;
    if (car.speed < -cap * 0.5) car.speed = -cap * 0.5;

    var nx = car.x + Math.cos(car.heading) * car.speed * dt;
    var ny = car.y + Math.sin(car.heading) * car.speed * dt;
    // wall collision: block per-axis, kill speed on impact
    if (!this._isWall(nx, car.y)) car.x = nx; else car.speed *= -0.15;
    if (!this._isWall(car.x, ny)) car.y = ny; else car.speed *= -0.15;

    // checkpoint / lap logic
    var target = this.cfg.checkpoints[this.seqPos];
    if (Math.floor(car.x / this.T) === target.col && Math.floor(car.y / this.T) === target.row) {
      this.seqPos++;
      if (this.seqPos >= this.cfg.checkpoints.length) {
        this.seqPos = 0;
        var lapTime = this.time - this._lapStart; this._lapStart = this.time;
        this.lapTimes.push(lapTime);
        if (this.bestLap == null || lapTime < this.bestLap) this.bestLap = lapTime;
        this.lap++;
        if (this.lap >= this.cfg.laps) this.state = "finished";
      }
    }
    this.draw();
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };
  Engine.prototype._fmt = function (t) { return t == null ? "--:--" : (Math.floor(t / 60) + ":" + ("0" + (t % 60).toFixed(2)).slice(-5)); };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, T = this.T, th = this.theme;
    // tiles
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      var ch = this.cfg.map[r][c];
      ctx.fillStyle = ch === "#" ? (th.wall_color || "#2a2540") : (ch === "." ? (th.road_color || "#3a3a44") : (th.grass_color || "#245a35"));
      ctx.fillRect(c * T, r * T, T, T);
      if (ch === ".") { ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.strokeRect(c * T + 0.5, r * T + 0.5, T - 1, T - 1); }
    }
    // checkpoints
    this.cfg.checkpoints.forEach(function (cp, i) {
      var isNext = i === this.seqPos && this.state === "racing";
      var isFinish = i === 0;
      ctx.globalAlpha = isNext ? 0.55 : 0.2;
      ctx.fillStyle = isFinish ? (th.accent_color || "#7c5cfa") : "#4ade80";
      ctx.fillRect(cp.col * T + 3, cp.row * T + 3, T - 6, T - 6);
      ctx.globalAlpha = 1;
      if (isFinish) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        for (var yy = 0; yy < 4; yy++) for (var xx = 0; xx < 4; xx++) if ((xx + yy) % 2 === 0) ctx.fillRect(cp.col * T + 4 + xx * (T - 8) / 4, cp.row * T + 4 + yy * (T - 8) / 4, (T - 8) / 4, (T - 8) / 4);
      }
    }, this);

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "Up accelerate · Down brake · Left/Right steer"); return; }

    // car
    var car = this.car, cc = this.cfg.car, img = this._sprite("car");
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.heading);
    if (img) ctx.drawImage(img, -cc.length / 2, -cc.width / 2, cc.length, cc.width);
    else {
      ctx.fillStyle = cc.color || th.accent_color || "#7c5cfa";
      ctx.fillRect(-cc.length / 2, -cc.width / 2, cc.length, cc.width);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(cc.length / 2 - 5, -cc.width / 2 + 2, 4, cc.width - 4); // nose
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-cc.length / 4, -cc.width / 2, cc.length / 3, cc.width); // cockpit
    }
    ctx.restore();

    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff"; ctx.font = "bold 13px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("LAP " + Math.min(this.lap + 1, this.cfg.laps) + "/" + this.cfg.laps, 8, 6);
    ctx.textAlign = "center"; ctx.fillText("TIME " + this._fmt(this.time), this.W / 2, 6);
    ctx.textAlign = "right"; ctx.fillText("BEST " + this._fmt(this.bestLap), this.W - 8, 6);

    if (this.state === "finished") this._overlay("FINISH!", "Total " + this._fmt(this.time) + "  ·  Best lap " + this._fmt(this.bestLap), "Press Enter to race again");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa"; ctx.font = "bold 28px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 30);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff"; ctx.font = "14px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 28);
  };

  window.RadicaRacer = {
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
