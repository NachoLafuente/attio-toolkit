import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AttioClient } from "../src/client.js";
import { runBackup } from "../src/backup.js";
import { runDiff, listSnapshots } from "../src/diff.js";
import { makeWorkspace, makeFetch } from "./fake-attio.js";

const clientFor = (ws, opts) =>
  new AttioClient({ apiKey: "test", fetchImpl: makeFetch(ws, opts) });

async function backupInto(outDir, ws, opts) {
  return runBackup({ outDir, client: clientFor(ws, opts), quiet: true });
}

test("runBackup writes a complete snapshot tree", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  const { dir, manifest } = await backupInto(out, makeWorkspace());

  assert.equal(manifest.workspace.name, "Test Workspace");
  assert.equal(manifest.counts["records/companies"], 2);
  assert.equal(manifest.counts["records/people"], 1);
  assert.equal(manifest.counts["list-entries/pipeline"], 1);
  assert.equal(manifest.counts.notes, 1);
  assert.equal(manifest.counts.objects, 2);

  const companies = JSON.parse(
    await readFile(path.join(dir, "json", "records", "companies.json"), "utf8"),
  );
  assert.equal(companies.length, 2);

  const attrs = JSON.parse(
    await readFile(path.join(dir, "json", "attributes", "objects-companies.json"), "utf8"),
  );
  // Status attributes must carry their allowed values, not just the definition.
  assert.deepEqual(attrs.find((a) => a.api_slug === "stage").statuses.map((s) => s.title), [
    "Lead",
    "Qualified",
  ]);
});

test("a missing scope degrades to a recorded error, never a crash", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  const { manifest } = await backupInto(out, makeWorkspace(), {
    failing: ["/v2/emails", "/v2/meetings"],
  });

  assert.equal(manifest.partial, true);
  assert.deepEqual(
    manifest.errors.map((e) => e.collection).sort(),
    ["emails", "meetings"],
  );
  // Everything else still landed.
  assert.equal(manifest.counts["records/companies"], 2);
});

test("CSV mirror flattens nested values and drops superseded ones", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  const { dir } = await backupInto(out, makeWorkspace());
  const csv = await readFile(path.join(dir, "csv", "records", "companies.csv"), "utf8");

  assert.match(csv, /Acme GmbH/);
  assert.match(csv, /120000 EUR/);
  assert.match(csv, /acme\.de/);
  assert.match(csv, /current/);
  assert.doesNotMatch(csv, /,old,/);
});

test("notes CSV survives quotes and newlines in note bodies", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  const { dir } = await backupInto(out, makeWorkspace());
  const csv = await readFile(path.join(dir, "csv", "notes.csv"), "utf8");
  assert.match(csv, /"They want, a CSV\nwith ""quotes"""/);
});

test("--only limits which collections are fetched", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  const { manifest } = await runBackup({
    outDir: out,
    client: clientFor(makeWorkspace()),
    only: "schema",
    quiet: true,
  });
  assert.equal(manifest.counts.objects, 2);
  assert.equal(manifest.counts["records/companies"], undefined);
  assert.equal(manifest.counts.notes, undefined);
});

test("diff reports adds, deletes and per-field edits between snapshots", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  await backupInto(out, makeWorkspace());

  // Someone deletes Zombie Corp, adds Beta AG, and moves Acme to Qualified.
  const after = makeWorkspace();
  after.companies = after.companies.filter(
    (c) => c.id.record_id !== "rec-co-2",
  );
  after.companies[0].values.stage[0].status.title = "Qualified";
  after.companies.push({
    id: { workspace_id: "ws1", object_id: "obj-co", record_id: "rec-co-3" },
    created_at: "2026-03-01T00:00:00.000Z",
    values: { name: [{ attribute_type: "text", active_until: null, value: "Beta AG" }] },
  });

  await new Promise((r) => setTimeout(r, 1100)); // distinct snapshot directory
  await backupInto(out, after);

  const snaps = await listSnapshots(out);
  assert.equal(snaps.length, 2);

  const report = await runDiff({ from: snaps[0], to: snaps[1], quiet: true });
  const d = report.collections["records/companies"];

  assert.deepEqual(d.added.map((x) => x.label), ["Beta AG"]);
  assert.deepEqual(d.removed.map((x) => x.label), ["Zombie Corp"]);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].label, "Acme GmbH");
  assert.deepEqual(d.changed[0].fields, [
    { field: "stage", before: "Lead", after: "Qualified" },
  ]);
  assert.equal(report.totals.removed, 1);
});

test("diff of two identical snapshots reports nothing", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "attio-backup-"));
  await backupInto(out, makeWorkspace());
  await new Promise((r) => setTimeout(r, 1100));
  await backupInto(out, makeWorkspace());

  const snaps = await listSnapshots(out);
  const report = await runDiff({ from: snaps[0], to: snaps[1], quiet: true });
  assert.deepEqual(report.collections, {});
  assert.deepEqual(report.totals, { added: 0, removed: 0, changed: 0 });
});
