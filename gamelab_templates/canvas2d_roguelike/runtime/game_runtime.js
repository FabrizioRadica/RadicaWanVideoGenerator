/* RadicaLab GameLab — Canvas2D Rogue-like template runtime (v1).
 *
 * A reusable, CONFIG-DRIVEN turn-based top-down rogue-like engine. The game is
 * fully described by a validated JSON configuration (see ../schema.json); a
 * generator produces configuration only — it never rewrites this engine.
 * Self-contained: HTML + CSS + vanilla JS, no frameworks, no server calls,
 * relative asset paths only, procedural fallback graphics.
 *
 * TURN-BASED grid movement: the player steps one tile per key press, then every
 * enemy takes one step. Bump-to-attack melee combat, HP, treasure (score),
 * health potions, keys and key-locked doors, win on reaching the exit.
 *
 * Public API:
 *   RadicaRogue.validateConfig(config) -> [readable error strings]
 *   RadicaRogue.mount(rootEl, config, opts?) -> engine instance
 *     opts.noLoop : host/test drives rendering; turns advance on key input or
 *                   the manual engine.tryMove(dx,dy) helper.
 *
 * Controls: Arrow keys / WASD step (and attack by stepping into an enemy),
 *           Enter starts/restarts.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var BEHAVIORS = ["wander", "chase"];

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
    function walkable(c, r) { return grid && r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== "#"; }
    function coordOk(o, label) {
      if (!o || !num(o.col) || !num(o.row)) { bad(label + " must have numeric col/row."); return; }
      if (o.col < 0 || o.col >= cols || o.row < 0 || o.row >= rows) { bad(label + " is outside the map."); return; }
      if (!walkable(o.col, o.row)) bad(label + " is on a wall tile.");
    }
    if (grid) {
      if (!cfg.player_spawn) bad("player_spawn is required."); else coordOk(cfg.player_spawn, "player_spawn");
      if (!cfg.exit) bad("exit is required."); else coordOk(cfg.exit, "exit");
      (cfg.treasure || []).forEach(function (t, i) { coordOk(t, "treasure[" + i + "]"); });
      (cfg.potions || []).forEach(function (p, i) { coordOk(p, "potions[" + i + "]"); if (!pos(p.heal)) bad("potions[" + i + "].heal must be a positive number."); });
      var keyIds = {};
      (cfg.keys || []).forEach(function (k, i) {
        if (!str(k.id)) bad("keys[" + i + "].id is required."); else if (keyIds[k.id]) bad("Duplicate key id '" + k.id + "'."); else keyIds[k.id] = true;
        coordOk(k, "keys[" + i + "]");
      });
      (cfg.doors || []).forEach(function (d, i) { coordOk(d, "doors[" + i + "]"); if (d.key_id && !keyIds[d.key_id]) bad("doors[" + i + "].key_id '" + d.key_id + "' has no matching key."); });
      (cfg.enemies || []).forEach(function (en, i) {
        coordOk(en, "enemies[" + i + "]");
        if (en.behavior && BEHAVIORS.indexOf(en.behavior) < 0) bad("enemies[" + i + "].behavior must be one of: " + BEHAVIORS.join(", ") + ".");
        if (!pos(en.hp)) bad("enemies[" + i + "].hp must be a positive number.");
        if (!pos(en.damage)) bad("enemies[" + i + "].damage must be a positive number.");
        if (en.attack == null) { /* uses player attack? enemy needs its own atk to hurt via player? */ }
      });
    }
    var p = cfg.player || {};
    if (!pos(p.max_hp)) bad("player.max_hp must be a positive number.");
    if (!pos(p.attack)) bad("player.attack must be a positive number.");
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
    this.state = "start";
    this.stats = { kills: 0, treasure: 0, turns: 0 };
    this.messages = [];
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.className = "rg-canvas";
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._onKeyDown = this._key.bind(this);
    document.addEventListener("keydown", this._onKeyDown);
    this._resetRun();
    this._raf = null; this._t = 0; this._last = 0;
    if (!opts.noLoop && typeof requestAnimationFrame === "function") this._loop(); else this.draw();
  }

  Engine.prototype.destroy = function () {
    document.removeEventListener("keydown", this._onKeyDown);
    if (this._raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._raf);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  Engine.prototype._loop = function () {
    var self = this;
    this._raf = requestAnimationFrame(function tick(ts) {
      self._t += self._last ? Math.min((ts - self._last) / 1000, 0.05) : 1 / 60; self._last = ts;
      self.draw(); self._raf = requestAnimationFrame(tick);
    });
  };

  Engine.prototype._key = function (ev) {
    var k = ev.key === " " || ev.key === "Spacebar" ? "Space" : ev.key;
    if (k === "Enter") { if (this.state !== "playing") this.startGame(); if (ev.preventDefault) ev.preventDefault(); return; }
    if (this.state !== "playing") return;
    var d = { ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1] }[k];
    if (d) { if (ev.preventDefault) ev.preventDefault(); this.tryMove(d[0], d[1]); }
  };

  Engine.prototype._resetRun = function () {
    var s = this.cfg.player_spawn, p = this.cfg.player;
    this.player = { col: s.col, row: s.row, hp: p.max_hp, max_hp: p.max_hp, atk: p.attack };
    this.score = 0;
    this.keysHeld = {};
    this.doorsOpen = {};
    this.treasure = (this.cfg.treasure || []).map(function (t) { return { col: t.col, row: t.row, value: t.value, taken: false }; });
    this.potions = (this.cfg.potions || []).map(function (p) { return { col: p.col, row: p.row, heal: p.heal, taken: false }; });
    this.keyItems = (this.cfg.keys || []).map(function (k) { return { id: k.id, col: k.col, row: k.row, color: k.color, taken: false }; });
    this.enemies = (this.cfg.enemies || []).map(function (en) {
      return { col: en.col, row: en.row, hp: en.hp, def: en, flash: 0 };
    });
    this.messages = ["Welcome, adventurer."];
    this.stats = { kills: 0, treasure: 0, turns: 0 };
  };

  Engine.prototype.startGame = function () { this._resetRun(); this.state = "playing"; };

  Engine.prototype._solid = function (col, row) {
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
  Engine.prototype._enemyAt = function (col, row) {
    for (var i = 0; i < this.enemies.length; i++) if (this.enemies[i].col === col && this.enemies[i].row === row) return this.enemies[i];
    return null;
  };
  Engine.prototype._log = function (m) { this.messages.push(m); if (this.messages.length > 4) this.messages.shift(); };

  Engine.prototype.tryMove = function (dx, dy) {
    if (this.state !== "playing") return;
    var nc = this.player.col + dx, nr = this.player.row + dy;
    var enemy = this._enemyAt(nc, nr);
    if (enemy) {
      // bump-to-attack
      enemy.hp -= this.player.atk; enemy.flash = 0.2;
      this._log("You hit " + (enemy.def.name || "the enemy") + " for " + this.player.atk + ".");
      if (enemy.hp <= 0) {
        this.enemies = this.enemies.filter(function (e) { return e !== enemy; });
        this.score += enemy.def.score || 50; this.stats.kills++;
        this._log("You slay " + (enemy.def.name || "the enemy") + "!");
      }
    } else if (!this._solid(nc, nr)) {
      this.player.col = nc; this.player.row = nr;
      this._pickup();
    } else {
      return; // blocked, no turn spent
    }
    this.stats.turns++;
    this._enemyTurn();
    this._checkEnd();
    this.draw();
  };

  Engine.prototype._pickup = function () {
    var pc = this.player.col, pr = this.player.row, self = this;
    this.treasure.forEach(function (t) {
      if (!t.taken && t.col === pc && t.row === pr) { t.taken = true; self.score += t.value || 100; self.stats.treasure++; self._log("You grab treasure (+" + (t.value || 100) + ")."); }
    });
    this.potions.forEach(function (p) {
      if (!p.taken && p.col === pc && p.row === pr) {
        p.taken = true; self.player.hp = Math.min(self.player.max_hp, self.player.hp + p.heal);
        self._log("You drink a potion (+" + p.heal + " HP).");
      }
    });
    this.keyItems.forEach(function (k) {
      if (!k.taken && k.col === pc && k.row === pr) { k.taken = true; self.keysHeld[k.id] = true; self.doorsOpen[k.id] = true; self._log("You pick up the " + k.id + " key."); }
    });
  };

  Engine.prototype._enemyTurn = function () {
    var self = this, p = this.player;
    this.enemies.forEach(function (en) {
      if (en.flash > 0) en.flash -= 0.05;
      var dcol = p.col - en.col, drow = p.row - en.row;
      var dist = Math.abs(dcol) + Math.abs(drow);
      if (dist === 1) { // adjacent -> attack
        p.hp -= en.def.damage; en.flash = 0.15;
        self._log((en.def.name || "The enemy") + " hits you for " + en.def.damage + ".");
        return;
      }
      var behavior = en.def.behavior || "wander";
      var range = en.def.sight != null ? en.def.sight : 6;
      var step = null;
      if (behavior === "chase" && dist <= range) {
        // greedy step on the dominant axis, fall back to the other
        var options = Math.abs(dcol) >= Math.abs(drow)
          ? [[Math.sign(dcol), 0], [0, Math.sign(drow)]]
          : [[0, Math.sign(drow)], [Math.sign(dcol), 0]];
        for (var i = 0; i < options.length; i++) {
          var o = options[i];
          if ((o[0] || o[1]) && !self._solid(en.col + o[0], en.row + o[1]) && !self._enemyAt(en.col + o[0], en.row + o[1])) { step = o; break; }
        }
      } else {
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (o) {
          return !self._solid(en.col + o[0], en.row + o[1]) && !self._enemyAt(en.col + o[0], en.row + o[1]) &&
            !(en.col + o[0] === p.col && en.row + o[1] === p.row);
        });
        if (dirs.length && Math.random() < 0.6) step = dirs[Math.floor(Math.random() * dirs.length)];
      }
      if (step) { en.col += step[0]; en.row += step[1]; }
    });
  };

  Engine.prototype._checkEnd = function () {
    if (this.player.hp <= 0) { this.player.hp = 0; this.state = "gameover"; return; }
    if (this.player.col === this.cfg.exit.col && this.player.row === this.cfg.exit.row) {
      if (!this.cfg.exit_requires_all_treasure || this.stats.treasure >= this.treasure.length) this.state = "win";
    }
  };

  Engine.prototype._sprite = function (k) { var s = this.sprites[k]; return s && s.ready ? s.img : null; };

  Engine.prototype.draw = function () {
    var ctx = this.ctx, T = this.T, th = this.theme;
    ctx.fillStyle = th.floor_color || "#15131f"; ctx.fillRect(0, 0, this.W, this.H);
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      if (this.cfg.map[r][c] === "#") { ctx.fillStyle = th.wall_color || "#403a2e"; ctx.fillRect(c * T, r * T, T, T);
        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.strokeRect(c * T + 0.5, r * T + 0.5, T - 1, T - 1); }
    }
    var ex = this.cfg.exit;
    ctx.fillStyle = th.exit_color || "#4ade80"; ctx.globalAlpha = 0.3 + 0.25 * Math.sin(this._t * 4);
    ctx.fillRect(ex.col * T + 3, ex.row * T + 3, T - 6, T - 6); ctx.globalAlpha = 1;
    (this.cfg.doors || []).forEach(function (d) {
      var open = this.doorsOpen[d.key_id || ("_" + d.col + "_" + d.row)];
      ctx.fillStyle = open ? "rgba(120,120,120,0.25)" : (d.color || "#8a5a2e");
      ctx.fillRect(d.col * T + (open ? T * 0.4 : 2), d.row * T + 2, open ? T * 0.2 : T - 4, T - 4);
    }, this);
    this.treasure.forEach(function (t) { if (t.taken) return; ctx.fillStyle = th.treasure_color || "#ffd24a";
      ctx.fillRect((t.col + 0.3) * T, (t.row + 0.35) * T, T * 0.4, T * 0.3); }, this);
    this.potions.forEach(function (p) { if (p.taken) return; ctx.fillStyle = "#ff6a8a";
      ctx.beginPath(); ctx.arc((p.col + 0.5) * T, (p.row + 0.5) * T, T * 0.2, 0, Math.PI * 2); ctx.fill(); }, this);
    this.keyItems.forEach(function (k) { if (k.taken) return; ctx.fillStyle = k.color || "#ffe14d";
      ctx.save(); ctx.translate((k.col + 0.5) * T, (k.row + 0.5) * T); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-T * 0.13, -T * 0.13, T * 0.26, T * 0.26); ctx.restore(); }, this);

    if (this.state === "start") { this._overlay(this.cfg.title, "Press Enter to begin", "Arrows / WASD step · bump enemies to attack"); return; }

    this.enemies.forEach(function (en) {
      var img = this._sprite("enemy_" + (en.def.id || ""));
      if (img) ctx.drawImage(img, en.col * T + 2, en.row * T + 2, T - 4, T - 4);
      else {
        ctx.fillStyle = en.flash > 0 ? "#ffffff" : (en.def.color || "#ff5a6a");
        ctx.fillRect(en.col * T + T * 0.2, en.row * T + T * 0.2, T * 0.6, T * 0.6);
      }
      // hp pip
      ctx.fillStyle = "#000"; ctx.fillRect(en.col * T + 3, en.row * T + 2, T - 6, 3);
      ctx.fillStyle = "#ff5a6a"; ctx.fillRect(en.col * T + 3, en.row * T + 2, (T - 6) * Math.max(0, en.hp / en.def.hp), 3);
    }, this);
    var p = this.player, img = this._sprite("player");
    if (img) ctx.drawImage(img, p.col * T + 2, p.row * T + 2, T - 4, T - 4);
    else { ctx.fillStyle = (this.cfg.player && this.cfg.player.color) || th.accent_color || "#7c5cfa";
      ctx.beginPath(); ctx.arc((p.col + 0.5) * T, (p.row + 0.5) * T, T * 0.34, 0, Math.PI * 2); ctx.fill(); }

    // HUD
    ctx.fillStyle = th.hud_color || "#f4f0ff"; ctx.font = "bold 12px monospace"; ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText("HP " + p.hp + "/" + p.max_hp, 8, 6);
    ctx.textAlign = "center"; ctx.fillText("SCORE " + this.score, this.W / 2, 6);
    ctx.textAlign = "right"; ctx.fillText("KILLS " + this.stats.kills, this.W - 8, 6);
    ctx.textAlign = "left"; ctx.font = "10px monospace"; ctx.fillStyle = "rgba(244,240,255,0.75)";
    for (var i = 0; i < this.messages.length; i++) ctx.fillText(this.messages[i], 8, this.H - 12 * (this.messages.length - i));

    if (this.state === "win") this._overlay("YOU ESCAPED", "Score " + this.score, "Press Enter to play again");
    if (this.state === "gameover") this._overlay("YOU DIED", "Score " + this.score, "Press Enter to restart");
  };

  Engine.prototype._overlay = function (title, l1, l2) {
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.accent_color || "#7c5cfa"; ctx.font = "bold 26px monospace";
    ctx.fillText(title, this.W / 2, this.H / 2 - 30);
    ctx.fillStyle = this.theme.hud_color || "#f4f0ff"; ctx.font = "15px monospace";
    ctx.fillText(l1, this.W / 2, this.H / 2 + 2);
    ctx.font = "12px monospace"; ctx.fillText(l2, this.W / 2, this.H / 2 + 26);
  };

  window.RadicaRogue = {
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
