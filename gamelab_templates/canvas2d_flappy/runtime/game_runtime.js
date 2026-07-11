/* RadicaLab GameLab — Canvas2D Flappy template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN "flap through the gaps" arcade engine. The game is
 * fully described by a validated JSON configuration (see ../schema.json); a
 * generator produces configuration only — it never rewrites this engine.
 * Self-contained: HTML + CSS + vanilla JS, no frameworks, no server calls,
 * relative asset paths only, procedural fallback graphics.
 *
 * Public API:
 *   RadicaFlappy.validateConfig(config) -> [readable error strings]
 *   RadicaFlappy.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt); engine.flap() taps.
 *
 * Controls: Space / ArrowUp / Enter (or click) to flap and start.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  function num(v) { return typeof v === "number" && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }
  function str(v) { return typeof v === "string" && v.length > 0; }

  function validateConfig(cfg) {
    var e = [];
    function bad(m) { e.push(m); }
    if (!cfg || typeof cfg !== "object") return ["Configuration must be a JSON object."];
    if (!str(cfg.title)) bad("title must be a non-empty string.");
    var cv = cfg.canvas || {};
    if (!(num(cv.width) && cv.width >= 160 && cv.width <= 1920)) bad("canvas.width must be a number between 160 and 1920.");
    if (!(num(cv.height) && cv.height >= 160 && cv.height <= 1920)) bad("canvas.height must be a number between 160 and 1920.");
    if (!pos(cfg.gravity)) bad("gravity must be a positive number.");
    if (!pos(cfg.flap_velocity)) bad("flap_velocity must be a positive number.");
    var b = cfg.bird || {};
    if (!pos(b.width) || !pos(b.height)) bad("bird.width and bird.height must be positive numbers.");
    var p = cfg.pipes || {};
    if (!pos(p.gap)) bad("pipes.gap must be a positive number.");
    if (!pos(p.width)) bad("pipes.width must be a positive number.");
    if (!pos(p.spacing)) bad("pipes.spacing must be a positive number (horizontal distance between pipes).");
    if (!pos(p.speed)) bad("pipes.speed must be a positive number.");
    if (cv.height && p.gap && b.height && p.gap <= b.height * 1.5) bad("pipes.gap is too small for the bird to pass (must exceed bird.height * 1.5).");
    if (cfg.lives != null && !(num(cfg.lives) && cfg.lives >= 1 && cfg.lives <= 99)) bad("lives must be a number between 1 and 99 when set.");
    if (cfg.score_per_pipe != null && !(num(cfg.score_per_pipe) && cfg.score_per_pipe >= 0)) bad("score_per_pipe must be a number >= 0.");
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
    this.state = "start";
    this.stats = { flaps: 0, pipesPassed: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.className = "rg-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._onKeyDown = this._key.bind(this);
    this._onClick = this._tap.bind(this);
    document.addEventListener("keydown", this._onKeyDown);
    this.canvas.addEventListener("mousedown", this._onClick);
    this._resetRun();
    this._raf = null; this._t = 0; this._last = 0;
    if (!opts.noLoop && typeof requestAnimationFrame === "function") this._loop(); else this.draw();
  }

  Engine.prototype.destroy = function () {
    document.removeEventListener("keydown", this._onKeyDown);
    this.canvas.removeEventListener("mousedown", this._onClick);
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

  Engine.prototype._key = function (ev) {
    var k = ev.key === " " || ev.key === "Spacebar" ? "Space" : ev.key;
    if (["Space", "ArrowUp", "Enter", "w", "W"].indexOf(k) >= 0) { if (ev.preventDefault) ev.preventDefault(); this._tap(); }
  };
  Engine.prototype._tap = function () {
    if (this.state === "start" || this.state === "gameover") { this.startGame(); return; }
    this.flap();
  };

  Engine.prototype._resetRun = function () {
    var b = this.cfg.bird;
    this.bird = { x: b.x != null ? b.x : this.W * 0.28, y: this.H / 2, vy: 0, w: b.width, h: b.height };
    this.pipes = [];
    this.sinceSpawn = this.cfg.pipes.spacing; // spawn one immediately-ish
    this.score = 0;
    this.lives = this.cfg.lives || 1;
    this.stats = { flaps: 0, pipesPassed: 0 };
    this._ground = 0;
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype.flap = function () {
    if (this.state !== "playing") return;
    this.bird.vy = -this.cfg.flap_velocity;
    this.stats.flaps++;
  };

  Engine.prototype._spawnPipe = function () {
    var p = this.cfg.pipes, margin = 40;
    var gapTop = margin + Math.random() * (this.H - p.gap - margin * 2);
    this.pipes.push({ x: this.W + p.width, gapTop: gapTop, scored: false });
  };

  Engine.prototype.step = function (dt) {
    this._t += dt;
    this._ground = (this._ground + (this.cfg.pipes.speed) * dt) % 24;
    if (this.state !== "playing") { this.draw(); return; }
    var b = this.bird, p = this.cfg.pipes;
    b.vy += this.cfg.gravity * dt;
    b.y += b.vy * dt;

    // spawn pipes by horizontal distance
    this.sinceSpawn += p.speed * dt;
    if (this.sinceSpawn >= p.spacing) { this.sinceSpawn -= p.spacing; this._spawnPipe(); }

    var self = this;
    this.pipes.forEach(function (pipe) {
      pipe.x -= p.speed * dt;
      if (!pipe.scored && pipe.x + p.width < b.x) {
        pipe.scored = true; self.score += (self.cfg.score_per_pipe != null ? self.cfg.score_per_pipe : 1); self.stats.pipesPassed++;
      }
    });
    this.pipes = this.pipes.filter(function (pipe) { return pipe.x > -p.width - 4; });

    // collisions
    var top = b.y - b.h / 2, bot = b.y + b.h / 2, left = b.x - b.w / 2, right = b.x + b.w / 2;
    var dead = false;
    if (bot >= this.H || top <= 0) dead = true;
    for (var i = 0; i < this.pipes.length && !dead; i++) {
      var pipe = this.pipes[i];
      if (right > pipe.x && left < pipe.x + p.width) {
        if (top < pipe.gapTop || bot > pipe.gapTop + p.gap) dead = true;
      }
    }
    if (dead) this._die();
    this.draw();
  };

  Engine.prototype._die = function () {
    this.lives--;
    if (this.lives <= 0) { this.bird.y = Math.min(this.bird.y, this.H - this.bird.h / 2); this.state = "gameover"; return; }
    // respawn mid-screen, clear nearby pipes
    this.bird.y = this.H / 2; this.bird.vy = 0;
    this.pipes = this.pipes.filter(function (pipe) { return pipe.x > this.bird.x + 120; }, this);
    this.sinceSpawn = 0;
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, th = this.theme, W = this.W, H = this.H, p = this.cfg.pipes;
    ctx.fillStyle = th.background_color || "#4ec0ff"; ctx.fillRect(0, 0, W, H);
    var bgImg = this._sprite("background");
    if (bgImg) ctx.drawImage(bgImg, 0, 0, W, H);

    // pipes
    var pipeImg = this._sprite("pipe");
    this.pipes.forEach(function (pipe) {
      if (pipeImg) {
        ctx.drawImage(pipeImg, pipe.x, 0, p.width, pipe.gapTop);
        ctx.drawImage(pipeImg, pipe.x, pipe.gapTop + p.gap, p.width, H - (pipe.gapTop + p.gap));
      } else {
        ctx.fillStyle = p.color || "#4ade80";
        ctx.fillRect(pipe.x, 0, p.width, pipe.gapTop);
        ctx.fillRect(pipe.x, pipe.gapTop + p.gap, p.width, H - (pipe.gapTop + p.gap));
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(pipe.x, pipe.gapTop - 10, p.width, 10);
        ctx.fillRect(pipe.x, pipe.gapTop + p.gap, p.width, 10);
      }
    });

    // ground strip
    ctx.fillStyle = th.ground_color || "#caa66a";
    ctx.fillRect(0, H - 16, W, 16);

    // bird
    var b = this.bird, img = this._sprite("bird");
    ctx.save();
    ctx.translate(b.x, b.y);
    var tilt = Math.max(-0.5, Math.min(0.9, (b.vy || 0) / 600));
    ctx.rotate(tilt);
    if (img) ctx.drawImage(img, -b.w / 2, -b.h / 2, b.w, b.h);
    else {
      ctx.fillStyle = (this.cfg.bird && this.cfg.bird.color) || "#ffd24a";
      ctx.beginPath(); ctx.ellipse(0, 0, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.w * 0.18, -b.h * 0.12, b.h * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(b.w * 0.22, -b.h * 0.12, b.h * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff8a3a"; ctx.fillRect(b.w * 0.3, 0, b.w * 0.3, b.h * 0.16);
    }
    ctx.restore();

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Space / click to start", "Tap to flap through the gaps"); return; }

    // HUD score
    ctx.fillStyle = th.hud_color || "#ffffff";
    ctx.font = "bold 28px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 3;
    ctx.strokeText(String(this.score), W / 2, 14); ctx.fillText(String(this.score), W / 2, 14);
    if ((this.cfg.lives || 1) > 1) { ctx.font = "bold 13px monospace"; ctx.fillText("♥ " + this.lives, W / 2, 48); }

    if (this.state === "gameover") this._overlay("GAME OVER", "Score " + this.score, "Press Space / click to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#ffffff"; ctx.font = "bold 28px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 34);
    ctx.fillStyle = "#ffffff"; ctx.font = "15px monospace"; ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 28);
  };

  window.RadicaFlappy = {
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
