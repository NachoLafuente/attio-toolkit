/**
 * Turn a normalised schema model into a graph of nodes and edges.
 *
 * The interesting work is cardinality. Attio exposes two things that together
 * give a real ER diagram rather than a blob of dots:
 *
 *   1. `reference.targetObjectIds` — which objects an attribute may point at.
 *   2. `reference.reciprocal`      — populated only when Attio has generated a
 *      matching attribute on the other object, i.e. a true two-way
 *      Relationship. A plain one-way record-reference has `reciprocal: null`.
 *
 * With `isMultiselect` on both ends that yields 1:1, 1:N and N:M, and lets us
 * collapse the two halves of a two-way relationship into a single edge instead
 * of drawing it twice.
 */

/**
 * @param {object} model  Output of fetchSchema().
 * @param {object} [opts]
 * @param {boolean} [opts.includeLists]      Draw lists as nodes (default true).
 * @param {boolean} [opts.includeAttributes] Attach the attribute list to each
 *   node so renderers can show a detail panel (default true).
 */
export function buildGraph(model, opts = {}) {
  const { includeLists = true, includeAttributes = true } = opts;

  // Attio is inconsistent about how it names an object in a cross-reference:
  // `allowed_object_ids` holds UUIDs, but a list's `parent_object` holds
  // api_slugs. Resolve through one lookup that accepts either.
  const byId = new Map();
  for (const o of model.objects) {
    if (o.id) byId.set(o.id, o);
    if (o.slug) byId.set(o.slug, o);
  }

  const nodes = model.objects.map((o) => ({
    id: nodeId("object", o.id),
    kind: "object",
    slug: o.slug,
    label: o.plural || o.slug,
    isSystem: o.isSystem,
    attributeCount: o.attributes.length,
    referenceCount: o.attributes.filter((a) => a.reference).length,
    attributes: includeAttributes
      ? o.attributes.map((a) => ({
          slug: a.slug,
          title: a.title,
          type: a.type,
          isRequired: a.isRequired,
          isUnique: a.isUnique,
          isSystem: a.isSystem,
          isMultiselect: a.isMultiselect,
        }))
      : undefined,
  }));

  if (includeLists) {
    for (const l of model.lists) {
      nodes.push({
        id: nodeId("list", l.id),
        kind: "list",
        slug: l.slug,
        label: l.name || l.slug,
        isSystem: false,
        attributeCount: 0,
        referenceCount: 0,
        attributes: includeAttributes ? [] : undefined,
      });
    }
  }

  const knownNodes = new Set(nodes.map((n) => n.id));
  const edges = [];
  const seen = new Set();

  for (const obj of model.objects) {
    for (const attr of obj.attributes) {
      const ref = attr.reference;
      if (!ref) continue;

      // An empty allowed list means "any object" in the Attio API. Draw it to
      // every object rather than silently dropping the edge.
      const targets = ref.anyObject
        ? model.objects.map((o) => o.id).filter((id) => id !== obj.id)
        : ref.targetObjectIds;

      for (const targetRef of targets) {
        const target = byId.get(targetRef);
        if (!target) continue; // reference to something we cannot see
        const targetId = target.id;

        const from = nodeId("object", obj.id);
        const to = nodeId("object", targetId);
        if (!knownNodes.has(from) || !knownNodes.has(to)) continue;

        // Collapse the two halves of a two-way relationship into one edge.
        // Both halves share the same unordered pair of attribute ids.
        const key = ref.reciprocal
          ? ["rel", ...[attr.id, ref.reciprocal.attributeId].sort()].join("|")
          : ["ref", obj.id, attr.id, targetId].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        edges.push({
          id: key,
          from,
          to,
          // How many `to` records a single `from` record can hold.
          toMany: attr.isMultiselect,
          // How many `from` records a single `to` record can hold. Only knowable
          // when a reciprocal attribute exists.
          fromMany: ref.reciprocal ? ref.reciprocal.isMultiselect : null,
          twoWay: Boolean(ref.reciprocal),
          anyObject: Boolean(ref.anyObject),
          viaSlug: attr.slug,
          viaTitle: attr.title,
          reciprocalSlug: ref.reciprocal?.slug ?? null,
          cardinality: cardinality(attr.isMultiselect, ref.reciprocal),
        });
      }
    }
  }

  // Lists hang off their parent objects. Not a data relationship, so it is a
  // separate edge kind that renderers draw dashed.
  if (includeLists) {
    for (const l of model.lists) {
      for (const parentRef of l.parentObjectIds) {
        const parent = byId.get(parentRef);
        if (!parent) continue;
        edges.push({
          id: ["list", l.id, parent.id].join("|"),
          from: nodeId("list", l.id),
          to: nodeId("object", parent.id),
          kind: "list-parent",
          toMany: true,
          fromMany: null,
          twoWay: false,
          anyObject: false,
          viaSlug: null,
          viaTitle: null,
          reciprocalSlug: null,
          cardinality: "N:1",
        });
      }
    }
  }

  edges.sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges, workspace: model.workspace, anonymized: model.anonymized };
}

/**
 * Cardinality as `from:to`.
 *
 * A one-way reference tells us nothing about the far side, so it degrades to
 * `?` rather than guessing 1.
 */
function cardinality(sourceMulti, reciprocal) {
  const to = sourceMulti ? "N" : "1";
  if (!reciprocal) return `?:${to}`;
  const from = reciprocal.isMultiselect ? "N" : "1";
  return `${from}:${to}`;
}

function nodeId(kind, id) {
  return `${kind}:${id}`;
}

/** Small summary used by the CLI and by the HTML header. */
export function graphStats(graph) {
  const objects = graph.nodes.filter((n) => n.kind === "object").length;
  const lists = graph.nodes.filter((n) => n.kind === "list").length;
  const relEdges = graph.edges.filter((e) => e.kind !== "list-parent");
  return {
    objects,
    lists,
    relationships: relEdges.length,
    twoWay: relEdges.filter((e) => e.twoWay).length,
    oneWay: relEdges.filter((e) => !e.twoWay).length,
    attributes: graph.nodes.reduce((n, x) => n + x.attributeCount, 0),
    orphans: graph.nodes.filter(
      (n) =>
        n.kind === "object" &&
        !graph.edges.some((e) => e.from === n.id || e.to === n.id),
    ).length,
  };
}
