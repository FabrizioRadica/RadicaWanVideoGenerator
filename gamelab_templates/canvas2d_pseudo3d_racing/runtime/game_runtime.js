/* RadicaLab GameLab — Canvas2D Pseudo-3D Racing template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN pseudo-3D road racer (OutRun style) using the classic
 * projected-road-segment technique: the track is a list of straight/curve/hill
 * sections built into z-segments, projected each frame from a chase camera to
 * fake 3D on a flat 2D canvas (NO real 3D, NO Three.js). Drive through the laps
 * against the clock; grass off-road slows you; optional light traffic to weave
 * through. The game is fully described by a validated JSON configuration (see
 * ../schema.json); a generator produces configuration only — it never rewrites
 * this engine. Self-contained: HTML + CSS + vanilla JS, no frameworks, no server
 * calls, relative asset paths only, procedural fallback graphics.
 *
 * Public API:
 *   RadicaOutrun.validateConfig(config) -> [readable error strings]
 *   RadicaOutrun.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt).
 *
 * Controls: ArrowUp/W accelerate, ArrowDown/S brake, Left/Right or A/D steer,
 *           Enter starts/restarts.
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
    var cv = cfg.canvas || {};
    if (!(num(cv.width) && cv.width >= 160 && cv.width <= 1920)) bad("canvas.width must be a number between 160 and 1920.");
    if (!(num(cv.height) && cv.height >= 160 && cv.height <= 1920)) bad("canvas.height must be a number between 160 and 1920.");
    var rd = cfg.road || {};
    if (!pos(rd.segment_length)) bad("road.segment_length must be a positive number.");
    if (!pos(rd.road_width)) bad("road.road_width must be a positive number.");
    if (rd.lanes != null && !(num(rd.lanes) && rd.lanes >= 1 && rd.lanes <= 8)) bad("road.lanes must be a number between 1 and 8 when set.");
    if (rd.draw_distance != null && !(num(rd.draw_distance) && rd.draw_distance >= 30 && rd.draw_distance <= 600)) bad("road.draw_distance must be between 30 and 600 segments when set.");
    if (rd.fov != null && !(num(rd.fov) && rd.fov > 10 && rd.fov < 170)) bad("road.fov must be between 10 and 170 degrees when set.");
    if (rd.camera_height != null && !pos(rd.camera_height)) bad("road.camera_height must be a positive number when set.");
    if (rd.rumble_segments != null && !pos(rd.rumble_segments)) bad("road.rumble_segments must be a positive number when set.");
    var car = cfg.car || {};
    if (!pos(car.max_speed)) bad("car.max_speed must be a positive number (world units/sec).");
    if (!pos(car.accel)) bad("car.accel must be a positive number.");
    if (car.brake != null && !pos(car.brake)) bad("car.brake must be a positive number when set.");
    if (car.decel != null && !pos(car.decel)) bad("car.decel must be a positive number when set.");
    if (car.off_road_decel != null && !pos(car.off_road_decel)) bad("car.off_road_decel must be a positive number when set.");
    if (car.off_road_limit != null && !pos(car.off_road_limit)) bad("car.off_road_limit must be a positive number when set.");
    if (car.centrifugal != null && !nneg(car.centrifugal)) bad("car.centrifugal must be a number >= 0 when set.");
    if (car.steer != null && !pos(car.steer)) bad("car.steer must be a positive number when set.");
    if (!Array.isArray(cfg.track) || !cfg.track.length) bad("track must be a non-empty array of sections.");
    else cfg.track.forEach(function (s, i) {
      var tag = "track[" + i + "]";
      if (!(num(s.length) && s.length >= 1 && s.length <= 2000)) bad(tag + ".length must be a number between 1 and 2000 (segments).");
      if (s.curve != null && !num(s.curve)) bad(tag + ".curve must be a number.");
      if (s.hill != null && !num(s.hill)) bad(tag + ".hill must be a number.");
    });
    if (cfg.laps != null && !(num(cfg.laps) && cfg.laps >= 1 && cfg.laps <= 99)) bad("laps must be a number between 1 and 99 when set.");
    var tr = cfg.traffic;
    if (tr != null) {
      if (typeof tr !== "object") bad("traffic must be an object when set.");
      else {
        if (tr.count != null && !(num(tr.count) && tr.count >= 0 && tr.count <= 60)) bad("traffic.count must be a number between 0 and 60.");
        if (tr.speed_factor != null && !(num(tr.speed_factor) && tr.speed_factor >= 0 && tr.speed_factor < 1)) bad("traffic.speed_factor must be between 0 and 1.");
      }
    }
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
    var rd = cfg.road;
    this.segLen = rd.segment_length;
    this.roadWidth = rd.road_width;
    this.lanes = rd.lanes || 3;
    this.drawDistance = rd.draw_distance || 160;
    this.rumble = rd.rumble_segments || 4;
    this.cameraHeight = rd.camera_height || 1000;
    this.fov = rd.fov || 100;
    this.cameraDepth = 1 / Math.tan((this.fov / 2) * Math.PI / 180);
    this.playerZ = this.cameraHeight * this.cameraDepth;
    this.laps = cfg.laps || 1;
    this._buildTrack();
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

  Engine.prototype._buildTrack = function () {
    this.segments = [];
    var y = 0, idx = 0, self = this;
    this.cfg.track.forEach(function (sec) {
      var n = Math.round(sec.length), curve = sec.curve || 0;
      var hillPer = (sec.hill || 0) / n;
      for (var i = 0; i < n; i++) {
        var y1 = y, y2 = y + hillPer; y = y2;
        self.segments.push({
          index: idx,
          p1: { world: { y: y1, z: idx * self.segLen }, camera: {}, screen: {} },
          p2: { world: { y: y2, z: (idx + 1) * self.segLen }, camera: {}, screen: {} },
          curve: curve,
          color: Math.floor(idx / self.rumble) % 2
        });
        idx++;
      }
    });
    this.N = this.segments.length;
    this.trackLength = this.N * this.segLen;
  };

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
    this.position = 0;      // z along the track (mod trackLength)
    this.traveled = 0;      // cumulative distance
    this.playerX = 0;       // -1..1 across the road (can drift a bit further)
    this.speed = 0;
    this.time = 0;
    this.lap = 0;
    this._lapStart = 0;
    this.bestLap = null;
    this._buildTraffic();
  };

  Engine.prototype._buildTraffic = function () {
    this.traffic = [];
    var tr = this.cfg.traffic;
    if (!tr || !tr.count) return;
    var carSpeed = this.cfg.car.max_speed * (tr.speed_factor != null ? tr.speed_factor : 0.5);
    for (var i = 0; i < tr.count; i++) {
      this.traffic.push({ z: (i / tr.count) * this.trackLength, x: (Math.random() * 1.6 - 0.8), speed: carSpeed });
    }
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "racing"; };

  Engine.prototype._segAt = function (z) {
    return this.segments[Math.floor(z / this.segLen) % this.N];
  };

  Engine.prototype.step = function (dt) {
    if (this.state !== "racing") { this.draw(); return; }
    this.time += dt;
    var car = this.cfg.car, maxS = car.max_speed;
    var accel = car.accel, brake = car.brake || maxS, decel = car.decel || maxS * 0.3;
    var offDecel = car.off_road_decel || maxS * 0.5, offLimit = car.off_road_limit || maxS * 0.25;
    var centrifugal = car.centrifugal != null ? car.centrifugal : 0.3, steer = car.steer || 2;

    var baseSeg = this._segAt(this.position);
    var speedPct = this.speed / maxS;

    // steering (scaled by speed so you can't steer while stopped)
    var dx = dt * steer * speedPct;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) this.playerX -= dx;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) this.playerX += dx;
    // centrifugal push on curves
    this.playerX -= dx * speedPct * baseSeg.curve * centrifugal;

    // throttle
    if (this.keys.ArrowUp || this.keys.w || this.keys.W) this.speed += accel * dt;
    else if (this.keys.ArrowDown || this.keys.s || this.keys.S) this.speed -= brake * dt;
    else this.speed -= decel * dt;

    // off-road
    var offRoad = (this.playerX < -1 || this.playerX > 1);
    if (offRoad && this.speed > offLimit) this.speed -= offDecel * dt;

    if (this.speed < 0) this.speed = 0;
    if (this.speed > maxS) this.speed = maxS;
    if (offRoad && this.speed > offLimit) this.speed = offLimit;
    this.playerX = Math.max(-2, Math.min(2, this.playerX));

    // traffic
    var self = this;
    this.traffic.forEach(function (t) {
      t.z = (t.z + t.speed * dt) % self.trackLength;
      // collision: near in z and overlapping laterally
      var dz = (t.z - self.position + self.trackLength) % self.trackLength;
      if (dz < self.segLen * 2.5 && Math.abs(self.playerX - t.x) < 0.55 && self.speed > t.speed) {
        self.speed = t.speed * 0.85; // rear-end: slow to traffic speed
        self.playerX += (self.playerX > t.x ? 0.03 : -0.03);
      }
    });

    // advance
    var adv = this.speed * dt;
    this.traveled += adv;
    this.position = this.traveled % this.trackLength;

    // laps
    var lapNow = Math.floor(this.traveled / this.trackLength);
    if (lapNow > this.lap) {
      var lapTime = this.time - this._lapStart; this._lapStart = this.time;
      if (this.bestLap == null || lapTime < this.bestLap) this.bestLap = lapTime;
      this.lap = lapNow;
      if (this.lap >= this.laps) this.state = "finished";
    }
    this.draw();
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };
  Engine.prototype._fmt = function (t) { return t == null ? "--:--" : (Math.floor(t / 60) + ":" + ("0" + (t % 60).toFixed(2)).slice(-5)); };

  Engine.prototype._project = function (p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = this.cameraDepth / (p.camera.z || 0.0001);
    p.screen.x = Math.round(this.W / 2 + p.screen.scale * p.camera.x * this.W / 2);
    p.screen.y = Math.round(this.H / 2 - p.screen.scale * p.camera.y * this.H / 2);
    p.screen.w = Math.round(p.screen.scale * this.roadWidth * this.W / 2);
  };

  function poly(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath(); ctx.fill();
  }

  Engine.prototype.draw = function () {
    var ctx = this.ctx, th = this.theme, W = this.W, H = this.H;
    ctx.fillStyle = th.sky_color || "#3a6ea5"; ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = th.grass_dark || "#1c5a2a"; ctx.fillRect(0, H / 2, W, H / 2);

    var baseSeg = this._segAt(this.position);
    var basePercent = (this.position % this.segLen) / this.segLen;
    var playerSeg = this._segAt(this.position + this.playerZ);
    var playerPercent = ((this.position + this.playerZ) % this.segLen) / this.segLen;
    var playerY = playerSeg.p1.world.y + (playerSeg.p2.world.y - playerSeg.p1.world.y) * playerPercent;

    var maxy = H, x = 0, dx = -(baseSeg.curve * basePercent);
    for (var n = 0; n < this.drawDistance; n++) {
      var seg = this.segments[(baseSeg.index + n) % this.N];
      var looped = seg.index < baseSeg.index;
      var camZ = this.position - (looped ? this.trackLength : 0);
      this._project(seg.p1, this.playerX * this.roadWidth - x, playerY + this.cameraHeight, camZ);
      this._project(seg.p2, this.playerX * this.roadWidth - x - dx, playerY + this.cameraHeight, camZ);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= this.cameraDepth || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;

      var light = seg.color === 0;
      var grass = light ? (th.grass_light || "#2a7a3a") : (th.grass_dark || "#1c5a2a");
      var rumble = light ? (th.rumble_light || "#e8e8e8") : (th.rumble_dark || "#c04040");
      var road = light ? (th.road_light || "#4a4a52") : (th.road_dark || "#3f3f47");
      var p1 = seg.p1.screen, p2 = seg.p2.screen;
      poly(ctx, 0, p1.y, W, p1.y, W, p2.y, 0, p2.y, grass);
      var r1 = p1.w / 5, r2 = p2.w / 5;
      poly(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, rumble);
      poly(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, rumble);
      poly(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, road);
      // lane markers
      if (light && this.lanes > 1) {
        for (var l = 1; l < this.lanes; l++) {
          var lx1 = p1.x - p1.w + (2 * p1.w) * (l / this.lanes), lx2 = p2.x - p2.w + (2 * p2.w) * (l / this.lanes);
          var lw1 = p1.w * 0.02, lw2 = p2.w * 0.02;
          poly(ctx, lx1 - lw1, p1.y, lx1 + lw1, p1.y, lx2 + lw2, p2.y, lx2 - lw2, p2.y, th.lane_marker || "rgba(255,255,255,0.6)");
        }
      }
      maxy = p2.screen ? p2.y : maxy;
    }

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "Up accelerate · Down brake · Left/Right steer"); return; }

    // traffic (projected, back-to-front is approximate; draw nearest last)
    var self = this;
    var visible = this.traffic.map(function (t) {
      var dz = (t.z - self.position + self.trackLength) % self.trackLength;
      return { t: t, dz: dz };
    }).filter(function (o) { return o.dz > 0 && o.dz < self.drawDistance * self.segLen; })
      .sort(function (a, b) { return b.dz - a.dz; });
    visible.forEach(function (o) {
      var seg = self._segAt(o.t.z), looped = seg.index < baseSeg.index;
      var pp = { world: { y: seg.p1.world.y, z: o.t.z }, camera: {}, screen: {} };
      self._project(pp, self.playerX * self.roadWidth - o.t.x * self.roadWidth, playerY + self.cameraHeight, self.position - (looped ? self.trackLength : 0));
      if (pp.camera.z <= self.cameraDepth) return;
      var cw = pp.screen.w * 0.5, ch = cw * 0.6;
      var img = self._sprite("traffic");
      if (img) ctx.drawImage(img, pp.screen.x - cw / 2, pp.screen.y - ch, cw, ch);
      else { ctx.fillStyle = th.traffic_color || "#ffb03a"; ctx.fillRect(pp.screen.x - cw / 2, pp.screen.y - ch, cw, ch); }
    });

    // player car (fixed near bottom)
    var pcw = W * 0.16, pch = pcw * 0.6, pcx = W / 2, pcy = H * 0.86;
    var lean = (this.keys.ArrowLeft || this.keys.a ? -1 : (this.keys.ArrowRight || this.keys.d ? 1 : 0));
    var pimg = this._sprite("car");
    if (pimg) ctx.drawImage(pimg, pcx - pcw / 2 + lean * 6, pcy - pch, pcw, pch);
    else {
      ctx.fillStyle = (this.cfg.car && this.cfg.car.color) || th.accent_color || "#e23a3a";
      ctx.fillRect(pcx - pcw / 2 + lean * 6, pcy - pch, pcw, pch);
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(pcx - pcw / 2 + lean * 6, pcy - pch, pcw, pch * 0.3);
      ctx.fillStyle = "#111"; ctx.fillRect(pcx - pcw / 2 + lean * 6 - 3, pcy - pch * 0.35, 6, pch * 0.35);
      ctx.fillRect(pcx + pcw / 2 + lean * 6 - 3, pcy - pch * 0.35, 6, pch * 0.35);
    }

    // HUD
    ctx.fillStyle = th.hud_color || "#ffffff"; ctx.font = "bold 13px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("LAP " + Math.min(this.lap + 1, this.laps) + "/" + this.laps, 8, 6);
    ctx.textAlign = "center"; ctx.fillText("TIME " + this._fmt(this.time), W / 2, 6);
    ctx.textAlign = "right"; ctx.fillText(Math.round(this.speed / 40) + " km/h", W - 8, 6);
    ctx.textAlign = "center"; ctx.font = "11px monospace"; ctx.fillText("BEST " + this._fmt(this.bestLap), W / 2, 22);

    if (this.state === "finished") this._overlay("FINISH!", "Total " + this._fmt(this.time) + "  ·  Best lap " + this._fmt(this.bestLap), "Press Enter to race again");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#ffd24a"; ctx.font = "bold 28px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 30);
    ctx.fillStyle = this.theme.hud_color || "#ffffff"; ctx.font = "14px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 28);
  };

  window.RadicaOutrun = {
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
