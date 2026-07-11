/* RadicaLab GameLab — Canvas2D Maze template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN top-down maze game engine. The game is fully
 * described by a validated JSON configuration (see ../schema.json); a generator
 * produces configuration only — it never rewrites this engine. Self-contained:
 * HTML + CSS + vanilla JS, no frameworks, no server calls, relative asset paths
 * only, procedural fallback graphics when no image asset is mapped.
 *
 * Continuous top-down movement with wall collision; collectibles, keys and
 * locked doors, patrol/chase enemies, lives, score, level-complete on exit.
 *
 * Public API:
 *   RadicaMaze.validateConfig(config) -> [readable error strings]
 *   RadicaMaze.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives engine.step(dt) manually.
 *
 * Controls: Arrow keys / WASD move, Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var BEHAVIORS = ["patrol", "chase"];

  function num(v) { return typeof v === "number" && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }
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
    function walkable(c, r) { return grid && r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== "#"; }
    function coordOk(o, label) {
      if (!o || !num(o.col) || !num(o.row)) { bad(label + " must have numeric col/row."); return; }
      if (o.col < 0 || o.col >= cols || o.row < 0 || o.row >= rows) { bad(label + " is outside the map."); return; }
      if (!walkable(o.col, o.row)) bad(label + " is on a wall tile.");
    }
    if (grid) {
      if (!cfg.player_spawn) bad("player_spawn is required."); else coordOk(cfg.player_spawn, "player_spawn");
      if (!cfg.exit) bad("exit is required."); else coordOk(cfg.exit, "exit");
      (cfg.collectibles || []).forEach(function (c, i) { coordOk(c, "collectibles[" + i + "]"); });
      var keyIds = {};
      (cfg.keys || []).forEach(function (k, i) {
        if (!str(k.id)) bad("keys[" + i + "].id is required."); else if (keyIds[k.id]) bad("Duplicate key id '" + k.id + "'."); else keyIds[k.id] = true;
        coordOk(k, "keys[" + i + "]");
      });
      (cfg.doors || []).forEach(function (d, i) {
        coordOk(d, "doors[" + i + "]");
        if (d.key_id && !keyIds[d.key_id]) bad("doors[" + i + "].key_id '" + d.key_id + "' has no matching key.");
      });
      (cfg.enemies || []).forEach(function (en, i) {
        coordOk(en, "enemies[" + i + "]");
        if (en.behavior && BEHAVIORS.indexOf(en.behavior) < 0) bad("enemies[" + i + "].behavior must be one of: " + BEHAVIORS.join(", ") + ".");
        if (!pos(en.speed)) bad("enemies[" + i + "].speed must be a positive number.");
      });
    }
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
    this.T = cfg.tile_size;
    this.rows = cfg.map.length;
    this.cols = cfg.map[0].length;
    this.W = this.cols * this.T;
    this.H = this.rows * this.T;
    this.theme = cfg.theme || {};
    this.sprites = loadSprites(cfg);
    this.keys = {};
    this.state = "start";
    this.stats = { collected: 0, steps: 0 };
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
    if (down && k === "Enter" && this.state !== "playing") this.startGame();
  };

  Engine.prototype._resetRun = function () {
    var s = this.cfg.player_spawn;
    this.player = { x: (s.col + 0.5) * this.T, y: (s.row + 0.5) * this.T, invuln: 0 };
    this.lives = this.cfg.lives;
    this.score = 0;
    this.collected = {};
    this.keysHeld = {};
    this.doorsOpen = {};
    this.collectibles = (this.cfg.collectibles || []).map(function (c, i) { return { i: i, col: c.col, row: c.row, taken: false }; });
    this.keyItems = (this.cfg.keys || []).map(function (k) { return { id: k.id, col: k.col, row: k.row, color: k.color, taken: false }; });
    this.enemies = (this.cfg.enemies || []).map(function (en) {
      return { x: (en.col + 0.5) * this.T, y: (en.row + 0.5) * this.T, def: en,
               dir: [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)] };
    }, this);
    this._t = 0;
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype._solidTile = function (col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    if (this.cfg.map[row][col] === "#") return true;
    var d = this._doorAt(col, row);
    if (d && !this.doorsOpen[d.key_id || ("_" + d.col + "_" + d.row)]) return true;
    return false;
  };

  Engine.prototype._doorAt = function (col, row) {
    var doors = this.cfg.doors || [];
    for (var i = 0; i < doors.length; i++) if (doors[i].col === col && doors[i].row === row) return doors[i];
    return null;
  };

  Engine.prototype._blocked = function (px, py) {
    var r = this.T * 0.34;
    var pts = [[px - r, py - r], [px + r, py - r], [px - r, py + r], [px + r, py + r]];
    for (var i = 0; i < pts.length; i++) {
      if (this._solidTile(Math.floor(pts[i][0] / this.T), Math.floor(pts[i][1] / this.T))) return true;
    }
    return false;
  };

  Engine.prototype.step = function (dt) {
    this._t += dt;
    if (this.state !== "playing") { this.draw(); return; }
    var p = this.player, T = this.T;
    var speed = (this.cfg.player && this.cfg.player.speed) || T * 4;
    var vx = 0, vy = 0;
    if (this.keys.ArrowLeft || this.keys.a || this.keys.A) vx -= 1;
    if (this.keys.ArrowRight || this.keys.d || this.keys.D) vx += 1;
    if (this.keys.ArrowUp || this.keys.w || this.keys.W) vy -= 1;
    if (this.keys.ArrowDown || this.keys.s || this.keys.S) vy += 1;
    if (vx || vy) this.stats.steps++;
    var nx = p.x + vx * speed * dt;
    if (!this._blocked(nx, p.y)) p.x = nx;
    var ny = p.y + vy * speed * dt;
    if (!this._blocked(p.x, ny)) p.y = ny;
    if (p.invuln > 0) p.invuln -= dt;

    var pc = Math.floor(p.x / T), pr = Math.floor(p.y / T);

    // pick up collectibles
    this.collectibles.forEach(function (c) {
      if (!c.taken && c.col === pc && c.row === pr) {
        c.taken = true; this.collected[c.i] = true; this.stats.collected++;
        this.score += (this.cfg.score && this.cfg.score.collectible) || 100;
      }
    }, this);
    // pick up keys
    this.keyItems.forEach(function (k) {
      if (!k.taken && k.col === pc && k.row === pr) { k.taken = true; this.keysHeld[k.id] = true; this.doorsOpen[k.id] = true; }
    }, this);

    // enemies
    var self = this;
    this.enemies.forEach(function (en) {
      var es = en.def.speed;
      if ((en.def.behavior || "patrol") === "chase") {
        var dx = p.x - en.x, dy = p.y - en.y;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (!self._blocked(en.x + Math.sign(dx) * es * dt, en.y)) en.x += Math.sign(dx) * es * dt;
          else if (!self._blocked(en.x, en.y + Math.sign(dy) * es * dt)) en.y += Math.sign(dy) * es * dt;
        } else {
          if (!self._blocked(en.x, en.y + Math.sign(dy) * es * dt)) en.y += Math.sign(dy) * es * dt;
          else if (!self._blocked(en.x + Math.sign(dx) * es * dt, en.y)) en.x += Math.sign(dx) * es * dt;
        }
      } else {
        var mx = en.x + en.dir[0] * es * dt, my = en.y + en.dir[1] * es * dt;
        if (self._blocked(mx, my)) {
          var opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (d) {
            return !self._blocked(en.x + d[0] * es * dt, en.y + d[1] * es * dt);
          });
          if (opts.length) en.dir = opts[Math.floor(Math.random() * opts.length)];
        } else { en.x = mx; en.y = my; }
      }
      // contact
      if (self.player.invuln <= 0 && Math.abs(en.x - p.x) < T * 0.6 && Math.abs(en.y - p.y) < T * 0.6) {
        self._hit();
      }
    });

    // exit
    if (pc === this.cfg.exit.col && pr === this.cfg.exit.row) {
      if (!this.cfg.exit_requires_all_collectibles || this.stats.collected >= this.collectibles.length) {
        this.state = "win";
      }
    }
    this.draw();
  };

  Engine.prototype._hit = function () {
    this.lives--;
    if (this.lives <= 0) { this.state = "gameover"; return; }
    var s = this.cfg.player_spawn;
    this.player.x = (s.col + 0.5) * this.T;
    this.player.y = (s.row + 0.5) * this.T;
    this.player.invuln = 1.5;
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, T = this.T, th = this.theme;
    ctx.fillStyle = th.floor_color || "#141225";
    ctx.fillRect(0, 0, this.W, this.H);
    // walls
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      if (this.cfg.map[r][c] === "#") {
        ctx.fillStyle = th.wall_color || "#3a2f6e";
        ctx.fillRect(c * T, r * T, T, T);
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.strokeRect(c * T + 0.5, r * T + 0.5, T - 1, T - 1);
      }
    }
    // exit
    var ex = this.cfg.exit;
    ctx.fillStyle = th.exit_color || "#4ade80";
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this._t * 4);
    ctx.fillRect(ex.col * T + 3, ex.row * T + 3, T - 6, T - 6);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.exit_color || "#4ade80"; ctx.strokeRect(ex.col * T + 3, ex.row * T + 3, T - 6, T - 6);
    // doors
    (this.cfg.doors || []).forEach(function (d) {
      var open = this.doorsOpen[d.key_id || ("_" + d.col + "_" + d.row)];
      ctx.fillStyle = open ? "rgba(120,120,120,0.25)" : (d.color || "#c08a2e");
      ctx.fillRect(d.col * T + (open ? T * 0.4 : 2), d.row * T + 2, open ? T * 0.2 : T - 4, T - 4);
    }, this);
    // collectibles
    this.collectibles.forEach(function (c) {
      if (c.taken) return;
      ctx.fillStyle = th.collectible_color || "#ffd27a";
      ctx.beginPath(); ctx.arc((c.col + 0.5) * T, (c.row + 0.5) * T, T * 0.16, 0, Math.PI * 2); ctx.fill();
    }, this);
    // keys
    this.keyItems.forEach(function (k) {
      if (k.taken) return;
      ctx.fillStyle = k.color || "#ffe14d";
      ctx.save(); ctx.translate((k.col + 0.5) * T, (k.row + 0.5) * T); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-T * 0.14, -T * 0.14, T * 0.28, T * 0.28); ctx.restore();
    }, this);

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to start", "Arrows / WASD move"); return; }

    // enemies
    this.enemies.forEach(function (en) {
      var img = this._sprite("enemy");
      if (img) ctx.drawImage(img, en.x - T * 0.4, en.y - T * 0.4, T * 0.8, T * 0.8);
      else {
        ctx.fillStyle = en.def.color || "#ff5a6a";
        ctx.beginPath(); ctx.arc(en.x, en.y, T * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(en.x - T * 0.16, en.y - T * 0.08, T * 0.1, T * 0.1);
        ctx.fillRect(en.x + T * 0.06, en.y - T * 0.08, T * 0.1, T * 0.1);
      }
    }, this);
    // player
    var p = this.player;
    if (!(p.invuln > 0 && Math.floor(this._t * 10) % 2 === 0)) {
      var pimg = this._sprite("player");
      if (pimg) ctx.drawImage(pimg, p.x - T * 0.4, p.y - T * 0.4, T * 0.8, T * 0.8);
      else {
        ctx.fillStyle = (this.cfg.player && this.cfg.player.color) || th.accent_color || "#7c5cfa";
        ctx.beginPath(); ctx.arc(p.x, p.y, T * 0.32, 0, Math.PI * 2); ctx.fill();
      }
    }
    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff";
    ctx.font = "bold 13px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("♥ " + this.lives, 8, 6);
    ctx.textAlign = "center"; ctx.fillText("SCORE " + this.score, this.W / 2, 6);
    ctx.textAlign = "right";
    var totalC = this.collectibles.length;
    ctx.fillText((totalC ? "◆ " + this.stats.collected + "/" + totalC : "") +
      (this.keyItems.length ? "  🔑" + Object.keys(this.keysHeld).length : ""), this.W - 8, 6);

    if (this.state === "win") this._overlay("LEVEL COMPLETE", "Score " + this.score, "Press Enter to play again");
    if (this.state === "gameover") this._overlay("GAME OVER", "Score " + this.score, "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa";
    ctx.font = "bold 26px monospace"; ctx.fillText(title, this.W / 2, this.H / 2 - 30);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff";
    ctx.font = "15px monospace"; ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 26);
  };

  window.RadicaMaze = {
    validateConfig: validateConfig,
    mount: function (root, config, opts) {
      var errors = validateConfig(config);
      if (errors.length) {
        var box = document.createElement("div");
        box.className = "rg-error";
        var h = document.createElement("h1"); h.textContent = "Invalid game configuration"; box.appendChild(h);
        var ul = document.createElement("ul");
        errors.forEach(function (m) { var li = document.createElement("li"); li.textContent = m; ul.appendChild(li); });
        box.appendChild(ul); root.appendChild(box); return null;
      }
      return new Engine(root, config, opts);
    }
  };
})();
