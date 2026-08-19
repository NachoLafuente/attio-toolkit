/**
 * Render a schema graph as a Mermaid ER diagram.
 *
 * Zero dependencies and zero bytes of vendored JavaScript: the output is text
 * that GitHub, Obsidian and Notion all render natively. This is the default
 * format for that reason.
 *
 * Relationship lines carry real meaning:
 *   --   solid, a true two-way Attio Relationship (reciprocal attribute exists)
 *   ..   dashed, a one-way record-reference (far side cardinality is unknown)
 */

const CARDINALITY = {
  // [far side, near side] -> mermaid left/right markers
  "1": { left: "||", right: "||" },
  N: { left: "}o", right: "o{" },
};

export function toMermaid(graph, opts = {}) {
  const { includeAttributes = true, maxAttributes = 12 } = opts;

  const lines = ["erDiagram"];
  const nameOf = new Map();
  for (const n of graph.nodes) nameOf.set(n.id, entityName(n));

  // Relationships first: they are what people came to see.
  for (const e of graph.edges) {
    const from = nameOf.get(e.from);
    const to = nameOf.get(e.to);
    if (!from || !to) continue;

    const left = e.fromMany === null ? "||" : CARDINALITY[e.fromMany ? "N" : "1"].left;
    const right = CARDINALITY[e.toMany ? "N" : "1"].right;
    const link = e.twoWay || e.kind === "list-parent" ? "--" : "..";
    const label = e.kind === "list-parent" ? "list of" : (e.viaSlug ?? "references");

    lines.push(`    ${from} ${left}${link}${right} ${to} : "${escapeLabel(label)}"`);
  }

  if (includeAttributes) {
    for (const n of graph.nodes) {
      if (n.kind !== "object" || !n.attributes?.length) continue;

      // Custom fields carry the signal. System fields are the same on every
      // workspace and would drown the diagram.
      const shown = n.attributes.filter((a) => !a.isSystem).slice(0, maxAttributes);
      if (!shown.length) continue;

      lines.push(`    ${nameOf.get(n.id)} {`);
      for (const a of shown) {
        const flags = [a.isRequired && "required", a.isUnique && "unique"].filter(Boolean);
        const comment = flags.length ? ` "${flags.join(", ")}"` : "";
        lines.push(`        ${safeType(a.type)} ${safeIdent(a.slug)}${comment}`);
      }
      const hidden = n.attributes.filter((a) => !a.isSystem).length - shown.length;
      if (hidden > 0) lines.push(`        more ${safeIdent(`and_${hidden}_more`)}`);
      lines.push("    }");
    }
  }

  return lines.join("\n") + "\n";
}

function entityName(node) {
  const base = safeIdent(node.slug || node.label || node.id);
  return node.kind === "list" ? `LIST_${base}` : base.toUpperCase();
}

/** Mermaid identifiers allow word characters only. */
function safeIdent(s) {
  const cleaned = String(s)
    .normalize("NFKD")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  // A leading digit is legal in Mermaid but reads badly next to a type token.
  return cleaned === "" ? "unnamed" : cleaned;
}

function safeType(t) {
  return safeIdent(t || "unknown");
}

function escapeLabel(s) {
  return String(s).replace(/"/g, "'");
}
