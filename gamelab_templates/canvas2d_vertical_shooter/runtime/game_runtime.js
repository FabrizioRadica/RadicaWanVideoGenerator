/* RadicaLab GameLab — Canvas2D Vertical Shooter template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN arcade vertical shooter engine. The game is fully
 * described by a validated JSON configuration (see ../schema.json); an LLM or
 * the GameLab builder generates configuration only — it never rewrites this
 * engine. Self-contained: HTML + CSS + vanilla JS, no frameworks, no server
 * calls, relative asset paths only, procedural fallback sprites when no image
 * asset is mapped or an image fails to load.
 *
 * Public API:
 *   RadicaShooter.validateConfig(config) -> [readable error strings]
 *   RadicaShooter.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop  : do not start the requestAnimationFrame loop (the host —
 *                    or a test harness — drives engine.step(dt) manually).
 *
 * Controls: Arrow keys / WASD move, Space fires, Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var MOVEMENTS = ["straight", "sine", "zigzag", "dive"];
  var SHAPES = ["ship", "box", "circle", "diamond", "triangle"]; // procedural enemy geometry
  var FORMATIONS = ["line", "column", "vee", "random"];
  var EFFECTS = ["fire_rate", "double_shot", "shield", "extra_life"];
  var FIRE_PATTERNS = ["straight", "aimed"];
  var BG_TYPES = ["starfield", "color", "image"];

  /* ---------------- validation ---------------- */
  function num(v) { return typeof v === "number" && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }
  function nneg(v) { return num(v) && v >= 0; }
  function str(v) { return typeof v === "string" && v.length > 0; }

  function validateConfig(cfg) {
    var errors = [];
    function bad(msg) { errors.push(msg); }
    if (!cfg || typeof cfg !== "object") { return ["Configuration must be a JSON object."]; }
    if (!str(cfg.title)) bad("title must be a non-empty string.");

    var cv = cfg.canvas || {};
    if (!(num(cv.width) && cv.width >= 160 && cv.width <= 1920)) bad("canvas.width must be a number between 160 and 1920.");
    if (!(num(cv.height) && cv.height >= 160 && cv.height <= 1920)) bad("canvas.height must be a number between 160 and 1920.");

    var bg = cfg.background || {};
    if (bg.type && BG_TYPES.indexOf(bg.type) < 0) bad("background.type must be one of: " + BG_TYPES.join(", ") + ".");
    if (bg.speed != null && !nneg(bg.speed)) bad("background.speed must be a number >= 0.");

    var p = cfg.player;
    if (!p || typeof p !== "object") bad("player is required.");
    else {
      if (!pos(p.width) || !pos(p.height)) bad("player.width and player.height must be positive numbers.");
      if (!pos(p.speed)) bad("player.speed must be a positive number.");
      if (!pos(p.fire_rate)) bad("player.fire_rate must be a positive number (shots per second).");
      if (p.hitbox_scale != null && !(num(p.hitbox_scale) && p.hitbox_scale > 0 && p.hitbox_scale <= 1)) {
        bad("player.hitbox_scale must be a number between 0 (exclusive) and 1.");
      }
    }

    var pb = cfg.bullets && cfg.bullets.player;
    if (!pb) bad("bullets.player is required.");
    else {
      if (!pos(pb.speed)) bad("bullets.player.speed must be a positive number.");
      if (!pos(pb.width) || !pos(pb.height)) bad("bullets.player.width/height must be positive numbers.");
      if (!pos(pb.damage)) bad("bullets.player.damage must be a positive number.");
    }
    var eb = cfg.bullets && cfg.bullets.enemy;
    if (eb && (!pos(eb.speed) || !pos(eb.width) || !pos(eb.height))) {
      bad("bullets.enemy speed/width/height must be positive numbers when defined.");
    }

    var ids = {};
    if (!Array.isArray(cfg.enemies) || !cfg.enemies.length) bad("enemies must be a non-empty array.");
    else cfg.enemies.forEach(function (e, i) {
      var tag = "enemies[" + i + "]";
      if (!str(e.id)) bad(tag + ".id must be a non-empty string.");
      else if (ids[e.id]) bad("Duplicate enemy id '" + e.id + "'.");
      else ids[e.id] = true;
      if (!pos(e.hp)) bad(tag + ".hp must be a positive number.");
      if (!pos(e.speed)) bad(tag + ".speed must be a positive number.");
      if (!pos(e.width) || !pos(e.height)) bad(tag + ".width/height must be positive numbers.");
      if (!nneg(e.score)) bad(tag + ".score must be a number >= 0.");
      if (e.movement && MOVEMENTS.indexOf(e.movement) < 0) bad(tag + ".movement must be one of: " + MOVEMENTS.join(", ") + ".");
      if (e.shape && SHAPES.indexOf(e.shape) < 0) bad(tag + ".shape must be one of: " + SHAPES.join(", ") + ".");
      if (e.fire && e.fire.enabled) {
        if (!pos(e.fire.rate)) bad(tag + ".fire.rate must be a positive number when fire is enabled.");
        if (e.fire.pattern && FIRE_PATTERNS.indexOf(e.fire.pattern) < 0) bad(tag + ".fire.pattern must be one of: " + FIRE_PATTERNS.join(", ") + ".");
        if (!eb) bad(tag + " has fire enabled but bullets.enemy is not defined.");
      }
    });

    if (!Array.isArray(cfg.waves) || !cfg.waves.length) bad("waves must be a non-empty array.");
    else cfg.waves.forEach(function (w, i) {
      var tag = "waves[" + i + "]";
      if (!ids[w.enemy_id]) bad(tag + ".enemy_id '" + w.enemy_id + "' does not match any enemy id.");
      if (!(num(w.count) && w.count >= 1 && w.count <= 100)) bad(tag + ".count must be a number between 1 and 100.");
      if (w.formation && FORMATIONS.indexOf(w.formation) < 0) bad(tag + ".formation must be one of: " + FORMATIONS.join(", ") + ".");
      if (w.interval != null && !nneg(w.interval)) bad(tag + ".interval must be a number >= 0.");
      if (w.start_delay != null && !nneg(w.start_delay)) bad(tag + ".start_delay must be a number >= 0.");
      if (w.x_spread != null && !(num(w.x_spread) && w.x_spread > 0 && w.x_spread <= 1)) bad(tag + ".x_spread must be between 0 (exclusive) and 1.");
    });

    var pids = {};
    (cfg.powerups || []).forEach(function (u, i) {
      var tag = "powerups[" + i + "]";
      if (!str(u.id)) bad(tag + ".id must be a non-empty string.");
      else if (pids[u.id]) bad("Duplicate powerup id '" + u.id + "'.");
      else pids[u.id] = true;
      if (EFFECTS.indexOf(u.effect) < 0) bad(tag + ".effect must be one of: " + EFFECTS.join(", ") + ".");
      if (!(num(u.drop_chance) && u.drop_chance >= 0 && u.drop_chance <= 1)) bad(tag + ".drop_chance must be between 0 and 1.");
      if (u.effect !== "extra_life" && !pos(u.duration)) bad(tag + ".duration must be a positive number.");
      if (u.effect === "fire_rate" && !pos(u.multiplier)) bad(tag + ".multiplier must be a positive number for fire_rate.");
    });

    if (!(num(cfg.lives) && cfg.lives >= 1 && cfg.lives <= 99)) bad("lives must be a number between 1 and 99.");
    var d = cfg.difficulty || {};
    ["speed_multiplier", "hp_multiplier"].forEach(function (k) {
      if (d[k] != null && !pos(d[k])) bad("difficulty." + k + " must be a positive number.");
    });
    if (d.wave_speedup != null && !nneg(d.wave_speedup)) bad("difficulty.wave_speedup must be a number >= 0.");
    var sc = cfg.score || {};
    if (sc.kill_multiplier != null && !nneg(sc.kill_multiplier)) bad("score.kill_multiplier must be a number >= 0.");
    if (sc.wave_clear_bonus != null && !nneg(sc.wave_clear_bonus)) bad("score.wave_clear_bonus must be a number >= 0.");
    return errors;
  }

  /* ---------------- sprites (mapped assets + procedural fallback) ---------------- */
  function loadSprites(cfg) {
    var out = {};
    var assets = cfg.assets || {};
    var base = assets.base_path || "assets/";
    var map = assets.sprites || {};
    if (typeof Image === "undefined") return out; // non-browser harness: fallbacks only
    Object.keys(map).forEach(function (key) {
      var rel = String(map[key] || "");
      if (!rel || rel.indexOf("..") >= 0 || rel.charAt(0) === "/" || rel.indexOf(":") >= 0) return; // relative only
      var entry = { ready: false, img: new Image() };
      entry.img.onload = function () { entry.ready = true; };
      entry.img.onerror = function () { entry.ready = false; }; // fallback drawing stays in charge
      entry.img.src = base + rel;
      out[key] = entry;
    });
    return out;
  }

  /* ---------------- engine ---------------- */
  function Engine(root, cfg, opts) {
    opts = opts || {};
    this.cfg = cfg;
    this.root = root;
    this.W = cfg.canvas.width;
    this.H = cfg.canvas.height;
    this.theme = cfg.theme || {};
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
    this.stats = { shotsFired: 0, spawned: 0, kills: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.className = "rs-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._stars = this._makeStars();
    this._onKeyDown = this._keyHandler.bind(this, true);
    this._onKeyUp = this._keyHandler.bind(this, false);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    this._resetRun();
    this._raf = null;
    this._last = 0;
    if (!opts.noLoop && typeof requestAnimationFrame === "function") this._loop();
    else this.draw();
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
      self._last = ts;
      self.step(dt);
      self._raf = requestAnimationFrame(tick);
    });
  };

  Engine.prototype._keyHandler = function (down, ev) {
    var k = ev.key === " " || ev.key === "Spacebar" ? "Space" : ev.key;
    this.keys[k] = down;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(k) >= 0 && ev.preventDefault) ev.preventDefault();
    if (down && k === "Enter" && this.state !== "playing") this.startGame();
  };

  Engine.prototype._makeStars = function () {
    var stars = [];
    var density = (this.cfg.background && this.cfg.background.density) || 60;
    for (var i = 0; i < density; i++) {
      stars.push({ x: Math.random() * this.W, y: Math.random() * this.H,
                   size: Math.random() * 2 + 0.5, layer: Math.random() < 0.5 ? 0.5 : 1 });
    }
    return stars;
  };

  Engine.prototype._resetRun = function () {
    var p = this.cfg.player;
    this.player = { x: this.W / 2, y: this.H - p.height * 1.5, w: p.width, h: p.height, invuln: 0 };
    this.playerBullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.powerups = [];
    this.particles = [];
    this.effects = {}; // effect -> remaining seconds
    this.score = 0;
    this.lives = this.cfg.lives;
    this.waveIndex = 0;
    this.loopCount = 0;
    this.fireTimer = 0;
    this._bgOffset = 0;
    this._t = 0;
    this._startWave(0);
  };

  Engine.prototype.startGame = function () {
    this._resetRun();
    this.state = "playing";
  };

  /* ---------------- waves ---------------- */
  Engine.prototype._ramp = function () {
    var d = this.cfg.difficulty || {};
    var speedup = d.wave_speedup != null ? d.wave_speedup : 0.05;
    return 1 + this.loopCount * speedup * this.cfg.waves.length;
  };

  Engine.prototype._startWave = function (index) {
    var w = this.cfg.waves[index];
    this.wave = { def: w, toSpawn: w.count, spawnTimer: (w.start_delay != null ? w.start_delay : 1), n: 0 };
  };

  Engine.prototype._spawnEnemy = function () {
    var w = this.wave.def;
    var def = null;
    for (var i = 0; i < this.cfg.enemies.length; i++) {
      if (this.cfg.enemies[i].id === w.enemy_id) { def = this.cfg.enemies[i]; break; }
    }
    var d = this.cfg.difficulty || {};
    var spread = (w.x_spread != null ? w.x_spread : 0.8) * this.W;
    var left = (this.W - spread) / 2;
    var n = this.wave.n, count = w.count;
    var x;
    var formation = w.formation || "line";
    if (formation === "line") x = left + (count > 1 ? (n / (count - 1)) * spread : spread / 2);
    else if (formation === "column") x = this.W / 2;
    else if (formation === "vee") {
      var half = (count - 1) / 2;
      x = this.W / 2 + (n - half) * (spread / Math.max(count, 2)) * 0.9;
    } else x = left + Math.random() * spread;
    var y = -def.height - (formation === "column" ? n * def.height * 1.4 : 0);
    if (formation === "vee") y -= Math.abs(n - (count - 1) / 2) * def.height * 0.9;
    this.enemies.push({
      def: def, x: x, y: y, baseX: x, w: def.width, h: def.height,
      hp: def.hp * (d.hp_multiplier || 1) * (1 + this.loopCount * 0.25),
      speed: def.speed * (d.speed_multiplier || 1) * this._ramp(),
      t: 0, zig: 1, fireTimer: def.fire && def.fire.enabled ? (1 / def.fire.rate) * (0.5 + Math.random()) : 0
    });
    this.stats.spawned++;
    this.wave.n++;
    this.wave.toSpawn--;
  };

  /* ---------------- update ---------------- */
  Engine.prototype.step = function (dt) {
    this._t += dt;
    this._bgOffset += ((this.cfg.background && this.cfg.background.speed) || 60) * dt;
    if (this.state !== "playing") { this.draw(); return; }

    var p = this.player, cfg = this.cfg, pcfg = cfg.player;
    var speed = pcfg.speed;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) p.x -= speed * dt;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) p.x += speed * dt;
    if (this.keys.ArrowUp || this.keys.w || this.keys.W) p.y -= speed * dt;
    if (this.keys.ArrowDown || this.keys.s || this.keys.S) p.y += speed * dt;
    p.x = Math.max(p.w / 2, Math.min(this.W - p.w / 2, p.x));
    p.y = Math.max(p.h / 2, Math.min(this.H - p.h / 2, p.y));
    if (p.invuln > 0) p.invuln -= dt;

    // firing
    var rate = pcfg.fire_rate * (this.effects.fire_rate ? this._fireRateMult() : 1);
    this.fireTimer -= dt;
    if (this.keys.Space && this.fireTimer <= 0) {
      this.fireTimer = 1 / rate;
      var b = cfg.bullets.player;
      if (this.effects.double_shot) {
        this.playerBullets.push({ x: p.x - p.w * 0.3, y: p.y - p.h / 2, vx: 0, vy: -b.speed });
        this.playerBullets.push({ x: p.x + p.w * 0.3, y: p.y - p.h / 2, vx: 0, vy: -b.speed });
        this.stats.shotsFired += 2;
      } else {
        this.playerBullets.push({ x: p.x, y: p.y - p.h / 2, vx: 0, vy: -b.speed });
        this.stats.shotsFired++;
      }
    }

    // wave spawning / progression
    if (this.wave.toSpawn > 0) {
      this.wave.spawnTimer -= dt;
      if (this.wave.spawnTimer <= 0) {
        this._spawnEnemy();
        this.wave.spawnTimer = this.wave.def.interval != null ? this.wave.def.interval : 0.5;
      }
    } else if (!this.enemies.length) {
      this.score += (this.cfg.score && this.cfg.score.wave_clear_bonus) || 0;
      this.waveIndex++;
      if (this.waveIndex >= this.cfg.waves.length) { this.waveIndex = 0; this.loopCount++; }
      this._startWave(this.waveIndex);
    }

    // enemies
    var self = this;
    this.enemies = this.enemies.filter(function (e) {
      e.t += dt;
      var mv = e.def.movement || "straight";
      if (mv === "straight") { e.y += e.speed * dt; }
      else if (mv === "sine") { e.y += e.speed * dt; e.x = e.baseX + Math.sin(e.t * 2.2) * 42; }
      else if (mv === "zigzag") {
        e.y += e.speed * dt;
        e.x += e.zig * e.speed * 0.8 * dt;
        if (e.x < e.w / 2 || e.x > self.W - e.w / 2 || e.t % 1.4 < dt) e.zig *= -1;
        e.x = Math.max(e.w / 2, Math.min(self.W - e.w / 2, e.x));
      } else if (mv === "dive") {
        e.y += e.speed * (e.y > self.H * 0.25 ? 1.8 : 1) * dt;
        if (e.y > self.H * 0.25) e.x += Math.sign(self.player.x - e.x) * e.speed * 0.7 * dt;
      }
      if (e.def.fire && e.def.fire.enabled) {
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && e.y > 0 && e.y < self.H * 0.75) {
          e.fireTimer = 1 / e.def.fire.rate;
          self._enemyFire(e);
        }
      }
      return e.y < self.H + e.h;
    });

    // bullets
    this.playerBullets = this.playerBullets.filter(function (b) {
      b.x += b.vx * dt; b.y += b.vy * dt; return b.y > -20;
    });
    this.enemyBullets = this.enemyBullets.filter(function (b) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      return b.y < self.H + 20 && b.y > -20 && b.x > -20 && b.x < self.W + 20;
    });

    // powerups fall
    this.powerups = this.powerups.filter(function (u) { u.y += 90 * dt; return u.y < self.H + 20; });

    // particles
    this.particles = this.particles.filter(function (pt) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; return pt.life > 0;
    });

    // effects countdown
    Object.keys(this.effects).forEach(function (k) {
      self.effects[k] -= dt;
      if (self.effects[k] <= 0) delete self.effects[k];
    });

    this._collisions();
    this.draw();
  };

  Engine.prototype._fireRateMult = function () {
    var m = 1;
    (this.cfg.powerups || []).forEach(function (u) {
      if (u.effect === "fire_rate") m = Math.max(m, u.multiplier || 1.5);
    });
    return m;
  };

  Engine.prototype._enemyFire = function (e) {
    var eb = this.cfg.bullets.enemy;
    if (!eb) return;
    var pattern = (e.def.fire && e.def.fire.pattern) || "straight";
    if (pattern === "aimed") {
      var dx = this.player.x - e.x, dy = this.player.y - e.y;
      var len = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      this.enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: (dx / len) * eb.speed, vy: (dy / len) * eb.speed });
    } else {
      this.enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vx: 0, vy: eb.speed });
    }
  };

  function hit(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  Engine.prototype._collisions = function () {
    var self = this, cfg = this.cfg;
    var pb = cfg.bullets.player;
    // player bullets vs enemies
    this.playerBullets = this.playerBullets.filter(function (b) {
      for (var i = 0; i < self.enemies.length; i++) {
        var e = self.enemies[i];
        if (hit(b.x, b.y, pb.width, pb.height, e.x, e.y, e.w, e.h)) {
          e.hp -= pb.damage;
          if (e.hp <= 0) { self._kill(e); self.enemies.splice(i, 1); }
          return false;
        }
      }
      return true;
    });
    // enemies + enemy bullets vs player
    var p = this.player;
    var hs = cfg.player.hitbox_scale != null ? cfg.player.hitbox_scale : 0.8;
    var pw = p.w * hs, ph = p.h * hs;
    if (p.invuln <= 0 && !this.effects.shield) {
      var eb = cfg.bullets.enemy;
      for (var i = 0; i < this.enemyBullets.length; i++) {
        var b = this.enemyBullets[i];
        if (hit(b.x, b.y, eb.width, eb.height, p.x, p.y, pw, ph)) {
          this.enemyBullets.splice(i, 1); this._hitPlayer(); return;
        }
      }
      for (var j = 0; j < this.enemies.length; j++) {
        var e = this.enemies[j];
        if (hit(e.x, e.y, e.w * 0.9, e.h * 0.9, p.x, p.y, pw, ph)) {
          this._burst(e.x, e.y, e.def.color || "#ff5a6a");
          this.enemies.splice(j, 1); this._hitPlayer(); return;
        }
      }
    }
    // powerups vs player (always collectable)
    this.powerups = this.powerups.filter(function (u) {
      if (hit(u.x, u.y, 22, 22, p.x, p.y, p.w, p.h)) { self._applyPowerup(u.def); return false; }
      return true;
    });
  };

  Engine.prototype._kill = function (e) {
    var mult = (this.cfg.score && this.cfg.score.kill_multiplier != null) ? this.cfg.score.kill_multiplier : 1;
    this.score += Math.round(e.def.score * mult);
    this.stats.kills++;
    this._burst(e.x, e.y, e.def.color || "#ff5a6a");
    var ups = this.cfg.powerups || [];
    for (var i = 0; i < ups.length; i++) {
      if (Math.random() < ups[i].drop_chance) {
        this.powerups.push({ x: e.x, y: e.y, def: ups[i] });
        break;
      }
    }
  };

  Engine.prototype._applyPowerup = function (def) {
    if (def.effect === "extra_life") this.lives = Math.min(this.lives + 1, 99);
    else this.effects[def.effect] = def.duration || 6;
  };

  Engine.prototype._hitPlayer = function () {
    this.lives--;
    this.effects = {};
    this._burst(this.player.x, this.player.y, this.theme.accent_color || "#7c5cfa");
    if (this.lives <= 0) { this.state = "gameover"; return; }
    this.player.x = this.W / 2;
    this.player.y = this.H - this.player.h * 1.5;
    this.player.invuln = 2;
  };

  Engine.prototype._burst = function (x, y, color) {
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2;
      this.particles.push({ x: x, y: y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.4, color: color });
    }
  };

  /* ---------------- drawing (procedural fallbacks) ---------------- */
  Engine.prototype._sprite = function (key) {
    var s = this.sprites[key];
    return s && s.ready ? s.img : null;
  };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H, bg = this.cfg.background || {};
    ctx.fillStyle = (this.theme.background_color || "#08081a");
    ctx.fillRect(0, 0, W, H);
    var bgImg = this._sprite("background");
    if ((bg.type === "image") && bgImg) {
      var off = this._bgOffset % H;
      ctx.drawImage(bgImg, 0, off - H, W, H);
      ctx.drawImage(bgImg, 0, off, W, H);
    } else if (bg.type !== "color") {
      // starfield fallback (also used when the mapped image is missing)
      ctx.fillStyle = bg.color || "#ffffff";
      var self = this;
      this._stars.forEach(function (s) {
        var y = (s.y + self._bgOffset * s.layer) % H;
        ctx.globalAlpha = 0.25 + 0.55 * s.layer;
        ctx.fillRect(s.x, y, s.size, s.size);
      });
      ctx.globalAlpha = 1;
    }

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "Arrows/WASD move · Space fires"); return; }

    var accent = this.theme.accent_color || "#7c5cfa";
    // player
    var p = this.player;
    if (!(p.invuln > 0 && Math.floor(this._t * 10) % 2 === 0)) {
      var pimg = this._sprite("player");
      if (pimg) ctx.drawImage(pimg, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      else {
        ctx.fillStyle = this.cfg.player.color || accent;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.h / 2);
        ctx.lineTo(p.x - p.w / 2, p.y + p.h / 2);
        ctx.lineTo(p.x, p.y + p.h * 0.28);
        ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(p.x - 2, p.y - p.h * 0.15, 4, 6);
      }
      if (this.effects.shield) {
        ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(p.w, p.h) * 0.75, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // bullets
    var pb = this.cfg.bullets.player;
    var pbImg = this._sprite("bullet_player");
    ctx.fillStyle = pb.color || "#b39cff";
    this.playerBullets.forEach(function (b) {
      if (pbImg) ctx.drawImage(pbImg, b.x - pb.width / 2, b.y - pb.height / 2, pb.width, pb.height);
      else ctx.fillRect(b.x - pb.width / 2, b.y - pb.height / 2, pb.width, pb.height);
    });
    var eb = this.cfg.bullets.enemy;
    if (eb) {
      var ebImg = this._sprite("bullet_enemy");
      ctx.fillStyle = eb.color || "#ffb03a";
      this.enemyBullets.forEach(function (b) {
        if (ebImg) ctx.drawImage(ebImg, b.x - eb.width / 2, b.y - eb.height / 2, eb.width, eb.height);
        else ctx.fillRect(b.x - eb.width / 2, b.y - eb.height / 2, eb.width, eb.height);
      });
    }
    // enemies
    var self = this;
    this.enemies.forEach(function (e) {
      var img = self._sprite("enemy_" + e.def.id);
      if (img) ctx.drawImage(img, e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
      else {
        // Procedural geometry per enemy `shape` (default "ship" keeps the
        // original triangle-with-cockpit look for configs without the field).
        var shape = e.def.shape || "ship";
        ctx.fillStyle = e.def.color || "#ff5a6a";
        if (shape === "box") {
          ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
        } else if (shape === "circle") {
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === "diamond") {
          ctx.beginPath();
          ctx.moveTo(e.x, e.y - e.h / 2);
          ctx.lineTo(e.x + e.w / 2, e.y);
          ctx.lineTo(e.x, e.y + e.h / 2);
          ctx.lineTo(e.x - e.w / 2, e.y);
          ctx.closePath();
          ctx.fill();
        } else {
          // "ship" and "triangle": nose pointing down (travel direction)
          ctx.beginPath();
          ctx.moveTo(e.x, e.y + e.h / 2);
          ctx.lineTo(e.x - e.w / 2, e.y - e.h / 2);
          ctx.lineTo(e.x + e.w / 2, e.y - e.h / 2);
          ctx.closePath();
          ctx.fill();
        }
        if (shape === "ship") {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fillRect(e.x - 3, e.y - 3, 6, 6);
        }
      }
    });
    // powerups
    this.powerups.forEach(function (u) {
      var img = self._sprite("powerup_" + u.def.id);
      if (img) { ctx.drawImage(img, u.x - 11, u.y - 11, 22, 22); return; }
      ctx.fillStyle = u.def.color || "#4ade80";
      ctx.beginPath(); ctx.arc(u.x, u.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0b0b12";
      ctx.font = "bold 12px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(u.def.effect.charAt(0).toUpperCase(), u.x, u.y + 1);
    });
    // particles
    this.particles.forEach(function (pt) {
      ctx.globalAlpha = Math.max(pt.life / 0.4, 0);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;

    // HUD
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("SCORE " + this.score, 10, 8);
    ctx.textAlign = "right";
    ctx.fillText("LIVES " + this.lives, W - 10, 8);
    ctx.textAlign = "center";
    ctx.fillText("WAVE " + (this.loopCount * this.cfg.waves.length + this.waveIndex + 1), W / 2, 8);
    var fx = Object.keys(this.effects);
    if (fx.length) {
      ctx.font = "11px monospace";
      ctx.fillText(fx.join(" · "), W / 2, 26);
    }

    if (this.state === "gameover") this._overlay("GAME OVER", "Score " + this.score, "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, line1, line2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa";
    ctx.font = "bold 30px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 40);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff";
    ctx.font = "16px monospace";
    ctx.fillText(line1, this.W / 2, this.H / 2 + 4);
    ctx.font = "12px monospace";
    ctx.fillText(line2, this.W / 2, this.H / 2 + 30);
  };

  /* ---------------- public API ---------------- */
  window.RadicaShooter = {
    validateConfig: validateConfig,
    mount: function (root, config, opts) {
      var errors = validateConfig(config);
      if (errors.length) {
        var box = document.createElement("div");
        box.className = "rs-error";
        var h = document.createElement("h1");
        h.textContent = "Invalid game configuration";
        box.appendChild(h);
        var ul = document.createElement("ul");
        errors.forEach(function (msg) {
          var li = document.createElement("li");
          li.textContent = msg;
          ul.appendChild(li);
        });
        box.appendChild(ul);
        root.appendChild(box);
        return null;
      }
      return new Engine(root, config, opts);
    }
  };
})();
