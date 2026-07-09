/* SequenceFrameContinuityModule v1 (PATCH_SequenceFrameContinuityModule_v1).

   Renders the continuity-frame state of SequenceQueue clip cards, opens the
   Frame Tools modal and calls the create-clip-from-frame endpoint. It only
   ever shows REAL saved frames served by the safe continuity media route —
   never placeholders — and never starts rendering. It does not duplicate
   SequenceQueue state: the caller (sequence.js) owns the sequence object and
   refreshes it through its existing flow after a new clip is created. */

window.WVGFrameContinuity = (function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function basename(p) { return String(p || "").split(/[\\/]/).pop(); }

  function available(clip) {
    return !!(clip && clip.continuity_frame && clip.continuity_frame.available &&
              clip.continuity_frame.path);
  }

  function frameUrl(sequenceId, clip, download) {
    if (!available(clip)) return null;
    return "/media/sequences/" + encodeURIComponent(sequenceId) + "/continuity/" +
      encodeURIComponent(basename(clip.continuity_frame.path)) + (download ? "?download=1" : "");
  }

  /* Small last-frame thumbnail for the clip card (only when previews are
     enabled AND a real frame exists — §6.1/§10.2). */
  function thumbHTML(sequenceId, clip, showPreview) {
    if (!showPreview || !available(clip)) return "";
    return "<img src='" + frameUrl(sequenceId, clip) + "' class='seq-clip-thumb seq-frame-thumb'" +
      " title='Last frame (saved)' alt='Last frame of " + esc(clip.name) + "'>";
  }

  /* Compact status line — hidden entirely when no frame exists (§10.1). */
  function statusHTML(clip) {
    if (!available(clip)) return "";
    return "<span class='badge badge-soft' title='" + esc(clip.continuity_frame.path) + "'>Last frame: available</span>";
  }

  /* "Frame" card action — rendered only for clips with a real saved frame. */
  function frameButtonHTML(clip) {
    if (!available(clip)) return "";
    return "<button class='btn btn-xs' data-act='frame' data-clip='" + esc(clip.clip_id) + "'>Frame</button>";
  }

  /* Frame Tools modal (§10.3). opts.onCreated(newClip) is called after a new
     Image Reference clip is created so the queue UI can refresh itself. */
  function openTools(sequenceId, clip, opts) {
    opts = opts || {};
    if (!available(clip)) {
      if (window.WVG && WVG.toast) WVG.toast("This clip has no saved last frame yet.", "error");
      return;
    }
    var img = document.getElementById("frame-tools-image");
    var title = document.getElementById("frame-tools-title");
    var source = document.getElementById("frame-tools-source");
    var dl = document.getElementById("frame-tools-download");
    var create = document.getElementById("frame-tools-create");
    if (!img || !create) return;
    if (title) title.textContent = "Frame Tools — " + (clip.name || "Clip");
    img.src = frameUrl(sequenceId, clip);
    if (source) source.textContent = clip.continuity_frame.source_output
      ? "Extracted from: " + clip.continuity_frame.source_output : "";
    if (dl) { dl.href = frameUrl(sequenceId, clip, true); }

    // Re-bind the create button for THIS clip (replace old listeners).
    var fresh = create.cloneNode(true);
    create.parentNode.replaceChild(fresh, create);
    fresh.addEventListener("click", async function () {
      fresh.disabled = true;
      try {
        var newClip = await WVG.api("/api/sequences/" + encodeURIComponent(sequenceId) +
          "/clips/" + encodeURIComponent(clip.clip_id) + "/continuity/create-clip-from-frame",
          { method: "POST" });
        WVG.closeModal("frame-tools-backdrop");
        WVG.toast("New Image Reference clip created from the saved frame — it will not render automatically.", "success");
        if (typeof opts.onCreated === "function") opts.onCreated(newClip);
      } catch (e) {
        WVG.toast("Could not create clip from frame", "error", e.message);
      } finally {
        fresh.disabled = false;
      }
    });
    WVG.openModal("frame-tools-backdrop");
  }

  return {
    available: available,
    frameUrl: frameUrl,
    thumbHTML: thumbHTML,
    statusHTML: statusHTML,
    frameButtonHTML: frameButtonHTML,
    openTools: openTools,
  };
})();
