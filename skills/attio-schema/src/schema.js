/**
 * Fetch an Attio workspace schema and normalise it into a stable model.
 *
 * The model is the contract every renderer and the differ build on, so it is
 * deliberately boring: plain JSON, sorted deterministically, no API shapes
 * leaking through. Two runs against an unchanged workspace produce byte
 * identical output, which is what makes `diff` trustworthy.
 *
 * SCHEMA ONLY. This module never reads a single record. Nothing in the output
 * can contain customer data, because record endpoints are never called.
 */

import { pool } from "./client.js";

export const MODEL_VERSION = 1;

/** Attribute types that create an edge between two objects. */
const REFERENCE_TYPES = new Set(["record-reference"]);

/**
 * Build the normalised schema model.
 *
 * @param {import("./client.js").AttioClient} api
 * @param {object} [opts]
 * @param {boolean} [opts.anonymize] Strip workspace identity and human-readable
 *   names, keeping structure only. Safe to publish.
 * @param {boolean} [opts.includeLists] Include lists as nodes (default true).
 * @param {number}  [opts.concurrency]
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function fetchSchema(api, opts = {}) {
  const {
    anonymize = false,
    includeLists = true,
    concurrency = 6,
    onProgress = () => {},
  } = opts;

  onProgress("workspace");
  const self = await api.get("/v2/self").catch(() => null);

  onProgress("objects");
  const rawObjects = (await api.get("/v2/objects"))?.data ?? [];

  let rawLists = [];
  if (includeLists) {
    onProgress("lists");
    rawLists = (await api.get("/v2/lists"))?.data ?? [];
  }

  onProgress("attributes");
  const objectAttrs = await pool(rawObjects, concurrency, async (o) => {
    const slug = o.api_slug;
    const data = await api.collectOffset("GET", `/v2/objects/${slug}/attributes`);
    return data ?? [];
  });

  const objects = rawObjects
    .map((o, i) => normaliseObject(o, objectAttrs[i], anonymize))
    .sort(byKey("slug"));

  const lists = rawLists.map((l) => normaliseList(l, anonymize)).sort(byKey("slug"));

  return {
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    anonymized: anonymize,
    workspace: anonymize
      ? { id: null, name: null, slug: null }
      : {
          id: self?.data?.workspace_id ?? null,
          name: self?.data?.workspace_name ?? null,
          slug: self?.data?.workspace_slug ?? null,
        },
    objects,
    lists,
  };
}

function normaliseObject(o, attrs, anonymize) {
  const id = o.id?.object_id ?? null;
  return {
    id,
    slug: anonymize ? anonSlug("object", id) : o.api_slug,
    singular: anonymize ? anonSlug("Object", id) : (o.singular_noun ?? o.api_slug),
    plural: anonymize ? anonSlug("Objects", id) : (o.plural_noun ?? o.api_slug),
    isSystem: Boolean(o.api_slug && SYSTEM_OBJECTS.has(o.api_slug)),
    attributes: (attrs || [])
      .filter((a) => !a.is_archived)
      .map((a) => normaliseAttribute(a, anonymize))
      .sort(byKey("slug")),
  };
}

function normaliseAttribute(a, anonymize) {
  const attrId = a.id?.attribute_id ?? null;
  const out = {
    id: attrId,
    slug: anonymize ? anonSlug("attr", attrId) : a.api_slug,
    title: anonymize ? anonSlug("Attr", attrId) : (a.title ?? a.api_slug),
    type: a.type,
    isMultiselect: Boolean(a.is_multiselect),
    isRequired: Boolean(a.is_required),
    isUnique: Boolean(a.is_unique),
    isSystem: Boolean(a.is_system_attribute),
    reference: null,
  };

  if (REFERENCE_TYPES.has(a.type)) {
    const allowed = a.config?.record_reference?.allowed_object_ids ?? [];
    const rel = a.relationship ?? null;
    out.reference = {
      // Empty array means "any object" in the Attio API.
      targetObjectIds: [...allowed].sort(),
      anyObject: allowed.length === 0,
      // Populated only when Attio has generated a reciprocal attribute on the
      // other object, i.e. a real two-way Relationship rather than a one-way
      // record-reference. This is the only reliable way to tell them apart.
      reciprocal: rel
        ? {
            objectId: rel.id?.object_id ?? null,
            objectSlug: anonymize ? null : (rel.object_slug ?? null),
            attributeId: rel.id?.attribute_id ?? null,
            slug: anonymize ? anonSlug("attr", rel.id?.attribute_id) : rel.api_slug,
            title: anonymize ? anonSlug("Attr", rel.id?.attribute_id) : rel.title,
            isMultiselect: Boolean(rel.is_multiselect),
          }
        : null,
    };
  }

  return out;
}

function normaliseList(l, anonymize) {
  const id = l.id?.list_id ?? null;
  return {
    id,
    slug: anonymize ? anonSlug("list", id) : l.api_slug,
    name: anonymize ? anonSlug("List", id) : (l.name ?? l.api_slug),
    parentObjectIds: [...(l.parent_object ?? [])].sort(),
  };
}

/**
 * Stable pseudonym derived from the entity's own UUID. Same input always gives
 * the same label, so an anonymised diff still lines up across two snapshots,
 * but the original name is not recoverable from the output.
 */
function anonSlug(prefix, id) {
  if (!id) return `${prefix}_unknown`;
  const hex = String(id).replace(/-/g, "");
  let h = 0;
  for (let i = 0; i < hex.length; i++) h = (h * 31 + hex.charCodeAt(i)) >>> 0;
  return `${prefix}_${h.toString(36).slice(0, 6)}`;
}

const SYSTEM_OBJECTS = new Set(["people", "companies", "users", "workspaces", "deals"]);

function byKey(k) {
  return (a, b) => String(a[k]).localeCompare(String(b[k]));
}
