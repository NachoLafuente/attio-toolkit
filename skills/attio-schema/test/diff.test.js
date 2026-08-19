import test from "node:test";
import assert from "node:assert/strict";

import { fetchSchema } from "../src/schema.js";
import { diffSchemas, nodeStatuses, formatDiff } from "../src/diff.js";
import { toMermaid } from "../src/render/mermaid.js";
import { buildGraph } from "../src/graph.js";
import { FakeClient, OBJECTS, ATTRIBUTES, LISTS, OBJ } from "./fixtures.js";

const base = () => fetchSchema(new FakeClient());

/** Deep clone the fixtures so a mutation in one test cannot leak into another. */
function variant(mutate) {
  const objects = structuredClone(OBJECTS);
  const attributes = structuredClone(ATTRIBUTES);
  const lists = structuredClone(LISTS);
  mutate({ objects, attributes, lists });
  return fetchSchema(new FakeClient({ objects, attributes, lists }));
}

test("no changes reports nothing", async () => {
  const delta = diffSchemas(await base(), await base());
  assert.equal(formatDiff(delta), "No schema changes.");
  assert.equal(delta.summary.objectsChanged, 0);
});

test("a renamed object is a rename, not a delete plus an add", async () => {
  const after = await variant(({ objects }) => {
    objects.find((o) => o.api_slug === "projects").api_slug = "engagements";
  });
  const delta = diffSchemas(await base(), after);

  assert.equal(delta.objects.added.length, 0);
  assert.equal(delta.objects.removed.length, 0);
  assert.equal(delta.objects.changed.length, 1);
  assert.deepEqual(delta.objects.changed[0].renamed, {
    from: "projects",
    to: "engagements",
  });
});

test("a renamed attribute is a rename, not a delete plus an add", async () => {
  const after = await variant(({ attributes }) => {
    attributes.projects.find((a) => a.api_slug === "budget").api_slug = "deal_value";
  });
  const delta = diffSchemas(await base(), after);

  const projects = delta.objects.changed.find((o) => o.label === "projects");
  assert.equal(projects.attributes.added.length, 0);
  assert.equal(projects.attributes.removed.length, 0);
  assert.deepEqual(projects.attributes.changed[0].renamed, {
    from: "budget",
    to: "deal_value",
  });
});

test("detects an added object and an added attribute", async () => {
  const after = await variant(({ objects, attributes }) => {
    objects.push({
      id: { workspace_id: "w", object_id: "00000000-0000-4000-8000-0000000000aa" },
      api_slug: "contracts",
      singular_noun: "Contract",
      plural_noun: "Contracts",
    });
    attributes.contracts = [];
    attributes.projects.push({
      id: { workspace_id: "w", attribute_id: "10000000-0000-4000-8000-0000000000aa" },
      api_slug: "signed_at",
      title: "signed at",
      type: "timestamp",
      is_archived: false,
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      is_system_attribute: false,
      config: {},
      relationship: null,
    });
  });
  const delta = diffSchemas(await base(), after);

  assert.equal(delta.summary.objectsAdded, 1);
  assert.equal(delta.objects.added[0].label, "contracts");
  assert.equal(delta.summary.attributesAdded, 1);
});

test("detects a removed object", async () => {
  const after = await variant(({ objects, attributes }) => {
    const i = objects.findIndex((o) => o.api_slug === "invoices");
    objects.splice(i, 1);
    delete attributes.invoices;
  });
  const delta = diffSchemas(await base(), after);
  assert.equal(delta.objects.removed.length, 1);
  assert.equal(delta.objects.removed[0].label, "invoices");
});

test("reports a type change on an attribute", async () => {
  const after = await variant(({ attributes }) => {
    attributes.projects.find((a) => a.api_slug === "budget").type = "number";
  });
  const delta = diffSchemas(await base(), after);
  const changed = delta.objects.changed
    .find((o) => o.label === "projects")
    .attributes.changed.find((a) => a.label === "budget");

  assert.deepEqual(changed.properties, [
    { property: "type", from: "currency", to: "number" },
  ]);
});

test("reports a relationship downgraded from two-way to one-way", async () => {
  const after = await variant(({ attributes }) => {
    // Someone replaces the real Relationship with a plain record-reference.
    attributes.companies.find((a) => a.api_slug === "projects").relationship = null;
  });
  const delta = diffSchemas(await base(), after);
  const changed = delta.objects.changed
    .find((o) => o.label === "companies")
    .attributes.changed.find((a) => a.label === "projects");

  assert.ok(changed.reference, "expected a reference shape change");
  assert.match(changed.reference.from, /^two-way/);
  assert.match(changed.reference.to, /^one-way/);
});

test("node statuses drive the on-graph rendering", async () => {
  const after = await variant(({ objects, attributes }) => {
    const i = objects.findIndex((o) => o.api_slug === "invoices");
    objects.splice(i, 1);
    delete attributes.invoices;
    attributes.projects.find((a) => a.api_slug === "budget").type = "number";
  });
  const status = nodeStatuses(diffSchemas(await base(), after));

  assert.equal(status.get(`object:${OBJ.invoices}`), "removed");
  assert.equal(status.get(`object:${OBJ.projects}`), "changed");
  assert.equal(status.has(`object:${OBJ.companies}`), false, "untouched stays unmarked");
});

test("formatDiff renders each change on its own line", async () => {
  const after = await variant(({ attributes }) => {
    attributes.projects.find((a) => a.api_slug === "budget").is_required = true;
  });
  const text = formatDiff(diffSchemas(await base(), after));
  assert.match(text, /projects\.budget required: false to true/);
});

test("mermaid output distinguishes two-way from one-way links", async () => {
  const mmd = toMermaid(buildGraph(await base()));

  assert.match(mmd, /^erDiagram/);
  // Two-way relationships use a solid line.
  assert.match(mmd, /COMPANIES \|\|--o\{ PROJECTS/);
  // The one-way reference uses a dashed line and does not claim a far side.
  assert.match(mmd, /PEOPLE \|\|\.\.\|\| COMPANIES/);
});

test("mermaid identifiers survive slugs that are not word characters", async () => {
  const after = await variant(({ objects }) => {
    objects.find((o) => o.api_slug === "projects").api_slug = "pro-jects 2.0";
  });
  const mmd = toMermaid(buildGraph(after));
  assert.match(mmd, /PRO_JECTS_2_0/);
  assert.equal(/[^\w\s{}:"|.\-]/.test(mmd.split("\n")[1] ?? ""), false);
});

test("mermaid hides system attributes but keeps custom ones", async () => {
  const mmd = toMermaid(buildGraph(await base()));
  assert.match(mmd, /currency budget/);
  // `name` on companies is a system attribute in the fixture.
  assert.equal(/text name/.test(mmd), false);
});
