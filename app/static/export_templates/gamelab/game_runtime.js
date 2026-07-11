/* RadicaLab GameLab — standalone browser runtime (v1).
 *
 * This is the SINGLE source of truth for game playback. It is loaded verbatim
 * by Test Play inside RadicaLab AND copied into every exported web build as
 * game.js, so in-app and exported behaviour can never diverge.
 *
 * It is fully self-contained: it never calls a server API and never depends on
 * server-side state. Media is resolved through opts.resolveAsset(mediaPath),
 * which defaults to the relative path (correct for the exported build); Test
 * Play passes a resolver that points at RadicaLab's media route.
 *
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign
 */
(function () {
  "use strict";

  var QTE_LABEL = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Space: "SPACE", Enter: "ENTER"
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function beep(ctx, freq, dur) {
    if (!ctx) return;
    try {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.value = 0.06;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch (e) { /* audio not available */ }
  }

  function Game(root, data, opts) {
    opts = opts || {};
    this.root = root;
    this.data = data || {};
    this.scenes = {};
    (this.data.scenes || []).forEach(function (s) { this.scenes[s.scene_id] = s; }, this);
    this.resolveAsset = opts.resolveAsset || function (p) { return p; };
    this.lives = this.data.lives || 3;
    this.checkpoint = null;
    this.raf = null;
    this.audio = null;
    this._keyHandler = this._onKey.bind(this);
    document.addEventListener("keydown", this._keyHandler);
    this.waitingFor = null; // "start" | "continue" | "qte" | "restart"
    this.qte = null;
    this.renderStart();
  }

  Game.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this._keyHandler);
    this.root.innerHTML = "";
  };

  Game.prototype._sfx = function (kind) {
    if (!this.data.enable_sfx) return;
    if (!this.audio && window.AudioContext) this.audio = new AudioContext();
    if (this.audio && this.audio.state === "suspended") this.audio.resume();
    if (kind === "success") beep(this.audio, 880, 0.12);
    else if (kind === "fail") beep(this.audio, 160, 0.25);
    else beep(this.audio, 440, 0.08);
  };

  Game.prototype._clear = function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    this.qte = null;
    this.root.innerHTML = "";
  };

  Game.prototype._hud = function (extra) {
    if (!this.data.show_hud) return null;
    var hud = el("div", "rg-hud");
    hud.appendChild(el("span", "rg-lives", "♥ " + this.lives));
    if (extra) hud.appendChild(extra);
    return hud;
  };

  /* ---- screens ---- */
  Game.prototype.renderStart = function () {
    this._clear();
    this.waitingFor = "start";
    var s = el("div", "rg-screen rg-start");
    s.appendChild(el("h1", "rg-title", this.data.title || "RadicaLab Game"));
    s.appendChild(el("p", "rg-sub", "Interactive Web Game"));
    var btn = el("button", "rg-btn", "▶ Start");
    btn.onclick = this.begin.bind(this);
    s.appendChild(btn);
    s.appendChild(el("p", "rg-hint", "Press Enter or click to start"));
    this.root.appendChild(s);
  };

  Game.prototype.begin = function () {
    this.lives = this.data.lives || 3;
    this.checkpoint = null;
    this._sfx("tick");
    this.goTo(this.data.start_scene_id);
  };

  Game.prototype.goTo = function (sceneId) {
    this._clear();
    var scene = this.scenes[sceneId];
    if (!scene) { this.renderEnd("The End"); return; }
    if (scene.is_checkpoint) this.checkpoint = scene.scene_id;

    if (scene.scene_type === "end") { this.renderEnd(scene.name || "The End", scene); return; }
    if (scene.scene_type === "failure") { this.playFailure(scene); return; }

    // video / image scene
    if (scene.interaction_type === "qte") this.playQte(scene);
    else this.playLinear(scene);
  };

  Game.prototype._mediaEl = function (scene, onEnded) {
    var url = scene.media_path ? this.resolveAsset(scene.media_path) : null;
    if (scene.scene_type === "image" || (url && /\.(png|jpe?g|webp|gif)$/i.test(url))) {
      var img = el("img", "rg-media");
      if (url) img.src = url;
      return img;
    }
    var v = el("video", "rg-media");
    v.autoplay = true; v.playsInline = true; v.controls = false;
    if (url) v.src = url;
    if (onEnded) v.addEventListener("ended", onEnded);
    var p = v.play && v.play();
    if (p && p.catch) p.catch(function () {});
    return v;
  };

  Game.prototype.playLinear = function (scene) {
    var self = this;
    var stage = el("div", "rg-screen rg-play");
    var advanced = false;
    function advance() {
      if (advanced) return; advanced = true;
      self.goTo(scene.next_scene_id);
    }
    var media = this._mediaEl(scene, advance);
    stage.appendChild(media);
    var hud = this._hud();
    if (hud) stage.appendChild(hud);
    // Images (and any no-`ended` media) advance on Continue.
    if (media.tagName === "IMG") {
      this.waitingFor = "continue";
      this._continue = advance;
      var prompt = el("div", "rg-prompt", "▶ Continue");
      prompt.onclick = advance;
      stage.appendChild(prompt);
    }
    stage.appendChild(el("p", "rg-name", scene.name || ""));
    this.root.appendChild(stage);
  };

  Game.prototype.playQte = function (scene) {
    var self = this;
    var stage = el("div", "rg-screen rg-play rg-qte");
    var media = this._mediaEl(scene, null);
    stage.appendChild(media);

    var overlay = el("div", "rg-qte-overlay");
    overlay.appendChild(el("div", "rg-qte-key", (QTE_LABEL[scene.qte_key] || scene.qte_key)));
    overlay.appendChild(el("div", "rg-qte-instr", "Press the key!"));
    var barWrap = el("div", "rg-bar");
    var bar = el("div", "rg-bar-fill");
    barWrap.appendChild(bar);
    overlay.appendChild(barWrap);
    var hud = this._hud();
    if (hud) overlay.appendChild(hud);
    stage.appendChild(overlay);
    this.root.appendChild(stage);

    var limit = (scene.time_limit_seconds || 3) * 1000;
    var start = performance.now();
    this.waitingFor = "qte";
    this.qte = {
      scene: scene,
      done: false,
      resolve: function (ok) {
        if (self.qte && self.qte.done) return;
        if (self.qte) self.qte.done = true;
        self.waitingFor = null;
        if (ok) { self._sfx("success"); self.goTo(scene.success_scene_id); }
        else { self._sfx("fail"); self.goTo(scene.failure_scene_id); }
      }
    };
    function tick(now) {
      if (!self.qte || self.qte.done) return;
      var frac = Math.max(0, 1 - (now - start) / limit);
      bar.style.width = (frac * 100).toFixed(1) + "%";
      if (frac <= 0) { self.qte.resolve(false); return; }
      self.raf = requestAnimationFrame(tick);
    }
    this.raf = requestAnimationFrame(tick);
  };

  Game.prototype.playFailure = function (scene) {
    var self = this;
    var stage = el("div", "rg-screen rg-play rg-failure");
    var resolved = false;
    function afterFailure() {
      if (resolved) return; resolved = true;
      self.lives = Math.max(0, self.lives - 1);
      if (self.lives <= 0) { self.renderGameOver(); return; }
      var b = scene.after_scene_behavior || "restart_checkpoint";
      if (b === "game_over") self.renderGameOver();
      else if (b === "restart_game") self.begin();
      else self.goTo(self.checkpoint || self.data.start_scene_id); // restart_checkpoint
    }
    var media = this._mediaEl(scene, afterFailure);
    stage.appendChild(media);
    stage.appendChild(el("div", "rg-banner", "✖ " + (scene.name || "Failed")));
    var hud = this._hud();
    if (hud) stage.appendChild(hud);
    if (media.tagName === "IMG") {
      // No natural end for an image failure — advance after a short beat.
      setTimeout(afterFailure, 1600);
    }
    this.root.appendChild(stage);
  };

  Game.prototype.renderGameOver = function () {
    this._clear();
    this.waitingFor = "restart";
    var s = el("div", "rg-screen rg-over");
    s.appendChild(el("h1", "rg-title", "GAME OVER"));
    var btn = el("button", "rg-btn", "↺ Restart");
    btn.onclick = this.renderStart.bind(this);
    s.appendChild(btn);
    s.appendChild(el("p", "rg-hint", "Press Enter or click to restart"));
    this.root.appendChild(s);
  };

  Game.prototype.renderEnd = function (title, scene) {
    this._clear();
    this.waitingFor = "restart";
    var s = el("div", "rg-screen rg-end");
    if (scene && scene.media_path) {
      s.appendChild(this._mediaEl(scene, null));
    }
    s.appendChild(el("h1", "rg-title", title || "The End"));
    var btn = el("button", "rg-btn", "↺ Play again");
    btn.onclick = this.renderStart.bind(this);
    s.appendChild(btn);
    s.appendChild(el("p", "rg-hint", "Press Enter or click to play again"));
    this.root.appendChild(s);
  };

  Game.prototype._onKey = function (ev) {
    var key = ev.key === " " ? "Space" : ev.key;
    if (this.waitingFor === "qte" && this.qte && !this.qte.done) {
      ev.preventDefault();
      this.qte.resolve(key === this.qte.scene.qte_key); // wrong key = immediate failure
    } else if (this.waitingFor === "start" && (key === "Enter" || key === "Space")) {
      ev.preventDefault(); this.begin();
    } else if (this.waitingFor === "continue" && (key === "Enter" || key === "Space")) {
      ev.preventDefault(); if (this._continue) this._continue();
    } else if (this.waitingFor === "restart" && (key === "Enter" || key === "Space")) {
      ev.preventDefault(); this.renderStart();
    }
  };

  window.RadicaGame = {
    _instance: null,
    mount: function (root, data, opts) {
      if (this._instance) this._instance.destroy();
      this._instance = new Game(root, data, opts);
      return this._instance;
    }
  };
})();
