/* RadicaLab GameLab — builder frontend (v1 + functional fix).
 * Talks to /api/gamelab/*, edits scenes, shows real media previews, previews
 * scene flow, runs Test Play in an iframe using the SAME runtime as the exported
 * build, and triggers export. Import from Library creates scenes from existing
 * VideoLab / Sequence Queue outputs (media is copied, never moved).
 * Concept & Design: Fabrizio Radica — Project by RadicaDesign */

window.GameLab = (function () {
  "use strict";

  var API = "/api/gamelab";
  var state = {
    project: null, sceneId: null, options: {}, libMode: "new",
    tab: "qte",
    // AI Game Generator (PATCH_GameLabPromptToGameConfig_v1)
    ai: { loaded: false, templates: [], invalid: [], providerDefaults: null,
          cfg: null, selectedTpl: null, errors: [], busy: false, syncedProject: null }
  };

  function $(id) { return document.getElementById(id); }
  function opt(value, label, selected) {
    var o = document.createElement("option");
    o.value = value; o.textContent = label;
    if (selected) o.selected = true;
    return o;
  }
  function fillSelect(sel, values, current, labeler) {
    sel.innerHTML = "";
    (values || []).forEach(function (v) {
      sel.appendChild(opt(v, labeler ? labeler(v) : v, v === current));
    });
  }
  function titleCase(s) {
    return String(s).replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function sceneName(id) {
    if (!id) return "—";
    var s = (state.project.scenes || []).find(function (x) { return x.scene_id === id; });
    return s ? s.name : "(missing)";
  }
  function isImage(p) { return /\.(png|jpe?g|webp|gif)$/i.test(p || ""); }

  /* media_path "assets/videos/x.mp4" -> "/media/gamelab/<id>/asset/videos/x.mp4" */
  function mediaUrl(mediaPath) {
    if (!mediaPath || !state.project) return null;
    var m = String(mediaPath).split("/");
    if (m.length !== 3) return null;
    return "/media/gamelab/" + state.project.game_id + "/asset/" + m[1] + "/" + m[2];
  }

  /* Build a real preview element for a media_path (honest "Media missing" on 404). */
  function previewEl(mediaPath, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "gl-preview" + (opts.cls ? " " + opts.cls : "");
    var url = mediaUrl(mediaPath);
    if (!mediaPath || !url) {
      wrap.classList.add("empty");
      wrap.textContent = mediaPath ? "Media missing" : "No media";
      return wrap;
    }
    var media;
    if (isImage(mediaPath)) {
      media = document.createElement("img");
      media.src = url;
    } else {
      media = document.createElement("video");
      media.src = url;
      media.muted = true;
      media.preload = "metadata";
      media.playsInline = true;
      if (opts.controls) media.controls = true;
    }
    media.onerror = function () { wrap.className = "gl-preview empty"; wrap.textContent = "Media missing"; };
    wrap.appendChild(media);
    return wrap;
  }

  /* ---------------- project lifecycle ---------------- */
  async function loadList(selectId) {
    var data = await WVG.api(API + "/projects");
    var sel = $("gl-project-select");
    sel.innerHTML = "";
    sel.appendChild(opt("", "— Select a game —", false));
    (data.projects || []).forEach(function (p) {
      sel.appendChild(opt(p.game_id, p.title + "  (" + p.scene_count + " scenes)", p.game_id === selectId));
    });
    if (selectId) sel.value = selectId;
  }

  async function createGame() {
    var title = window.prompt("New game title:", "Neon Rebel");
    if (title === null) return;
    try {
      var data = await WVG.api(API + "/projects", { method: "POST", body: { title: title } });
      await loadList(data.project.game_id);
      await selectProject(data.project.game_id);
      WVG.toast("Game created.", "success");
    } catch (e) { WVG.toast("Could not create game", "error", e.message); }
  }

  async function deleteGame() {
    if (!state.project) return;
    if (!window.confirm("Delete game project '" + state.project.title +
        "'?\nThis removes the GameLab project folder. Original VideoLab / Sequence Queue " +
        "videos are NOT affected.")) return;
    try {
      await WVG.api(API + "/projects/" + state.project.game_id, { method: "DELETE" });
      state.project = null; state.sceneId = null;
      await loadList();
      render();
      WVG.toast("Game project deleted.", "success");
    } catch (e) { WVG.toast("Could not delete game", "error", e.message); }
  }

  async function selectProject(gameId) {
    if (!gameId) { state.project = null; render(); return; }
    try {
      var data = await WVG.api(API + "/projects/" + gameId);
      state.project = data.project;
      state.sceneId = (data.project.scenes[0] || {}).scene_id || null;
      applyValidation(data.validation);
      render();
    } catch (e) { WVG.toast("Could not load game", "error", e.message); }
  }

  function applyValidation(errors) {
    var box = $("gl-validation");
    var ok = !errors || errors.length === 0;
    var empty = state.project && !state.project.scenes.length;
    if (empty) { box.textContent = "No scenes yet"; box.className = "gl-valid"; box.title = ""; }
    else {
      box.textContent = ok ? "✓ Ready to export" : (errors.length + " issue" + (errors.length > 1 ? "s" : ""));
      box.className = "gl-valid " + (ok ? "ok" : "warn");
      box.title = ok ? "" : errors.join("\n");
    }
    var has = !!state.project;
    $("gl-export").disabled = !has || !ok || empty;
    $("gl-save").disabled = !has;
    $("gl-delete-game").disabled = !has;
    $("gl-play").disabled = !has || !state.project.scenes.length;
    $("gl-play-2").disabled = $("gl-play").disabled;
  }

  /* ---------------- rendering ---------------- */
  function render() {
    var has = !!state.project;
    $("gl-empty").style.display = has ? "none" : "";
    $("gl-workspace").style.display = has ? "" : "none";
    renderAITab();
    if (!has) { applyValidation([]); return; }
    var p = state.project;
    $("gl-title").value = p.title;
    fillSelect($("gl-template"), state.options.templates, p.template, titleCase);
    fillSelect($("gl-theme"), state.options.themes, p.theme, titleCase);
    $("gl-lives").value = p.lives;
    $("gl-hud").checked = p.show_hud;
    $("gl-sfx").checked = p.enable_sfx;
    $("gl-music").checked = p.enable_music;
    var startSel = $("gl-start");
    startSel.innerHTML = "";
    startSel.appendChild(opt("", "— none —", !p.start_scene_id));
    p.scenes.forEach(function (s) { startSel.appendChild(opt(s.scene_id, s.name, s.scene_id === p.start_scene_id)); });

    $("gl-scene-count").textContent = p.scenes.length + " scene" + (p.scenes.length === 1 ? "" : "s");
    renderSceneList();
    renderEditor();
    renderFlow();
  }

  function sceneBadge(s) {
    var t = s.scene_type;
    var label = t === "failure" ? "failure" : t === "end" ? "end" : (s.interaction_type === "qte" ? "QTE" : t);
    return '<span class="gl-badge gl-badge-' + t + '">' + label + "</span>";
  }

  function renderSceneList() {
    var list = $("gl-scene-list");
    list.innerHTML = "";
    var scenes = state.project.scenes;
    if (!scenes.length) {
      list.innerHTML = '<p class="muted small">No scenes yet. Add a scene or import a ' +
        'generated video from Library.</p>';
      return;
    }
    scenes.forEach(function (s, i) {
      var card = document.createElement("div");
      card.className = "gl-scene-card" + (s.scene_id === state.sceneId ? " active" : "");
      var isStart = s.scene_id === state.project.start_scene_id;

      var thumb = document.createElement("div");
      thumb.className = "gl-scene-thumb";
      thumb.appendChild(previewEl(s.media_path, { cls: "thumb" }));

      var info = document.createElement("div");
      info.className = "gl-scene-info";
      info.innerHTML =
        '<div class="gl-scene-name">' + (isStart ? "★ " : "") + escapeHtml(s.name) + "</div>" +
        '<div class="gl-scene-meta">' + sceneBadge(s) +
          (s.is_checkpoint ? ' <span class="gl-badge gl-badge-cp">checkpoint</span>' : "") + "</div>";

      var reorder = document.createElement("div");
      reorder.className = "gl-scene-reorder";
      var up = document.createElement("button");
      up.className = "gl-move"; up.textContent = "▲"; up.title = "Move up"; up.disabled = i === 0;
      up.onclick = function (e) { e.stopPropagation(); moveScene(s.scene_id, "up"); };
      var down = document.createElement("button");
      down.className = "gl-move"; down.textContent = "▼"; down.title = "Move down"; down.disabled = i === scenes.length - 1;
      down.onclick = function (e) { e.stopPropagation(); moveScene(s.scene_id, "down"); };
      reorder.appendChild(up); reorder.appendChild(down);

      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(reorder);
      card.onclick = function () { state.sceneId = s.scene_id; render(); };
      list.appendChild(card);
    });
  }

  function targetSelect(sel, current) {
    sel.innerHTML = "";
    sel.appendChild(opt("", "— none —", !current));
    state.project.scenes.forEach(function (s) {
      sel.appendChild(opt(s.scene_id, s.name, s.scene_id === current));
    });
  }

  function scene() {
    return (state.project.scenes || []).find(function (s) { return s.scene_id === state.sceneId; });
  }

  function renderEditor() {
    var s = scene();
    $("gl-editor-empty").style.display = s ? "none" : "";
    $("gl-editor").style.display = s ? "" : "none";
    if (!s) return;
    $("gl-s-name").value = s.name;
    fillSelect($("gl-s-type"), state.options.scene_types, s.scene_type, titleCase);
    fillSelect($("gl-s-interaction"), state.options.interaction_types, s.interaction_type, titleCase);
    fillSelect($("gl-s-qtekey"), state.options.qte_keys, s.qte_key);
    fillSelect($("gl-s-after"), state.options.after_failure, s.after_scene_behavior, titleCase);
    $("gl-s-timelimit").value = s.time_limit_seconds;
    $("gl-s-checkpoint").checked = s.is_checkpoint;
    targetSelect($("gl-s-next"), s.next_scene_id);
    targetSelect($("gl-s-success"), s.success_scene_id);
    targetSelect($("gl-s-failure"), s.failure_scene_id);
    $("gl-s-media-path").textContent = s.media_path || "No media";
    var thumb = $("gl-s-media-thumb");
    thumb.innerHTML = "";
    thumb.appendChild(previewEl(s.media_path, { cls: "editor", controls: !isImage(s.media_path) }));
    applyVisibility(s.scene_type, s.interaction_type);
  }

  function applyVisibility(type, interaction) {
    var interactive = (type === "video" || type === "image");
    var map = {
      "interactive": interactive,
      "none": interactive && interaction === "none",
      "qte": interactive && interaction === "qte",
      "failure": type === "failure",
      "not-end": type !== "end"
    };
    Object.keys(map).forEach(function (k) {
      document.querySelectorAll('#gl-editor [data-when="' + k + '"]').forEach(function (el) {
        el.style.display = map[k] ? "" : "none";
      });
    });
  }

  function renderFlow() {
    var flow = $("gl-flow");
    flow.innerHTML = "";
    var p = state.project;
    if (!p.scenes.length) { flow.innerHTML = '<p class="muted small">No scenes yet.</p>'; return; }
    p.scenes.forEach(function (s) {
      var node = document.createElement("div");
      node.className = "gl-flow-node" + (s.scene_id === p.start_scene_id ? " start" : "");
      var rows = "";
      if (s.scene_type === "end") {
        rows = '<div class="gl-flow-edge end">■ end</div>';
      } else if (s.scene_type === "failure") {
        rows = '<div class="gl-flow-edge fail">↺ ' + escapeHtml(titleCase(s.after_scene_behavior)) + "</div>";
      } else if (s.interaction_type === "qte") {
        rows =
          '<div class="gl-flow-edge ok">✓ ' + escapeHtml(sceneName(s.success_scene_id)) + "</div>" +
          '<div class="gl-flow-edge fail">✗ ' + escapeHtml(sceneName(s.failure_scene_id)) + "</div>";
      } else {
        rows = '<div class="gl-flow-edge">↓ ' + escapeHtml(sceneName(s.next_scene_id)) + "</div>";
      }
      node.innerHTML =
        '<div class="gl-flow-title">' + (s.scene_id === p.start_scene_id ? "▶ " : "") +
        escapeHtml(s.name) + " " + sceneBadge(s) + "</div>" + rows;
      node.onclick = function () { state.sceneId = s.scene_id; render(); };
      flow.appendChild(node);
    });
  }

  function ingest(data, keepScene) {
    state.project = data.project;
    if (!keepScene && data.scene) state.sceneId = data.scene.scene_id;
    applyValidation(data.validation);
    render();
  }

  /* ---------------- mutations (auto-save) ---------------- */
  async function saveSettings(silent) {
    if (!state.project) return;
    var body = {
      title: $("gl-title").value,
      template: $("gl-template").value,
      theme: $("gl-theme").value,
      start_scene_id: $("gl-start").value || null,
      lives: parseInt($("gl-lives").value, 10) || 3,
      show_hud: $("gl-hud").checked,
      enable_sfx: $("gl-sfx").checked,
      enable_music: $("gl-music").checked
    };
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id, { method: "PUT", body: body });
      state.project = data.project;
      applyValidation(data.validation);
      renderSceneList(); renderFlow();
      if (!silent) WVG.toast("Saved.", "success");
    } catch (e) { WVG.toast("Save failed", "error", e.message); }
  }

  async function addScene(preset) {
    if (!state.project) return;
    try {
      ingest(await WVG.api(API + "/projects/" + state.project.game_id + "/scenes",
        { method: "POST", body: preset || {} }));
    } catch (e) { WVG.toast("Could not add scene", "error", e.message); }
  }

  async function saveScene() {
    var s = scene();
    if (!s) return;
    var body = {
      name: $("gl-s-name").value,
      scene_type: $("gl-s-type").value,
      interaction_type: $("gl-s-interaction").value,
      qte_key: $("gl-s-qtekey").value,
      time_limit_seconds: parseFloat($("gl-s-timelimit").value) || 3,
      next_scene_id: $("gl-s-next").value || null,
      success_scene_id: $("gl-s-success").value || null,
      failure_scene_id: $("gl-s-failure").value || null,
      after_scene_behavior: $("gl-s-after").value,
      is_checkpoint: $("gl-s-checkpoint").checked
    };
    try {
      ingest(await WVG.api(API + "/projects/" + state.project.game_id + "/scenes/" + s.scene_id,
        { method: "PUT", body: body }), true);
    } catch (e) { WVG.toast("Could not save scene", "error", e.message); }
  }

  async function deleteScene() {
    var s = scene();
    if (!s || !window.confirm("Delete scene '" + s.name + "'?")) return;
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id + "/scenes/" + s.scene_id,
        { method: "DELETE" });
      state.project = data.project;
      state.sceneId = (data.project.scenes[0] || {}).scene_id || null;
      applyValidation(data.validation);
      render();
    } catch (e) { WVG.toast("Could not delete scene", "error", e.message); }
  }

  async function duplicateScene() {
    var s = scene();
    if (!s) return;
    try {
      ingest(await WVG.api(API + "/projects/" + state.project.game_id + "/scenes/" + s.scene_id + "/duplicate",
        { method: "POST" }));
    } catch (e) { WVG.toast("Could not duplicate", "error", e.message); }
  }

  async function moveScene(sceneId, direction) {
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id + "/scenes/" + sceneId + "/move",
        { method: "POST", body: { direction: direction } });
      state.sceneId = sceneId; // keep selection on the moved scene
      state.project = data.project;
      applyValidation(data.validation);
      render();
    } catch (e) { WVG.toast("Could not move scene", "error", e.message); }
  }

  /* ---------------- media (upload + import) ---------------- */
  async function uploadMedia(file) {
    if (!file) return;
    var s = scene();
    if (!s) { WVG.toast("Select a scene first, or use Import from Library to add one.", "error"); return; }
    var fd = new FormData();
    fd.append("file", file);
    fd.append("as_new_scene", "false");
    fd.append("scene_id", s.scene_id);
    try {
      ingest(await WVG.api(API + "/projects/" + state.project.game_id + "/media/upload",
        { method: "POST", body: fd }), true);
      WVG.toast("Media uploaded.", "success");
    } catch (e) { WVG.toast("Upload failed", "error", e.message); }
  }

  async function openLibrary(mode) {
    // mode "new" (Scenes panel) creates a scene from the asset; "replace" sets
    // the current scene's media and therefore needs a selected scene.
    state.libMode = mode;
    if (mode === "replace" && !scene()) { WVG.toast("Select a scene first.", "error"); return; }
    WVG.openModal("gl-lib-modal");
    var grid = $("gl-lib-grid");
    grid.innerHTML = '<p class="muted small">Loading…</p>';
    $("gl-lib-empty").style.display = "none";
    try {
      var data = await WVG.api(API + "/library-assets");
      grid.innerHTML = "";
      if (!data.assets.length) { $("gl-lib-empty").style.display = ""; return; }
      data.assets.forEach(function (a) {
        var card = document.createElement("div");
        card.className = "gl-lib-card";
        card.innerHTML =
          (a.preview ? '<img src="' + a.preview + '">' : '<div class="gl-lib-noimg">🎞</div>') +
          '<div class="gl-lib-name">' + escapeHtml(a.label) + "</div>" +
          '<div class="gl-lib-proj muted small">' + escapeHtml(a.group) + "</div>";
        card.onclick = function () { importAsset(a); };
        grid.appendChild(card);
      });
    } catch (e) { grid.innerHTML = '<p class="muted small">Could not load: ' + escapeHtml(e.message) + "</p>"; }
  }

  async function importAsset(a) {
    var body = { source: a.source, as_new_scene: state.libMode !== "replace" };
    if (state.libMode === "replace") body.scene_id = state.sceneId;
    try {
      ingest(await WVG.api(API + "/projects/" + state.project.game_id + "/media/import",
        { method: "POST", body: body }), state.libMode === "replace");
      WVG.closeModal("gl-lib-modal");
      WVG.toast(state.libMode === "replace" ? "Scene media replaced." : "Scene created from Library.", "success");
    } catch (e) { WVG.toast("Import failed", "error", e.message); }
  }

  /* ---------------- export ---------------- */
  async function exportBuild() {
    if (!state.project) return;
    try {
      var res = await WVG.api(API + "/projects/" + state.project.game_id + "/export", { method: "POST" });
      WVG.toast("Exported: " + res.export_dir + " (" + res.asset_count + " assets)", "success", res.note);
    } catch (e) { WVG.toast("Export failed", "error", e.message); }
  }

  /* ---------------- test play (iframe, same runtime as export) ---------------- */
  function testPlay() {
    if (!state.project || !state.project.scenes.length) return;
    var gameId = state.project.game_id;
    var data = {
      title: state.project.title, theme: state.project.theme,
      start_scene_id: state.project.start_scene_id, lives: state.project.lives,
      checkpoint_mode: state.project.checkpoint_mode, show_hud: state.project.show_hud,
      enable_sfx: state.project.enable_sfx, enable_music: state.project.enable_music,
      scenes: state.project.scenes
    };
    var origin = window.location.origin;
    var html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="' + origin + '/static/export_templates/gamelab/style.css">' +
      '</head><body><div id="game-root" class="rg-root"></div>' +
      '<script id="d" type="application/json">' + JSON.stringify(data).replace(/</g, "\\u003c") + '<\/script>' +
      '<script src="' + origin + '/static/export_templates/gamelab/game_runtime.js"><\/script>' +
      '<script>(function(){var d=JSON.parse(document.getElementById("d").textContent);' +
      'var base="' + origin + '/media/gamelab/' + gameId + '/asset/";' +
      'RadicaGame.mount(document.getElementById("game-root"),d,{resolveAsset:function(p){' +
      'var m=String(p).split("/");return base+m[1]+"/"+m[2];}});})();<\/script>' +
      '</body></html>';
    var frame = $("gl-play-frame");
    frame.removeAttribute("src"); // AI Test Play may have set a src earlier
    frame.srcdoc = html;
    WVG.openModal("gl-play-modal");
  }

  function closePlay() {
    WVG.closeModal("gl-play-modal");
    var frame = $("gl-play-frame");
    frame.srcdoc = "";
    frame.removeAttribute("srcdoc");
    frame.src = "about:blank";
  }

  /* ================= AI Game Generator (prompt-to-config v1) ================
   * Manual template selection from the real repository, prompt-to-JSON-config
   * generation through the shared AI Assistant provider layer, schema
   * validation, build with the LOCKED template runtime, Test Play + export.
   * No runtime code is ever generated or modified here. */

  var SUBTITLES = {
    qte: "Build interactive video games with scenes, QTE events, branching flow and standalone web export.",
    ai: "Generate Canvas2D browser games from prompts using controlled templates and validated configurations."
  };

  function switchTab(tab) {
    state.tab = tab;
    var host = $("gamelab");
    host.dataset.glTab = tab;
    $("gl-tab-btn-qte").classList.toggle("active", tab === "qte");
    $("gl-tab-btn-ai").classList.toggle("active", tab === "ai");
    $("gl-tab-qte").style.display = tab === "qte" ? "" : "none";
    $("gl-tab-ai").style.display = tab === "ai" ? "" : "none";
    $("gl-tab-subtitle").textContent = SUBTITLES[tab];
    if (tab === "ai" && !state.ai.loaded) loadAIData();
    renderAITab();
  }

  async function loadAIData() {
    state.ai.loaded = true;
    try {
      var tpl = await WVG.api(API + "/ai/templates");
      state.ai.templates = tpl.templates || [];
      state.ai.invalid = tpl.invalid || [];
      if (tpl.error) WVG.toast("Template repository", "error", tpl.error);
    } catch (e) { WVG.toast("Could not load templates", "error", e.message); }
    try {
      var cfg = await WVG.api("/api/ai-assistant/config");
      state.ai.cfg = cfg.config || null;
      state.ai.providerDefaults = cfg.provider_defaults || {};
      fillProviderSelect();
    } catch (e) { WVG.toast("Could not load AI provider config", "error", e.message); }
    renderTemplateList();
    renderAITab();
  }

  function fillProviderSelect() {
    var sel = $("gl-ai-provider");
    var defaults = state.ai.providerDefaults || {};
    var current = state.ai.cfg ? state.ai.cfg.provider.provider : "ollama";
    sel.innerHTML = "";
    Object.keys(defaults).forEach(function (key) {
      sel.appendChild(opt(key, defaults[key].label || key, key === current));
    });
    syncModelField();
  }

  function syncModelField() {
    var sel = $("gl-ai-provider"), input = $("gl-ai-model");
    var defaults = state.ai.providerDefaults || {};
    var chosen = sel.value;
    var stored = state.ai.cfg ? state.ai.cfg.provider : null;
    input.placeholder = (defaults[chosen] || {}).default_model || "provider default";
    input.value = (stored && stored.provider === chosen) ? (stored.model_name || "") : "";
  }

  function aiGame() { return state.project ? state.project.ai_game : null; }

  /* Populate prompt/config fields from the loaded project — only when the
   * project actually changed, so typing is never clobbered by re-renders. */
  function syncAIFields() {
    var pid = state.project ? state.project.game_id : null;
    if (state.ai.syncedProject === pid) return;
    state.ai.syncedProject = pid;
    state.ai.errors = [];
    var ai = aiGame();
    $("gl-ai-prompt").value = ai ? (ai.prompt || "") : "";
    state.ai.selectedTpl = ai && ai.template_id ? ai.template_id : null;
    setConfigEditor(ai && ai.config ? ai.config : null);
    renderTemplateList();
    renderValidation(null);
  }

  function setConfigEditor(cfg) {
    var has = !!cfg;
    $("gl-ai-config-empty").style.display = has ? "none" : "";
    $("gl-ai-config-wrap").style.display = has ? "" : "none";
    if (has) $("gl-ai-config").value = JSON.stringify(cfg, null, 2);
    var ai = aiGame();
    $("gl-ai-config-meta").textContent = ai && ai.generated_at
      ? "Generated with " + (ai.provider || "?") + " / " + (ai.model_name || "?") : "";
  }

  function selectedTemplate() {
    return state.ai.templates.find(function (t) { return t.template_id === state.ai.selectedTpl; }) || null;
  }

  function renderTemplateList() {
    var list = $("gl-ai-tpl-list");
    if (!list) return;
    list.innerHTML = "";
    $("gl-ai-tpl-count").textContent = state.ai.templates.length + " template" +
      (state.ai.templates.length === 1 ? "" : "s");
    if (!state.ai.templates.length) {
      list.innerHTML = '<p class="muted small">No valid templates found in gamelab_templates/.</p>';
    }
    state.ai.templates.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "gl-tpl-card" + (t.template_id === state.ai.selectedTpl ? " selected" : "");
      card.innerHTML =
        '<div class="gl-tpl-name">' + escapeHtml(t.name) + "</div>" +
        '<div class="gl-tpl-desc muted small">' + escapeHtml(t.description || "") + "</div>" +
        '<div class="gl-tpl-meta"><span class="gl-badge">' + escapeHtml(t.engine) + "</span>" +
        (t.version ? ' <span class="gl-badge">v' + escapeHtml(t.version) + "</span>" : "") + "</div>";
      card.onclick = function () {
        state.ai.selectedTpl = t.template_id;
        renderTemplateList();
        renderAITab();
      };
      list.appendChild(card);
    });
    var inv = $("gl-ai-tpl-invalid");
    inv.innerHTML = "";
    if (state.ai.invalid.length) {
      inv.innerHTML = '<p class="small muted" style="margin-bottom:4px;">Skipped invalid packages:</p>' +
        state.ai.invalid.map(function (i) {
          return '<div class="gl-vitem warn">⚠ ' + escapeHtml(i.folder) + ": " + escapeHtml(i.reason) + "</div>";
        }).join("");
    }
    renderTemplateDetail();
  }

  function renderTemplateDetail() {
    var t = selectedTemplate();
    $("gl-ai-tpl-detail").style.display = t ? "" : "none";
    if (!t) return;
    $("gl-ai-tpl-name").textContent = t.name;
    $("gl-ai-tpl-desc").textContent = t.description || "";
    $("gl-ai-tpl-caps").innerHTML = (t.capabilities || []).map(function (c) {
      return '<span class="gl-cap">' + escapeHtml(c) + "</span>";
    }).join("");
  }

  /* Validation panel: real results only. `errors` = fresh schema errors from
   * the last generate/apply; null = show the stored state of the project. */
  function renderValidation(errors) {
    if (errors !== null) state.ai.errors = errors || [];
    var box = $("gl-ai-validation");
    if (!box) return;
    var ai = aiGame();
    if (!ai || !ai.config) {
      box.innerHTML = '<p class="muted small">Nothing to validate yet.</p>';
      return;
    }
    var html = "";
    if (ai.schema_valid) {
      html += '<div class="gl-vitem ok">✓ Schema valid</div>';
    } else {
      html += '<div class="gl-vitem err">✗ Schema invalid</div>';
      if (state.ai.errors.length) {
        html += state.ai.errors.map(function (e) {
          return '<div class="gl-vitem err small">• ' + escapeHtml(e) + "</div>";
        }).join("");
      } else {
        html += '<div class="gl-vitem warn small">Use "Apply & Revalidate" to list the errors.</div>';
      }
    }
    (ai.warnings || []).forEach(function (w) {
      html += '<div class="gl-vitem warn">⚠ ' + escapeHtml(w) + "</div>";
    });
    box.innerHTML = html;
  }

  function renderAITab() {
    if (!$("gl-ai-workspace")) return;
    var has = !!state.project;
    $("gl-ai-empty").style.display = has ? "none" : "";
    $("gl-ai-workspace").style.display = has ? "" : "none";
    if (!has) { state.ai.syncedProject = null; return; }
    syncAIFields();
    var ai = aiGame();
    $("gl-ai-generate").disabled = state.ai.busy || !state.ai.selectedTpl;
    $("gl-ai-build").disabled = state.ai.busy || !(ai && ai.config && ai.schema_valid);
    $("gl-ai-play").disabled = !(ai && ai.build_dir);
    renderReadiness();
  }

  function renderReadiness() {
    var box = $("gl-ai-readiness");
    var ai = aiGame();
    function row(ok, label) {
      return '<div class="gl-ready-row ' + (ok ? "ok" : "") + '">' +
        (ok ? "✓" : "○") + " " + escapeHtml(label) + "</div>";
    }
    box.innerHTML =
      row(!!state.ai.selectedTpl, "Template selected" +
        (state.ai.selectedTpl ? ": " + state.ai.selectedTpl : "")) +
      row(!!(ai && ai.config), "Config generated") +
      row(!!(ai && ai.schema_valid), "Schema valid") +
      row(!!(ai && ai.build_dir), ai && ai.build_dir
        ? "Built: " + ai.build_dir : "Standalone build");
    $("gl-ai-export-info").textContent = ai && ai.build_dir
      ? "Export folder: projects/gamelab/" + state.project.game_id + "/" + ai.build_dir +
        " — standalone HTML/CSS/JS, no server needed."
      : "";
  }

  async function aiGenerate() {
    if (!state.project || !state.ai.selectedTpl || state.ai.busy) return;
    var prompt = $("gl-ai-prompt").value.trim();
    if (!prompt) { WVG.toast("Write a game prompt first.", "error"); return; }
    state.ai.busy = true;
    $("gl-ai-generate").disabled = true;
    $("gl-ai-gen-status").textContent = "Generating configuration… (this can take a while on local models)";
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id + "/ai/generate", {
        method: "POST",
        body: {
          template_id: state.ai.selectedTpl,
          prompt: prompt,
          provider: $("gl-ai-provider").value,
          model_name: $("gl-ai-model").value.trim() || null
        }
      });
      if (data.parse_error) {
        $("gl-ai-gen-status").textContent = "";
        WVG.toast("Generation failed", "error", (data.errors || []).join(" "));
        return;
      }
      state.project.ai_game = data.ai_game;
      setConfigEditor(data.ai_game.config);
      renderValidation(data.errors || []);
      var st = data.ai_game.schema_valid ? "Config generated and schema-valid."
        : "Config generated but NOT schema-valid — see Validation.";
      $("gl-ai-gen-status").textContent = "";
      WVG.toast(st, data.ai_game.schema_valid ? "success" : "error",
        data.notes || (data.errors || []).slice(0, 3).join("\n"));
      if (data.release && data.release.warning) WVG.toast("Resource note", "error", data.release.warning);
    } catch (e) {
      $("gl-ai-gen-status").textContent = "";
      WVG.toast("Generation failed", "error", e.message);
    } finally {
      state.ai.busy = false;
      renderAITab();
    }
  }

  async function aiApplyConfig() {
    if (!state.project) return;
    var cfg;
    try { cfg = JSON.parse($("gl-ai-config").value); }
    catch (e) { WVG.toast("The edited config is not valid JSON", "error", e.message); return; }
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id + "/ai/config",
        { method: "PUT", body: { config: cfg } });
      state.project.ai_game = data.ai_game;
      renderValidation(data.errors || []);
      renderAITab();
      WVG.toast(data.ai_game.schema_valid ? "Config valid and saved." : "Saved, but schema-invalid.",
        data.ai_game.schema_valid ? "success" : "error");
    } catch (e) { WVG.toast("Could not apply config", "error", e.message); }
  }

  async function aiBuild() {
    if (!state.project || state.ai.busy) return;
    state.ai.busy = true;
    $("gl-ai-build").disabled = true;
    try {
      var data = await WVG.api(API + "/projects/" + state.project.game_id + "/ai/build", { method: "POST" });
      state.project.ai_game = data.ai_game;
      WVG.toast("Game built: " + data.export_dir, "success", data.note);
    } catch (e) { WVG.toast("Build failed", "error", e.message); }
    finally {
      state.ai.busy = false;
      renderAITab();
    }
  }

  function aiTestPlay() {
    var ai = aiGame();
    if (!state.project || !ai || !ai.build_dir) return;
    var frame = $("gl-play-frame");
    frame.removeAttribute("srcdoc"); // srcdoc would override src
    // The built_at token namespaces this build's URLs: index.html AND its
    // sibling runtime/config files resolve under it, so the browser can never
    // reuse a cached runtime from a previous build of a different template
    // (which made the runtime loader report "inline configuration is not
    // valid JSON" even though the built inline config was valid).
    var token = String(ai.built_at || "").replace(/\D/g, "") || String(Date.now());
    frame.src = "/media/gamelab/" + state.project.game_id + "/ai-build/" + token + "/index.html";
    WVG.openModal("gl-play-modal");
  }

  /* ---------------- wiring ---------------- */
  function bind() {
    $("gl-tab-btn-qte").onclick = function () { switchTab("qte"); };
    $("gl-tab-btn-ai").onclick = function () { switchTab("ai"); };
    $("gl-ai-new").onclick = createGame;
    $("gl-ai-provider").onchange = syncModelField;
    $("gl-ai-generate").onclick = aiGenerate;
    $("gl-ai-apply").onclick = aiApplyConfig;
    $("gl-ai-build").onclick = aiBuild;
    $("gl-ai-play").onclick = aiTestPlay;
    $("gl-new").onclick = createGame;
    $("gl-new-2").onclick = createGame;
    $("gl-project-select").onchange = function () { selectProject(this.value); };
    $("gl-save").onclick = function () { saveSettings(false); };
    $("gl-export").onclick = exportBuild;
    $("gl-delete-game").onclick = deleteGame;
    $("gl-play").onclick = testPlay;
    $("gl-play-2").onclick = testPlay;

    ["gl-title", "gl-template", "gl-theme", "gl-start", "gl-lives", "gl-hud", "gl-sfx", "gl-music"]
      .forEach(function (id) { $(id).addEventListener("change", function () { saveSettings(true); }); });

    $("gl-add-scene").onclick = function () { addScene({ scene_type: "video", interaction_type: "none", name: "New Scene" }); };
    $("gl-add-failure").onclick = function () { addScene({ scene_type: "failure", interaction_type: "none", name: "Failure Scene" }); };
    $("gl-add-end").onclick = function () { addScene({ scene_type: "end", interaction_type: "none", name: "The End" }); };
    $("gl-import-lib").onclick = function () { openLibrary("new"); };

    ["gl-s-name", "gl-s-type", "gl-s-interaction", "gl-s-qtekey", "gl-s-timelimit",
     "gl-s-next", "gl-s-success", "gl-s-failure", "gl-s-after", "gl-s-checkpoint"]
      .forEach(function (id) { $(id).addEventListener("change", saveScene); });

    $("gl-s-upload").onclick = function () { $("gl-s-file").click(); };
    $("gl-s-file").onchange = function () { if (this.files[0]) uploadMedia(this.files[0]); this.value = ""; };
    $("gl-s-import").onclick = function () { openLibrary("replace"); };
    $("gl-s-duplicate").onclick = duplicateScene;
    $("gl-s-delete").onclick = deleteScene;
  }

  function init() {
    var host = $("gamelab");
    if (!host) return;
    try { state.options = JSON.parse(host.dataset.options || "{}"); } catch (e) { state.options = {}; }
    bind();
    loadList();
  }

  document.addEventListener("DOMContentLoaded", init);
  return { closePlay: closePlay };
})();
