import test from "node:test";
import assert from "node:assert/strict";

import { fetchSchema } from "../src/schema.js";
import { buildGraph, graphStats } from "../src/graph.js";
import { FakeClient, OBJ } from "./fixtures.js";

const load = (opts) => fetchSchema(new FakeClient(), opts);

test("never calls a record endpoint", async () => {
  const api = new FakeClient();
  await fetchSchema(api);
  const recordCalls = api.paths.filter((p) => /\/records|\/entries|\/notes|\/emails/.test(p));
  assert.deepEqual(recordCalls, [], "schema fetch must not read customer data");
});

test("drops archived attributes", async () => {
  const model = await load();
  const projects = model.objects.find((o) => o.slug === "projects");
  assert.ok(projects);
  assert.equal(
    projects.attributes.some((a) => a.slug === "legacy_code"),
    false,
  );
});

test("output is deterministic across runs", async () => {
  const a = await load();
  const b = await load();
  a.generatedAt = b.generatedAt = "fixed";
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("captures the reciprocal half of a two-way relationship", async () => {
  const model = await load();
  const companies = model.objects.find((o) => o.slug === "companies");
  const projects = companies.attributes.find((a) => a.slug === "projects");
  assert.ok(projects.reference.reciprocal, "expected a reciprocal");
  assert.equal(projects.reference.reciprocal.slug, "company");
  assert.equal(projects.reference.reciprocal.isMultiselect, false);
});

test("a one-way reference has no reciprocal", async () => {
  const model = await load();
  const people = model.objects.find((o) => o.slug === "people");
  const employer = people.attributes.find((a) => a.slug === "employer");
  assert.equal(employer.reference.reciprocal, null);
});

test("an empty allowed list is flagged as anyObject", async () => {
  const model = await load();
  const invoices = model.objects.find((o) => o.slug === "invoices");
  const related = invoices.attributes.find((a) => a.slug === "related_to");
  assert.equal(related.reference.anyObject, true);
});

test("anonymize strips workspace identity and every human-readable name", async () => {
  const model = await load({ anonymize: true });

  assert.equal(model.workspace.name, null);
  assert.equal(model.workspace.id, null);

  const blob = JSON.stringify(model);
  for (const leak of [
    "Example Workspace",
    "companies",
    "people",
    "projects",
    "invoices",
    "budget",
    "employer",
    "Pipeline",
  ]) {
    assert.equal(blob.includes(leak), false, `anonymised output leaked "${leak}"`);
  }
});

test("anonymize is stable, so anonymised snapshots still diff", async () => {
  const a = await load({ anonymize: true });
  const b = await load({ anonymize: true });
  assert.deepEqual(
    a.objects.map((o) => o.slug),
    b.objects.map((o) => o.slug),
  );
});

test("graph cardinality reads both ends of a relationship", async () => {
  const graph = buildGraph(await load());
  const find = (from, to) =>
    graph.edges.find((e) => e.from === `object:${from}` && e.to === `object:${to}`);

  // A company holds many projects; a project holds one company.
  const compToProj = find(OBJ.companies, OBJ.projects);
  assert.ok(compToProj);
  assert.equal(compToProj.cardinality, "1:N");
  assert.equal(compToProj.twoWay, true);

  // Many-to-many between people and projects.
  const peopleToProj = find(OBJ.people, OBJ.projects);
  assert.ok(peopleToProj);
  assert.equal(peopleToProj.cardinality, "N:N");

  // One-way: the far side is unknown, not assumed to be 1.
  const peopleToComp = find(OBJ.people, OBJ.companies);
  assert.ok(peopleToComp);
  assert.equal(peopleToComp.cardinality, "?:1");
  assert.equal(peopleToComp.twoWay, false);
});

test("a two-way relationship is drawn once, not twice", async () => {
  const graph = buildGraph(await load());
  const between = graph.edges.filter(
    (e) =>
      e.kind !== "list-parent" &&
      [e.from, e.to].sort().join("|") ===
        [`object:${OBJ.companies}`, `object:${OBJ.projects}`].sort().join("|"),
  );
  assert.equal(between.length, 1, "both halves collapsed into one edge");
});

test("references to invisible objects are dropped, not drawn as dangling edges", async () => {
  const graph = buildGraph(await load());
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    assert.ok(ids.has(e.from), `edge from unknown node ${e.from}`);
    assert.ok(ids.has(e.to), `edge to unknown node ${e.to}`);
  }
  assert.equal(
    graph.edges.some((e) => e.to === `object:${OBJ.ghost}`),
    false,
  );
});

test("anyObject fans out to every other object", async () => {
  const graph = buildGraph(await load());
  const fromInvoices = graph.edges.filter((e) => e.from === `object:${OBJ.invoices}`);
  assert.equal(fromInvoices.length, 3, "invoices links to the three other objects");
  assert.ok(fromInvoices.every((e) => e.anyObject));
});

test("lists attach to their parent object with a dashed edge kind", async () => {
  const graph = buildGraph(await load());
  const listEdge = graph.edges.find((e) => e.kind === "list-parent");
  assert.ok(listEdge);
  assert.equal(listEdge.to, `object:${OBJ.projects}`);
});

test("stats count one-way and two-way separately", async () => {
  const stats = graphStats(buildGraph(await load()));
  assert.equal(stats.objects, 4);
  assert.equal(stats.lists, 1);
  assert.equal(stats.twoWay + stats.oneWay, stats.relationships);
  assert.ok(stats.twoWay >= 2);
});

test("a list parent given as a slug resolves, not just a uuid", async () => {
  // Attio returns `parent_object` as api_slugs while `allowed_object_ids`
  // returns UUIDs. Both shapes must resolve to the same object node.
  const { OBJECTS, ATTRIBUTES } = await import("./fixtures.js");
  const lists = [
    {
      id: { workspace_id: "w", list_id: "20000000-0000-4000-8000-0000000000bb" },
      api_slug: "by_slug",
      name: "By Slug",
      parent_object: ["projects"], // slug, not uuid
    },
  ];
  const model = await fetchSchema(new FakeClient({ objects: OBJECTS, attributes: ATTRIBUTES, lists }));
  const graph = buildGraph(model);

  const edge = graph.edges.find((e) => e.kind === "list-parent");
  assert.ok(edge, "list with a slug parent produced no edge");
  assert.equal(edge.to, `object:${OBJ.projects}`);
});
