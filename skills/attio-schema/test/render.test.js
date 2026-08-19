import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchSchema } from "../src/schema.js";
import { buildGraph } from "../src/graph.js";
import { layoutGraph } from "../src/layout.js";
import { toSvg } from "../src/render/svg.js";
import { toHtml } from "../src/render/html.js";
import { render } from "../src/run.js";
import { diffSchemas } from "../src/diff.js";
import { FakeClient, OBJECTS, ATTRIBUTES, LISTS } from "./fixtures.js";

const load = (opts) => fetchSchema(new FakeClient(), opts);
const laidOut = async (opts) => layoutGraph(buildGraph(await load(opts)));

async function inTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "attio-schema-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("layout is deterministic for a given seed", async () => {
  const a = layoutGraph(buildGraph(await load()), { seed: 7 });
  const b = layoutGraph(buildGraph(await load()), { seed: 7 });
  assert.deepEqual(
    a.nodes.map((n) => [n.id, n.x, n.y]),
    b.nodes.map((n) => [n.id, n.x, n.y]),
  );
});

test("a different seed produces a different arrangement", async () => {
  const a = layoutGraph(buildGraph(await load()), { seed: 1 });
  const b = layoutGraph(buildGraph(await load()), { seed: 99 });
  assert.notDeepEqual(
    a.nodes.map((n) => [n.x, n.y]),
    b.nodes.map((n) => [n.x, n.y]),
  );
});

test("cards never overlap", async () => {
  const laid = await laidOut();
  for (let i = 0; i < laid.nodes.length; i++) {
    for (let j = i + 1; j < laid.nodes.length; j++) {
      const a = laid.nodes[i];
      const b = laid.nodes[j];
      const gapX = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
      const gapY = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
      assert.ok(gapX > -0.5 || gapY > -0.5, `${a.label} overlaps ${b.label}`);
    }
  }
});

test("every node lands inside the reported canvas", async () => {
  const laid = await laidOut();
  for (const n of laid.nodes) {
    assert.ok(n.x - n.width / 2 >= 0, `${n.label} off the left edge`);
    assert.ok(n.y - n.height / 2 >= 0, `${n.label} off the top edge`);
    assert.ok(n.x + n.width / 2 <= laid.width, `${n.label} off the right edge`);
    assert.ok(n.y + n.height / 2 <= laid.height, `${n.label} off the bottom edge`);
  }
});

test("layout survives a graph with no edges at all", async () => {
  const objects = structuredClone(OBJECTS);
  const attributes = { companies: [], people: [], projects: [], invoices: [] };
  const model = await fetchSchema(new FakeClient({ objects, attributes, lists: [] }));
  const laid = layoutGraph(buildGraph(model));
  assert.equal(laid.edges.length, 0);
  assert.ok(laid.width > 0 && laid.height > 0);
  assert.ok(laid.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test("layout survives an empty workspace", async () => {
  const model = await fetchSchema(
    new FakeClient({ objects: [], attributes: {}, lists: [] }),
  );
  const laid = layoutGraph(buildGraph(model));
  assert.deepEqual(laid.nodes, []);
  assert.equal(laid.width, 0);
});

test("svg escapes markup in names instead of emitting it", async () => {
  const objects = structuredClone(OBJECTS);
  objects[0].plural_noun = '<script>alert("x")</script>';
  const model = await fetchSchema(
    new FakeClient({ objects, attributes: structuredClone(ATTRIBUTES), lists: LISTS }),
  );
  const svg = toSvg(layoutGraph(buildGraph(model)));

  assert.equal(svg.includes("<script>"), false, "unescaped markup reached the SVG");
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("html makes no external requests", async () => {
  const html = toHtml(await laidOut(), { stats: {}, workspace: {} });

  // The SVG namespace is a declaration, not a fetch. Everything else must go.
  const urls = (html.match(/https?:\/\/[^\s"')]+/g) || []).filter(
    (u) => u !== "http://www.w3.org/2000/svg",
  );
  assert.deepEqual(urls, [], `page reaches out to ${urls.join(", ")}`);

  for (const tag of ["<script src", "<link ", "@import", "url("]) {
    assert.equal(html.includes(tag), false, `page pulls an external asset via ${tag}`);
  }
});

test("anonymised render leaks no names into any output file", async () => {
  await inTempDir(async (dir) => {
    const model = await load({ anonymize: true });
    const { files } = await render(model, {
      outDir: dir,
      formats: ["html", "svg", "mermaid", "json"],
    });
    assert.equal(files.length, 4);

    for (const file of files) {
      const body = await readFile(file, "utf8");
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
        assert.equal(
          body.toLowerCase().includes(leak.toLowerCase()),
          false,
          `${file} leaked "${leak}"`,
        );
      }
    }
  });
});

test("render writes the expected files and reports stats", async () => {
  await inTempDir(async (dir) => {
    const { files, stats } = await render(await load(), { outDir: dir });
    assert.deepEqual(
      files.map((f) => f.split("/").pop()).sort(),
      ["schema.html", "schema.json", "schema.mmd"],
    );
    assert.equal(stats.objects, 4);
  });
});

test("render rejects an unknown format instead of silently skipping it", async () => {
  await inTempDir(async (dir) => {
    const model = await load();
    await assert.rejects(
      () => render(model, { outDir: dir, formats: ["pdf"] }),
      /Unknown format "pdf"/,
    );
  });
});

test("a diff render marks changed nodes and writes the change log", async () => {
  await inTempDir(async (dir) => {
    const before = await load();
    const objects = structuredClone(OBJECTS);
    const attributes = structuredClone(ATTRIBUTES);
    const i = objects.findIndex((o) => o.api_slug === "invoices");
    objects.splice(i, 1);
    delete attributes.invoices;
    const after = await fetchSchema(new FakeClient({ objects, attributes, lists: LISTS }));

    const delta = diffSchemas(before, after);
    const { files } = await render(after, {
      outDir: dir,
      formats: ["svg"],
      delta,
      basename: "diff",
    });

    const names = files.map((f) => f.split("/").pop());
    assert.ok(names.includes("diff.svg"));
    assert.ok(names.includes("diff-changes.txt"));
    assert.match(await readFile(files.find((f) => f.endsWith(".txt")), "utf8"), /- object invoices/);
  });
});
