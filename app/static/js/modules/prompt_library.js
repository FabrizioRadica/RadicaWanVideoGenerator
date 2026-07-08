/* Project-local Prompt Library UI controller (PATCH_ProjectPromptLibrary).
   Radica - WanVideoGenerator — Concept & Design: Fabrizio Radica — Project by RadicaDesign

   Reuses the existing Single Clip prompt fields (#f-positive/#f-negative) and the
   existing SequenceQueue endpoints. It never renders, never touches the render
   pipeline, and never reloads the page — SequenceQueue refresh reuses the
   existing wvg:ai-sequence-populated event. */

window.WVGPromptLibrary = (function () {
  "use strict";

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var TYPE_LABEL = {
    single_clip_prompt: "Single Clip", sequence_preset: "Sequence Preset",
    shared_negative_prompt: "Shared Negative",
  };

  var S = { filter: "all", context: "manage", sequenceId: null, selected: null,
            editing: false, items: [], saveCtx: null };

  /* ---------------- open / close ---------------- */
  function open(context, opts) {
    opts = opts || {};
    S.context = context || "manage";
    S.sequenceId = opts.sequenceId || null;
    S.selected = null; S.editing = false;
    var hint = el("pl-context-hint");
    if (hint) hint.textContent = S.context === "single_clip" ? "→ applies to the Single Clip prompt fields"
      : (S.context === "sequence" ? "→ applies to the current SequenceQueue" : "");
    el("pl-detail").innerHTML = "<p class='muted small' style='padding:12px;'>Select a prompt to preview and use.</p>";
    WVG.openModal("prompt-library-backdrop");
    refresh();
  }
  function close() { WVG.closeModal("prompt-library-backdrop"); }

  /* ---------------- list ---------------- */
  async function refresh() {
    var q = (el("pl-search") && el("pl-search").value) || "";
    el("pl-empty-trash").style.display = S.filter === "trash" ? "" : "none";
    try {
      var data = await WVG.api("/api/prompt-library?type=" + encodeURIComponent(S.filter) +
                               "&q=" + encodeURIComponent(q));
      S.items = data.items || [];
      renderList();
    } catch (e) { WVG.toast("Could not load prompt library", "error", e.message); }
  }

  function renderList() {
    var box = el("pl-list");
    if (!S.items.length) { box.innerHTML = "<p class='muted small' style='padding:12px;'>No prompts here yet.</p>"; return; }
    box.innerHTML = S.items.map(function (it) {
      var tags = (it.tags || []).slice(0, 4).map(function (t) { return "<span class='pl-tag'>" + esc(t) + "</span>"; }).join("");
      return "<div class='pl-item" + (S.selected === it.id ? " active" : "") + "' data-id='" + esc(it.id) + "'>" +
        "<div class='pl-item-top'><span class='pl-item-name'>" + esc(it.name) + "</span>" +
        "<span class='badge badge-soft'>" + esc(TYPE_LABEL[it.type] || it.type) + "</span></div>" +
        "<div class='small muted pl-item-preview'>" + esc((it.preview || "").slice(0, 90)) + "</div>" +
        (tags ? "<div class='pl-tags'>" + tags + "</div>" : "") +
        (it.source && it.source !== "manual" ? "<span class='pl-src'>" + esc(it.source) + "</span>" : "") +
        "</div>";
    }).join("");
    box.querySelectorAll(".pl-item").forEach(function (n) {
      n.addEventListener("click", function () { select(n.dataset.id); });
    });
  }

  /* ---------------- detail ---------------- */
  async function select(id) {
    S.selected = id; S.editing = false;
    renderList();
    try {
      var data = await WVG.api("/api/prompt-library/" + id);
      renderDetail(data.item);
    } catch (e) { WVG.toast("Could not load prompt", "error", e.message); }
  }

  function renderDetail(item) {
    var d = el("pl-detail");
    var inTrash = S.filter === "trash";
    var body = "";
    body += "<div class='pl-detail-head'><h3 style='margin:0;'>" + esc(item.name) + "</h3>" +
      "<span class='badge badge-soft'>" + esc(TYPE_LABEL[item.type] || item.type) + "</span></div>";

    if (item.type === "sequence_preset") {
      body += "<div class='small muted'>" + (item.clips || []).length + " clips" +
        (item.shared_negative_prompt ? " · shared negative set" : "") + "</div>";
      body += "<ol class='pl-clip-list'>" + (item.clips || []).map(function (c) {
        return "<li><strong>" + esc(c.clip_name) + "</strong> <span class='badge badge-soft'>" +
          (c.clip_type === "image_reference" ? "I2V" : "T2V") + "</span> <span class='muted small'>" +
          esc(c.duration) + "s</span><div class='small muted'>" + esc((c.positive_prompt || "").slice(0, 120)) + "</div></li>";
      }).join("") + "</ol>";
    } else if (item.type === "shared_negative_prompt") {
      body += pre("Negative prompt", item.negative_prompt);
    } else {
      body += "<div class='small muted'>Mode: " + esc(item.mode || "text2video") +
        (item.model_hint ? " · " + esc(item.model_hint) : "") + "</div>";
      body += pre("Positive prompt", item.positive_prompt);
      body += pre("Negative prompt", item.negative_prompt);
    }
    if ((item.tags || []).length) body += "<div class='pl-tags'>" + item.tags.map(function (t) { return "<span class='pl-tag'>" + esc(t) + "</span>"; }).join("") + "</div>";
    if (item.notes) body += "<div class='small muted'>Notes: " + esc(item.notes) + "</div>";

    // Action bar
    body += "<div class='pl-actions'>";
    if (inTrash) {
      body += btn("pl-a-restore", "♻ Restore") + btn("pl-a-perm", "🗑 Delete permanently", "btn-danger");
    } else {
      body += contextActions(item);
      body += btn("pl-a-edit", "✎ Edit") + btn("pl-a-dup", "⧉ Duplicate") +
              btn("pl-a-rename", "Rename") + btn("pl-a-export", "⬇ Export") +
              btn("pl-a-del", "🗑 Delete", "btn-danger");
    }
    body += "</div>";
    d.innerHTML = body;
    wireDetail(item, inTrash);
  }

  function pre(label, text) {
    return "<div class='pl-field'><div class='pl-field-label'>" + esc(label) + "</div>" +
      "<div class='pl-pre'>" + esc(text || "(empty)") + "</div></div>";
  }
  function btn(id, label, cls) { return "<button class='btn btn-sm " + (cls || "") + "' id='" + id + "' type='button'>" + label + "</button>"; }

  function contextActions(item) {
    var out = "";
    if (S.context === "single_clip" && (item.type === "single_clip_prompt" || item.type === "shared_negative_prompt")) {
      if (item.type === "single_clip_prompt") {
        out += btn("pl-apply-both", "Apply both", "btn-primary") + btn("pl-apply-pos", "Positive only") +
               btn("pl-apply-neg", "Negative only") + btn("pl-apply-append", "Append to current");
      } else {
        out += btn("pl-apply-neg", "Apply negative", "btn-primary");
      }
    }
    if (S.context === "sequence" && S.sequenceId) {
      if (item.type === "sequence_preset") {
        out += btn("pl-seq-append", "＋ Append to queue", "btn-primary") + btn("pl-seq-replace", "Replace queue", "btn-danger");
      } else if (item.type === "shared_negative_prompt") {
        out += btn("pl-seq-neg-all", "Apply to all clips", "btn-primary");
      } else if (item.type === "single_clip_prompt") {
        out += btn("pl-seq-add-clip", "＋ Add as new clip", "btn-primary");
      }
    }
    return out;
  }

  function wireDetail(item, inTrash) {
    function on(id, fn) { var n = el(id); if (n) n.addEventListener("click", fn); }
    on("pl-a-restore", function () { doRestore(item.id); });
    on("pl-a-perm", function () { doPermDelete(item.id); });
    on("pl-a-edit", function () { openEdit(item); });
    on("pl-a-dup", function () { doDuplicate(item.id); });
    on("pl-a-rename", function () { doRename(item); });
    on("pl-a-export", function () { window.open("/api/prompt-library/" + item.id + "/export", "_blank"); });
    on("pl-a-del", function () { doDelete(item.id); });
    // context apply
    on("pl-apply-both", function () { applyToFields(item, "both"); });
    on("pl-apply-pos", function () { applyToFields(item, "positive"); });
    on("pl-apply-neg", function () { applyToFields(item, item.type === "shared_negative_prompt" ? "negative" : "negative"); });
    on("pl-apply-append", function () { applyToFields(item, "append"); });
    on("pl-seq-append", function () { applyPreset(item.id, "append"); });
    on("pl-seq-replace", function () { applyPreset(item.id, "replace"); });
    on("pl-seq-neg-all", function () { applyNegativeAll(item.id); });
    on("pl-seq-add-clip", function () { addAsClip(item); });
  }

  /* ---------------- manage actions ---------------- */
  async function doDuplicate(id) { try { await WVG.api("/api/prompt-library/" + id + "/duplicate", { method: "POST" }); WVG.toast("Duplicated", "success"); refresh(); } catch (e) { WVG.toast("Duplicate failed", "error", e.message); } }
  async function doDelete(id) { try { await WVG.api("/api/prompt-library/" + id, { method: "DELETE" }); WVG.toast("Moved to trash", "success"); S.selected = null; el("pl-detail").innerHTML = ""; refresh(); } catch (e) { WVG.toast("Delete failed", "error", e.message); } }
  async function doRestore(id) { try { await WVG.api("/api/prompt-library/" + id + "/restore", { method: "POST" }); WVG.toast("Restored", "success"); refresh(); } catch (e) { WVG.toast("Restore failed", "error", e.message); } }
  async function doPermDelete(id) {
    if (!window.confirm("Permanently delete this prompt? This cannot be undone.")) return;
    try { await WVG.api("/api/prompt-library/" + id + "/permanent", { method: "DELETE" }); WVG.toast("Deleted permanently", "success"); S.selected = null; el("pl-detail").innerHTML = ""; refresh(); } catch (e) { WVG.toast("Delete failed", "error", e.message); }
  }
  async function doRename(item) {
    var name = window.prompt("New name:", item.name);
    if (name == null || !name.trim()) return;
    try { await WVG.api("/api/prompt-library/" + item.id + "/rename", { method: "POST", body: { name: name.trim() } }); WVG.toast("Renamed", "success"); refresh(); select(item.id); } catch (e) { WVG.toast("Rename failed", "error", e.message); }
  }

  /* ---------------- edit ---------------- */
  function openEdit(item) {
    var d = el("pl-detail");
    var isNeg = item.type === "shared_negative_prompt";
    var isPreset = item.type === "sequence_preset";
    var html = "<div class='pl-detail-head'><h3 style='margin:0;'>Edit</h3></div>";
    html += field("pl-e-name", "Name", item.name, false);
    if (isPreset) {
      html += field("pl-e-neg", "Shared negative prompt", item.shared_negative_prompt, true);
      html += "<div class='small muted'>Editing individual clips: load the preset into a sequence, edit there, then re-save.</div>";
    } else if (isNeg) {
      html += field("pl-e-neg", "Negative prompt", item.negative_prompt, true);
    } else {
      html += field("pl-e-pos", "Positive prompt", item.positive_prompt, true);
      html += field("pl-e-neg", "Negative prompt", item.negative_prompt, true);
    }
    html += field("pl-e-tags", "Tags (comma separated)", (item.tags || []).join(", "), false);
    html += field("pl-e-notes", "Notes", item.notes, true);
    html += "<div class='pl-actions'><button class='btn btn-sm btn-primary' id='pl-e-save' type='button'>Save changes</button>" +
            "<button class='btn btn-sm' id='pl-e-cancel' type='button'>Cancel</button></div>";
    d.innerHTML = html;
    el("pl-e-cancel").addEventListener("click", function () { select(item.id); });
    el("pl-e-save").addEventListener("click", async function () {
      var changes = { name: el("pl-e-name").value.trim(),
        tags: el("pl-e-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
        notes: el("pl-e-notes").value };
      if (isPreset) changes.shared_negative_prompt = el("pl-e-neg").value;
      else if (isNeg) changes.negative_prompt = el("pl-e-neg").value;
      else { changes.positive_prompt = el("pl-e-pos").value; changes.negative_prompt = el("pl-e-neg").value; }
      try { await WVG.api("/api/prompt-library/" + item.id, { method: "PUT", body: changes }); WVG.toast("Saved", "success"); refresh(); select(item.id); }
      catch (e) { WVG.toast("Save failed", "error", e.message); }
    });
  }
  function field(id, label, val, multiline) {
    var input = multiline ? "<textarea id='" + id + "' rows='3'>" + esc(val || "") + "</textarea>"
      : "<input type='text' id='" + id + "' value='" + esc(val || "") + "'>";
    return "<div class='field'><label class='field-label'>" + esc(label) + "</label>" + input + "</div>";
  }

  /* ---------------- Single Clip apply (reuse existing fields) ---------------- */
  function fields() { return { pos: el("f-positive"), neg: el("f-negative") }; }
  function setField(field, value) {
    if (field == null || value == null) return;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function applyToFields(item, scope) {
    var f = fields();
    if (!f.pos || !f.neg) { WVG.toast("Open a project in Single Clip first.", "warning"); return; }
    var pos = item.positive_prompt || "";
    var neg = item.type === "shared_negative_prompt" ? item.negative_prompt : (item.negative_prompt || "");
    var overwrite = (f.pos.value.trim() || f.neg.value.trim());
    if (scope !== "append" && overwrite && !window.confirm("Overwrite the current Single Clip prompt(s)?")) return;
    if (scope === "both") { setField(f.pos, pos); setField(f.neg, neg); }
    else if (scope === "positive") setField(f.pos, pos);
    else if (scope === "negative") setField(f.neg, neg);
    else if (scope === "append") {
      if (pos) setField(f.pos, (f.pos.value.trim() ? f.pos.value.trim() + ", " : "") + pos);
      if (neg) setField(f.neg, (f.neg.value.trim() ? f.neg.value.trim() + ", " : "") + neg);
    }
    if (window.WVG && WVG.updateComposedPrompt) WVG.updateComposedPrompt();
    WVG.toast("Applied to Single Clip (remember to Save the project)", "success");
    close();
  }

  /* ---------------- Sequence apply (reuse existing endpoints) ---------------- */
  function afterSequenceChange(sid, msg) {
    WVG.toast(msg, "success");
    document.dispatchEvent(new CustomEvent("wvg:ai-sequence-populated", { detail: { sequence_id: sid } }));
    close();
  }
  async function applyPreset(id, mode) {
    if (mode === "replace" && !window.confirm("Replace ALL clips in the current SequenceQueue?")) return;
    try {
      var r = await WVG.api("/api/prompt-library/" + id + "/apply-to-sequence/" + S.sequenceId, { method: "POST", body: { mode: mode } });
      afterSequenceChange(S.sequenceId, "Added " + r.added + " clip(s) to the queue");
    } catch (e) { WVG.toast("Could not apply preset", "error", e.message); }
  }
  async function applyNegativeAll(id) {
    if (!window.confirm("Apply this negative prompt to ALL clips in the current sequence?")) return;
    try {
      var r = await WVG.api("/api/prompt-library/" + id + "/apply-negative-to-sequence/" + S.sequenceId, { method: "POST" });
      afterSequenceChange(S.sequenceId, "Applied negative to " + r.updated_clips + " clip(s)");
    } catch (e) { WVG.toast("Could not apply negative", "error", e.message); }
  }
  async function addAsClip(item) {
    try {
      await WVG.api("/api/sequences/" + S.sequenceId + "/clips", { method: "POST",
        body: { type: item.mode === "image2video" ? "image_reference" : "prompt_only",
                name: item.name, prompt: item.positive_prompt, negative_prompt: item.negative_prompt } });
      afterSequenceChange(S.sequenceId, "Added '" + item.name + "' as a new clip");
    } catch (e) { WVG.toast("Could not add clip", "error", e.message); }
  }

  /* ---------------- Save flows ---------------- */
  function openSave(ctx) {
    S.saveCtx = ctx;
    el("pl-save-title").textContent = ctx.title || "Save to Prompt Library";
    el("pl-save-name").value = ctx.name || "";
    el("pl-save-tags").value = "";
    el("pl-save-scope-field").style.display = ctx.scope === false ? "none" : "";
    el("pl-save-preview").textContent = ctx.preview || "";
    WVG.openModal("pl-save-backdrop");
    setTimeout(function () { el("pl-save-name").focus(); }, 50);
  }
  function closeSave() { WVG.closeModal("pl-save-backdrop"); }

  function currentSingleMode() {
    var active = document.querySelector("#mode-tabs .mode-tab.active");
    return (active && active.dataset.mode) || "text2video";
  }
  function saveSingleClip() {
    var f = fields();
    if (!f.pos || !f.neg) { WVG.toast("Open a project in Single Clip first.", "warning"); return; }
    if (!f.pos.value.trim() && !f.neg.value.trim()) { WVG.toast("Nothing to save — the prompt fields are empty.", "warning"); return; }
    openSave({ kind: "single_clip", scope: true, mode: currentSingleMode(),
      preview: (f.pos.value || "").slice(0, 120) });
  }
  function savePreset(sequenceId) {
    if (!sequenceId) { WVG.toast("Open or select a sequence first.", "warning"); return; }
    openSave({ kind: "preset", scope: false, sequenceId: sequenceId, title: "Save queue as Sequence Preset" });
  }
  // AI Assistant hooks (save without changing generation)
  function saveAISingleClip(result) {
    openSave({ kind: "ai_single", scope: true, title: "Save AI prompt to Library",
      positive: result.positive_prompt || "", negative: result.negative_prompt || "",
      preview: (result.positive_prompt || "").slice(0, 120) });
  }
  function saveAIPlan(plan) {
    openSave({ kind: "ai_plan", scope: false, title: "Save AI sequence as Preset",
      name: plan.sequence_title || "", plan: plan });
  }

  async function confirmSave() {
    var ctx = S.saveCtx || {};
    var name = el("pl-save-name").value.trim();
    if (!name) { WVG.toast("Enter a name.", "warning"); return; }
    var tags = el("pl-save-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    var scope = el("pl-save-scope").value;
    var btnN = el("pl-save-confirm"); btnN.disabled = true;
    try {
      if (ctx.kind === "preset") {
        await WVG.api("/api/prompt-library/from-sequence/" + ctx.sequenceId, { method: "POST", body: { name: name } });
      } else if (ctx.kind === "ai_plan") {
        await WVG.api("/api/prompt-library", { method: "POST", body: planToPreset(ctx.plan, name, tags) });
      } else {
        var f = ctx.kind === "single_clip" ? fields() : null;
        var pos = ctx.kind === "single_clip" ? (f.pos.value || "") : (ctx.positive || "");
        var neg = ctx.kind === "single_clip" ? (f.neg.value || "") : (ctx.negative || "");
        var payload = { type: "single_clip_prompt", name: name, tags: tags, mode: ctx.mode || "text2video",
          positive_prompt: scope === "negative" ? "" : pos,
          negative_prompt: scope === "positive" ? "" : neg };
        await WVG.api("/api/prompt-library", { method: "POST", body: payload });
      }
      WVG.toast("Saved to Prompt Library", "success");
      closeSave();
    } catch (e) { WVG.toast("Save failed", "error", e.message); }
    finally { btnN.disabled = false; }
  }

  function planToPreset(plan, name, tags) {
    return { type: "sequence_preset", name: name, tags: tags,
      shared_negative_prompt: plan.global_negative_prompt || "",
      clips: (plan.clips || []).map(function (c, i) {
        return { index: i, clip_name: c.clip_name || ("Clip " + (i + 1)),
          clip_type: c.clip_type === "Image2Video" ? "image_reference" : "prompt_only",
          duration: c.duration_seconds || 4, positive_prompt: c.positive_prompt || "",
          negative_prompt: c.negative_prompt || "", continuity_notes: c.continuity_notes || "" };
      }) };
  }

  /* ---------------- init ---------------- */
  function bind() {
    if (!el("prompt-library-backdrop")) return;
    document.querySelectorAll("#pl-filter-tabs .mode-tab").forEach(function (t) {
      t.addEventListener("click", function () {
        S.filter = t.dataset.plFilter;
        document.querySelectorAll("#pl-filter-tabs .mode-tab").forEach(function (x) { x.classList.toggle("active", x === t); });
        refresh();
      });
    });
    var search = el("pl-search"); var deb;
    if (search) search.addEventListener("input", function () { clearTimeout(deb); deb = setTimeout(refresh, 220); });
    el("pl-import").addEventListener("click", function () { el("pl-import-file").click(); });
    el("pl-import-file").addEventListener("change", async function () {
      var file = this.files[0]; if (!file) return;
      var fd = new FormData(); fd.append("file", file);
      try { await WVG.api("/api/prompt-library/import", { method: "POST", body: fd }); WVG.toast("Imported", "success"); refresh(); }
      catch (e) { WVG.toast("Import failed", "error", e.message); }
      this.value = "";
    });
    el("pl-rebuild").addEventListener("click", async function () { try { await WVG.api("/api/prompt-library/rebuild-index", { method: "POST" }); WVG.toast("Index rebuilt", "success"); refresh(); } catch (e) { WVG.toast("Rebuild failed", "error", e.message); } });
    el("pl-empty-trash").addEventListener("click", async function () {
      if (!window.confirm("Permanently delete ALL items in trash?")) return;
      try { await WVG.api("/api/prompt-library/trash/empty", { method: "POST" }); WVG.toast("Trash emptied", "success"); refresh(); } catch (e) { WVG.toast("Empty trash failed", "error", e.message); }
    });
    el("pl-save-confirm").addEventListener("click", confirmSave);

    // Entry buttons (present on the editor page)
    hook("pl-open-single", function () { open("single_clip"); });
    hook("pl-save-single", saveSingleClip);
    hook("pl-open-sequence", function () { open("sequence", { sequenceId: seqId() }); });
    hook("pl-save-preset", function () { savePreset(seqId()); });
  }
  function hook(id, fn) { var n = el(id); if (n) n.addEventListener("click", fn); }
  function seqId() { return (window.WVGSequence && WVGSequence.currentId && WVGSequence.currentId()) || null; }

  document.addEventListener("DOMContentLoaded", bind);

  return { open: open, close: close, closeSave: closeSave,
           saveSingleClip: saveSingleClip, savePreset: savePreset,
           saveAISingleClip: saveAISingleClip, saveAIPlan: saveAIPlan };
})();
