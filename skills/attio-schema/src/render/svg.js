/**
 * Render a laid-out graph as SVG.
 *
 * Cardinality is drawn Chen-style, as a small badge at each end of the line
 * ("1", "N", or "?" when a one-way reference makes the far side unknowable),
 * rather than as crow's feet. Badges stay legible at any zoom and do not
 * depend on getting marker rotation right.
 *
 * Colours come from CSS custom properties so the same markup works on a light
 * page, a dark page, and in print. The SVG carries its own <style>, so it also
 * works standalone when saved as a .svg file.
 */

const STATUS_COLOURS = {
  added: "var(--ok)",
  removed: "var(--bad)",
  changed: "var(--warn)",
};

export function toSvg(laid, opts = {}) {
  const { status = new Map(), standalone = true, title = "Attio schema" } = opts;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${laid.width} ${laid.height}" ` +
      `width="${laid.width}" height="${laid.height}" role="img" aria-label="${esc(title)}" ` +
      `font-family="ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">`,
  );
  if (standalone) parts.push(`<style>${SVG_STYLE}</style>`);

  // Edges first so cards sit on top of the lines.
  parts.push('<g class="edges">');
  for (const e of laid.edges) parts.push(edge(e));
  parts.push("</g>");

  parts.push('<g class="nodes">');
  for (const n of laid.nodes) parts.push(card(n, status.get(n.id)));
  parts.push("</g>");

  parts.push("</svg>");
  return parts.join("\n");
}

function edge(e) {
  const dashed = !e.twoWay && e.kind !== "list-parent";
  const [fromMark, toMark] = e.cardinality.split(":");

  const a = badgeAt(e.path.start, e.path.control, fromMark);
  const b = badgeAt(e.path.end, e.path.control, toMark);

  return `<g class="edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}">
  <path d="${e.path.d}" fill="none" class="edge-line${dashed ? " is-dashed" : ""}"/>
  ${a}${b}
</g>`;
}

/** Nudge the badge a little way along the curve so it clears the card border. */
function badgeAt(point, control, label) {
  const dx = control.x - point.x;
  const dy = control.y - point.y;
  const len = Math.hypot(dx, dy) || 1;
  const x = Math.round(point.x + (dx / len) * 14);
  const y = Math.round(point.y + (dy / len) * 14);
  return `<g class="card-badge"><circle cx="${x}" cy="${y}" r="8"/><text x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(label)}</text></g>`;
}

function card(n, statusKey) {
  const x = Math.round(n.x - n.width / 2);
  const y = Math.round(n.y - n.height / 2);
  const accent = statusKey ? STATUS_COLOURS[statusKey] : null;
  const isList = n.kind === "list";

  const rows = n.rows
    .map((r, i) => {
      const ry = y + 34 + i * 19 + 13;
      if (r.more) {
        return `<text class="row-more" x="${x + 12}" y="${ry}">${esc(r.slug)}</text>`;
      }
      const flags = [r.isRequired ? "*" : "", r.isUnique ? "·u" : ""].join("");
      return `<text class="row-name" x="${x + 12}" y="${ry}">${esc(truncate(r.slug, 20))}${esc(flags)}</text>
<text class="row-type" x="${x + n.width - 12}" y="${ry}" text-anchor="end">${esc(shortType(r.type))}</text>`;
    })
    .join("\n");

  return `<g class="node${isList ? " is-list" : ""}${statusKey ? ` is-${statusKey}` : ""}" data-id="${esc(n.id)}" data-label="${esc(n.label)}">
  <rect class="card" x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="10"${accent ? ` stroke="${accent}"` : ""}/>
  <path class="card-head" d="${headPath(x, y, n.width)}"${accent ? ` fill="${accent}" fill-opacity="0.16"` : ""}/>
  <text class="card-title" x="${x + 12}" y="${y + 22}">${esc(truncate(n.label, 22))}</text>
  <text class="card-meta" x="${x + n.width - 12}" y="${y + 22}" text-anchor="end">${isList ? "list" : `${n.attributeCount}f`}</text>
  ${rows}
</g>`;
}

/** Rounded only on the top two corners, so the header sits flush in the card. */
function headPath(x, y, w, h = 34, r = 10) {
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

/** Attio type names are long. Shorten them without becoming cryptic. */
function shortType(t) {
  if (!t) return "";
  return (
    {
      "record-reference": "ref",
      "actor-reference": "actor",
      "personal-name": "name",
      "email-address": "email",
      "phone-number": "phone",
      timestamp: "date",
      checkbox: "bool",
      currency: "money",
      "interaction": "activity",
    }[t] || t
  );
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const SVG_STYLE = `
svg { --ink:#101418; --muted:#6b7684; --line:#c9d1d9; --card:#ffffff; --edge:#98a4b3;
      --head:#f2f5f8; --ok:#1a7f37; --bad:#c0392b; --warn:#b7791f; }
@media (prefers-color-scheme: dark) {
  svg { --ink:#e7edf3; --muted:#8b97a6; --line:#31404f; --card:#161c24; --edge:#5a6b7d;
        --head:#1e2731; --ok:#3fb950; --bad:#f85149; --warn:#d29922; }
}
.card { fill: var(--card); stroke: var(--line); stroke-width: 1.25; }
.card-head { fill: var(--head); }
.card-title { font-size: 13px; font-weight: 650; fill: var(--ink); }
.card-meta { font-size: 10.5px; fill: var(--muted); }
.row-name { font-size: 11.5px; fill: var(--ink); }
.row-type { font-size: 10.5px; fill: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-more { font-size: 10.5px; fill: var(--muted); font-style: italic; }
.edge-line { stroke: var(--edge); stroke-width: 1.4; }
.edge-line.is-dashed { stroke-dasharray: 5 4; }
.card-badge circle { fill: var(--card); stroke: var(--edge); stroke-width: 1.2; }
.card-badge text { font-size: 9.5px; fill: var(--muted); font-weight: 600; }
.node.is-list .card { stroke-dasharray: 5 4; }
`;
