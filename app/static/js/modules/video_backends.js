/*
 * Video Backend selector (PATCH ModularVideoBackendArchitecture v1 §12).
 *
 * Fills every [data-video-backend-selector] <select> from the real backend
 * registry (GET /api/video-backends). Available backends are selectable; any
 * unavailable/future module is shown disabled and clearly marked — never as a
 * usable option. In this patch Wan 2.2 is the only available backend, so the
 * selector simply shows Wan. It is presentational: the actual backend id is
 * stored on the project/sequence and defaults to wan_22.
 */
(function () {
  "use strict";

  var CACHE = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fill(select, data) {
    if (!select || !data || !Array.isArray(data.backends)) return;
    var def = data.default || "wan_22";
    var html = "";
    data.backends.forEach(function (b) {
      var label = b.display_name || b.backend_id;
      var disabled = b.available ? "" : " disabled";
      if (!b.available) label += " — coming soon";
      var selected = (b.default || b.backend_id === def) && b.available ? " selected" : "";
      html += '<option value="' + esc(b.backend_id) + '"' + disabled + selected + ">" +
              esc(label) + "</option>";
    });
    select.innerHTML = html;
    // With a single available backend the choice is fixed — keep it readable but
    // non-editable so the UI never implies more options than really exist.
    var availableCount = data.backends.filter(function (b) { return b.available; }).length;
    select.disabled = availableCount <= 1;
  }

  function populate(data) {
    var selects = document.querySelectorAll("[data-video-backend-selector]");
    for (var i = 0; i < selects.length; i++) fill(selects[i], data);
  }

  function load() {
    var selects = document.querySelectorAll("[data-video-backend-selector]");
    if (!selects.length) return;
    if (CACHE) { populate(CACHE); return; }
    fetch("/api/video-backends")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        CACHE = data;
        populate(data);
      })
      .catch(function () { /* selector is non-critical — ignore fetch errors */ });
  }

  window.WVGVideoBackends = { load: load, populate: populate };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
