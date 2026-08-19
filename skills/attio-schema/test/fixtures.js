/**
 * Synthetic Attio API payloads.
 *
 * Every value in this file is hand-written. Nothing here was captured from a
 * real workspace, and no UUID below belongs to a real Attio object. The shapes
 * mirror the documented v2 API so the normaliser is tested against what the API
 * actually returns, not against what we wish it returned.
 *
 * The fixture deliberately covers the awkward cases:
 *   - a true two-way Relationship (reciprocal populated on both halves)
 *   - a one-way record-reference (reciprocal null)
 *   - a many-to-many pair
 *   - a reference with no allowed objects, which means "any object"
 *   - an archived attribute, which must be dropped
 *   - a reference pointing at an object we cannot see
 */

export const OBJ = {
  companies: "00000000-0000-4000-8000-000000000001",
  people: "00000000-0000-4000-8000-000000000002",
  projects: "00000000-0000-4000-8000-000000000003",
  invoices: "00000000-0000-4000-8000-000000000004",
  ghost: "00000000-0000-4000-8000-0000000000ff", // referenced, never returned
};

const ATTR = {
  companyName: "10000000-0000-4000-8000-000000000001",
  companyProjects: "10000000-0000-4000-8000-000000000002",
  peopleName: "10000000-0000-4000-8000-000000000003",
  peopleCompany: "10000000-0000-4000-8000-000000000004",
  peopleProjects: "10000000-0000-4000-8000-000000000005",
  projectsCompany: "10000000-0000-4000-8000-000000000006",
  projectsPeople: "10000000-0000-4000-8000-000000000007",
  projectsOwnerRef: "10000000-0000-4000-8000-000000000008",
  projectsBudget: "10000000-0000-4000-8000-000000000009",
  projectsRetired: "10000000-0000-4000-8000-00000000000a",
  invoicesAnything: "10000000-0000-4000-8000-00000000000b",
  invoicesGhost: "10000000-0000-4000-8000-00000000000c",
};

const LIST = {
  pipeline: "20000000-0000-4000-8000-000000000001",
};

function object(id, apiSlug, singular, plural) {
  return {
    id: { workspace_id: "w", object_id: id },
    api_slug: apiSlug,
    singular_noun: singular,
    plural_noun: plural,
  };
}

function attr(id, apiSlug, type, extra = {}) {
  return {
    id: { workspace_id: "w", attribute_id: id },
    api_slug: apiSlug,
    title: apiSlug.replace(/_/g, " "),
    type,
    is_archived: false,
    is_required: false,
    is_unique: false,
    is_multiselect: false,
    is_system_attribute: false,
    config: {},
    relationship: null,
    ...extra,
  };
}

/** A record-reference with an optional reciprocal half. */
function ref(id, apiSlug, targets, { multi = false, reciprocal = null } = {}) {
  return attr(id, apiSlug, "record-reference", {
    is_multiselect: multi,
    config: { record_reference: { allowed_object_ids: targets } },
    relationship: reciprocal,
  });
}

function reciprocal(objectId, attributeId, objectSlug, apiSlug, multi) {
  return {
    id: { workspace_id: "w", object_id: objectId, attribute_id: attributeId },
    object_slug: objectSlug,
    api_slug: apiSlug,
    is_multiselect: multi,
    title: apiSlug,
  };
}

export const OBJECTS = [
  object(OBJ.companies, "companies", "Company", "Companies"),
  object(OBJ.people, "people", "Person", "People"),
  object(OBJ.projects, "projects", "Project", "Projects"),
  object(OBJ.invoices, "invoices", "Invoice", "Invoices"),
];

export const ATTRIBUTES = {
  companies: [
    attr(ATTR.companyName, "name", "text", { is_system_attribute: true, is_required: true }),
    // Two-way, many-to-one: a company holds many projects, a project holds one company.
    ref(ATTR.companyProjects, "projects", [OBJ.projects], {
      multi: true,
      reciprocal: reciprocal(OBJ.projects, ATTR.projectsCompany, "projects", "company", false),
    }),
  ],
  people: [
    attr(ATTR.peopleName, "name", "text", { is_system_attribute: true }),
    // One-way reference: no reciprocal, so the far side is unknowable.
    ref(ATTR.peopleCompany, "employer", [OBJ.companies]),
    // Two-way, many-to-many.
    ref(ATTR.peopleProjects, "projects", [OBJ.projects], {
      multi: true,
      reciprocal: reciprocal(OBJ.projects, ATTR.projectsPeople, "projects", "team", true),
    }),
  ],
  projects: [
    // The other half of the companies <-> projects relationship.
    ref(ATTR.projectsCompany, "company", [OBJ.companies], {
      multi: false,
      reciprocal: reciprocal(OBJ.companies, ATTR.companyProjects, "companies", "projects", true),
    }),
    // The other half of the people <-> projects relationship.
    ref(ATTR.projectsPeople, "team", [OBJ.people], {
      multi: true,
      reciprocal: reciprocal(OBJ.people, ATTR.peopleProjects, "people", "projects", true),
    }),
    attr(ATTR.projectsBudget, "budget", "currency"),
    attr(ATTR.projectsRetired, "legacy_code", "text", { is_archived: true }),
  ],
  invoices: [
    // Empty allowed list means "any object".
    ref(ATTR.invoicesAnything, "related_to", []),
    // Points at an object the API never returns.
    ref(ATTR.invoicesGhost, "vanished", [OBJ.ghost]),
  ],
};

export const LISTS = [
  {
    id: { workspace_id: "w", list_id: LIST.pipeline },
    api_slug: "pipeline",
    name: "Pipeline",
    parent_object: [OBJ.projects],
  },
];

export const SELF = {
  data: {
    workspace_id: "00000000-0000-4000-8000-00000000cafe",
    workspace_name: "Example Workspace",
    workspace_slug: "example",
  },
};

/**
 * Minimal stand-in for AttioClient. Serves the fixtures above and records which
 * paths were touched, so tests can assert that no record endpoint is ever hit.
 */
export class FakeClient {
  constructor({ objects = OBJECTS, attributes = ATTRIBUTES, lists = LISTS } = {}) {
    this.objects = objects;
    this.attributes = attributes;
    this.lists = lists;
    this.paths = [];
  }

  async get(path) {
    this.paths.push(path);
    if (path === "/v2/self") return SELF;
    if (path === "/v2/objects") return { data: this.objects };
    if (path === "/v2/lists") return { data: this.lists };
    throw new Error(`FakeClient: unexpected GET ${path}`);
  }

  async collectOffset(_method, path) {
    this.paths.push(path);
    const m = path.match(/^\/v2\/objects\/([^/]+)\/attributes$/);
    if (m) return this.attributes[m[1]] ?? [];
    throw new Error(`FakeClient: unexpected collectOffset ${path}`);
  }
}
