/**
 * Wrap the SVG in a self-contained HTML page.
 *
 * Self-contained is the whole point. The file makes no network requests of any
 * kind, so it opens offline, survives being emailed to a client, and never
 * sends a workspace's structure to a third-party CDN. Everything below is
 * inline: markup, styles, and about eighty lines of vanilla JavaScript for
 * pan, zoom, hover highlighting and search.
 */

import { toSvg, SVG_STYLE, esc } from "./svg.js";

export function toHtml(laid, opts = {}) {
  const {
    status = new Map(),
    stats = {},
    workspace = {},
    title = "Attio schema",
    subtitle = "",
    legend = null,
  } = opts;

  const svg = toSvg(laid, { status, standalone: false, title });

  const chips = [
    stats.objects != null && `${stats.objects} objects`,
    stats.lists ? `${stats.lists} lists` : null,
    stats.attributes != null && `${stats.attributes} fields`,
    stats.relationships != null && `${stats.relationships} relationships`,
    stats.oneWay ? `${stats.oneWay} one-way` : null,
    stats.orphans ? `${stats.orphans} unlinked` : null,
  ]
    .filter(Boolean)
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --ink:#101418; --muted:#6b7684; --line:#c9d1d9; --bg:#fbfcfd; --card:#ffffff;
        --ok:#1a7f37; --bad:#c0392b; --warn:#b7791f; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e7edf3; --muted:#8b97a6; --line:#31404f; --bg:#0d1117; --card:#161c24;
          --ok:#3fb950; --bad:#f85149; --warn:#d29922; }
}
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--ink);
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
header { position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; gap:12px;
  align-items:baseline; padding:14px 18px; border-bottom:1px solid var(--line); background:var(--bg); }
h1 { font-size:15px; margin:0; font-weight:650; letter-spacing:-0.01em; }
.sub { font-size:12px; color:var(--muted); }
.chips { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; }
.chip { font-size:11px; color:var(--muted); border:1px solid var(--line);
  border-radius:999px; padding:2px 9px; white-space:nowrap; }
#search { font:inherit; font-size:12px; padding:5px 10px; border-radius:7px;
  border:1px solid var(--line); background:var(--card); color:var(--ink); width:190px; }
#stage { width:100%; height:calc(100% - 53px); overflow:hidden; cursor:grab; }
#stage.grabbing { cursor:grabbing; }
#stage svg { display:block; }
${SVG_STYLE}
.node { cursor:default; }
.node, .edge { transition: opacity .12s ease; }
body.focusing .node, body.focusing .edge { opacity:.14; }
body.focusing .node.hot, body.focusing .edge.hot { opacity:1; }
.legend { display:flex; gap:14px; flex-wrap:wrap; font-size:11px; color:var(--muted);
  padding:8px 18px; border-top:1px solid var(--line); background:var(--bg); }
.legend b { font-weight:600; color:var(--ink); }
.swatch { display:inline-block; width:9px; height:9px; border-radius:2px; vertical-align:-1px; margin-right:4px; }
footer { position:fixed; bottom:0; left:0; right:0; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<span class="sub">${esc(subtitle)}</span>` : ""}
  ${workspace?.name ? `<span class="sub">${esc(workspace.name)}</span>` : ""}
  <input id="search" type="search" placeholder="Filter objects" aria-label="Filter objects">
  <div class="chips">${chips}</div>
</header>

<div id="stage">${svg}</div>

<footer>
<div class="legend">
  ${
    legend ||
    `<span><b>Solid</b> two-way relationship</span>
     <span><b>Dashed</b> one-way reference</span>
     <span><b>1 / N</b> records on that end</span>
     <span><b>?</b> unknown, one-way</span>
     <span><b>*</b> required</span>`
  }
</div>
</footer>

<script>
(function () {
  var stage = document.getElementById('stage');
  var svg = stage.querySelector('svg');
  var body = document.body;

  // ---- pan and zoom ------------------------------------------------------
  var vb = svg.getAttribute('viewBox').split(' ').map(Number);
  var view = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  var natural = { w: vb[2], h: vb[3] };

  function apply() {
    svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
  }
  function fit() {
    var pad = 1.04;
    var scale = Math.max(natural.w / stage.clientWidth, natural.h / stage.clientHeight) * pad;
    view.w = stage.clientWidth * scale;
    view.h = stage.clientHeight * scale;
    view.x = (natural.w - view.w) / 2;
    view.y = (natural.h - view.h) / 2;
    svg.setAttribute('width', stage.clientWidth);
    svg.setAttribute('height', stage.clientHeight);
    apply();
  }

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    var px = view.x + ((e.clientX - rect.left) / rect.width) * view.w;
    var py = view.y + ((e.clientY - rect.top) / rect.height) * view.h;
    var k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    var nw = Math.min(Math.max(view.w * k, natural.w * 0.08), natural.w * 6);
    var ratio = nw / view.w;
    view.w = nw;
    view.h = view.h * ratio;
    view.x = px - (px - view.x) * ratio;
    view.y = py - (py - view.y) * ratio;
    apply();
  }, { passive: false });

  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    stage.classList.add('grabbing');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var rect = stage.getBoundingClientRect();
    view.x = drag.vx - ((e.clientX - drag.x) / rect.width) * view.w;
    view.y = drag.vy - ((e.clientY - drag.y) / rect.height) * view.h;
    apply();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    stage.addEventListener(t, function () { drag = null; stage.classList.remove('grabbing'); });
  });

  // ---- hover highlighting ------------------------------------------------
  var nodes = Array.prototype.slice.call(svg.querySelectorAll('.node'));
  var edges = Array.prototype.slice.call(svg.querySelectorAll('.edge'));

  function clearHot() {
    body.classList.remove('focusing');
    nodes.concat(edges).forEach(function (el) { el.classList.remove('hot'); });
  }
  function focusNode(id) {
    clearHot();
    body.classList.add('focusing');
    var neighbours = { };
    neighbours[id] = true;
    edges.forEach(function (e) {
      var f = e.getAttribute('data-from'), t = e.getAttribute('data-to');
      if (f === id || t === id) { e.classList.add('hot'); neighbours[f] = true; neighbours[t] = true; }
    });
    nodes.forEach(function (n) {
      if (neighbours[n.getAttribute('data-id')]) n.classList.add('hot');
    });
  }

  nodes.forEach(function (n) {
    n.addEventListener('pointerenter', function () { focusNode(n.getAttribute('data-id')); });
    n.addEventListener('pointerleave', clearHot);
  });

  // ---- search ------------------------------------------------------------
  document.getElementById('search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    if (!q) { clearHot(); return; }
    clearHot();
    body.classList.add('focusing');
    var hit = {};
    nodes.forEach(function (n) {
      if ((n.getAttribute('data-label') || '').toLowerCase().indexOf(q) !== -1) {
        n.classList.add('hot');
        hit[n.getAttribute('data-id')] = true;
      }
    });
    edges.forEach(function (ed) {
      if (hit[ed.getAttribute('data-from')] && hit[ed.getAttribute('data-to')]) ed.classList.add('hot');
    });
  });

  window.addEventListener('resize', fit);
  fit();
})();
</script>
</body>
</html>
`;
}
