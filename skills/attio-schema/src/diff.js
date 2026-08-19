/**
 * Diff two schema models.
 *
 * Entities are matched on their Attio UUID, not on slug, so a rename shows up
 * as `renamed` rather than as a delete plus an add. That distinction is the
 * whole point: "someone renamed deal_stage" and "someone deleted deal_stage and
 * created a new field" are very different incidents.
 */

/** Attribute properties worth reporting a change on. */
const TRACKED = [
  ["type", "type"],
  ["isRequired", "required"],
  ["isUnique", "unique"],
  ["isMultiselect", "multi-value"],
];

export function diffSchemas(before, after) {
  const objects = diffCollection(before.objects, after.objects, diffObject, "slug");
  const lists = diffCollection(before.lists, after.lists, diffList, "slug");

  return {
    modelVersion: before.modelVersion,
    from: { generatedAt: before.generatedAt },
    to: { generatedAt: after.generatedAt },
    objects,
    lists,
    summary: {
      objectsAdded: objects.added.length,
      objectsRemoved: objects.removed.length,
      objectsChanged: objects.changed.length,
      listsAdded: lists.added.length,
      listsRemoved: lists.removed.length,
      attributesAdded: objects.changed.reduce((n, o) => n + o.attributes.added.length, 0),
      attributesRemoved: objects.changed.reduce((n, o) => n + o.attributes.removed.length, 0),
      attributesChanged: objects.changed.reduce((n, o) => n + o.attributes.changed.length, 0),
    },
  };
}

function diffCollection(beforeItems, afterItems, compare, labelKey) {
  const beforeById = index(beforeItems);
  const afterById = index(afterItems);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, a] of afterById) {
    const b = beforeById.get(id);
    if (!b) {
      added.push({ id, label: a[labelKey], entity: a });
      continue;
    }
    const delta = compare(b, a);
    if (delta) changed.push({ id, label: a[labelKey], ...delta });
  }

  for (const [id, b] of beforeById) {
    if (!afterById.has(id)) removed.push({ id, label: b[labelKey], entity: b });
  }

  const byLabel = (x, y) => String(x.label).localeCompare(String(y.label));
  return {
    added: added.sort(byLabel),
    removed: removed.sort(byLabel),
    changed: changed.sort(byLabel),
  };
}

function diffObject(before, after) {
  const renamed = before.slug !== after.slug ? { from: before.slug, to: after.slug } : null;
  const attributes = diffCollection(before.attributes, after.attributes, diffAttribute, "slug");

  const touched =
    renamed ||
    attributes.added.length ||
    attributes.removed.length ||
    attributes.changed.length;

  return touched ? { renamed, attributes } : null;
}

function diffList(before, after) {
  const renamed = before.slug !== after.slug ? { from: before.slug, to: after.slug } : null;

  const beforeParents = [...before.parentObjectIds].sort().join(",");
  const afterParents = [...after.parentObjectIds].sort().join(",");
  const properties =
    beforeParents !== afterParents
      ? [{ property: "parent objects", from: beforeParents, to: afterParents }]
      : [];

  return renamed || properties.length
    ? { renamed, properties, attributes: EMPTY_DELTA }
    : null;
}

const EMPTY_DELTA = { added: [], removed: [], changed: [] };

function diffAttribute(before, after) {
  const renamed = before.slug !== after.slug ? { from: before.slug, to: after.slug } : null;

  const properties = [];
  for (const [key, label] of TRACKED) {
    if (before[key] !== after[key]) {
      properties.push({ property: label, from: before[key], to: after[key] });
    }
  }

  // Relationship shape changes are the ones that silently break integrations,
  // so they are reported separately from ordinary property edits.
  const beforeRef = refShape(before.reference);
  const afterRef = refShape(after.reference);
  const reference = beforeRef !== afterRef ? { from: beforeRef, to: afterRef } : null;

  return renamed || properties.length || reference
    ? { renamed, properties, reference }
    : null;
}

function refShape(ref) {
  if (!ref) return "none";
  if (ref.anyObject) return "any-object";
  const kind = ref.reciprocal ? "two-way" : "one-way";
  return `${kind}(${[...ref.targetObjectIds].sort().join(",")})`;
}

function index(items) {
  // Fall back to slug when an entity has no id, so hand-written fixtures and
  // older snapshots still diff sensibly.
  return new Map((items || []).map((i) => [i.id ?? `slug:${i.slug}`, i]));
}

/**
 * Per-node status for the renderers, so the diff can be drawn on the graph
 * instead of read as text.
 *
 * @returns {Map<string, "added"|"removed"|"changed">} keyed by graph node id.
 */
export function nodeStatuses(delta) {
  const status = new Map();
  for (const o of delta.objects.added) status.set(`object:${o.id}`, "added");
  for (const o of delta.objects.removed) status.set(`object:${o.id}`, "removed");
  for (const o of delta.objects.changed) status.set(`object:${o.id}`, "changed");
  for (const l of delta.lists.added) status.set(`list:${l.id}`, "added");
  for (const l of delta.lists.removed) status.set(`list:${l.id}`, "removed");
  return status;
}

/** Human-readable diff, used for terminal output and for `--format markdown`. */
export function formatDiff(delta) {
  const out = [];
  const s = delta.summary;
  const total =
    s.objectsAdded + s.objectsRemoved + s.objectsChanged + s.listsAdded + s.listsRemoved;

  if (total === 0) return "No schema changes.";

  const line = (sym, text) => out.push(`${sym} ${text}`);

  for (const o of delta.objects.added) line("+", `object ${o.label}`);
  for (const o of delta.objects.removed) line("-", `object ${o.label}`);

  for (const o of delta.objects.changed) {
    if (o.renamed) line("~", `object ${o.renamed.from} renamed to ${o.renamed.to}`);
    for (const a of o.attributes.added) line("+", `${o.label}.${a.label}`);
    for (const a of o.attributes.removed) line("-", `${o.label}.${a.label}`);
    for (const a of o.attributes.changed) {
      if (a.renamed) {
        line("~", `${o.label}.${a.renamed.from} renamed to ${a.renamed.to}`);
      }
      for (const p of a.properties) {
        line("~", `${o.label}.${a.label} ${p.property}: ${p.from} to ${p.to}`);
      }
      if (a.reference) {
        line("~", `${o.label}.${a.label} relationship: ${a.reference.from} to ${a.reference.to}`);
      }
    }
  }

  for (const l of delta.lists.added) line("+", `list ${l.label}`);
  for (const l of delta.lists.removed) line("-", `list ${l.label}`);

  return out.join("\n");
}
