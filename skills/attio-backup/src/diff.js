/**
 * Diff two snapshots.
 *
 * This is the part people actually use. Nobody restores a whole CRM. They want
 * to know who deleted 400 records on Tuesday and which field got bulk-edited.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { flattenValues, entityId } from "./flatten.js";
import { bold, dim, green, red, yellow, cyan } from "./ui.js";

/** List snapshot directories inside an output dir, oldest first. */
export async function listSnapshots(outDir) {
  let entries;
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(outDir, e.name);
    try {
      await stat(path.join(full, "manifest.json"));
      dirs.push(full);
    } catch {
      // Not a snapshot directory.
    }
  }
  return dirs.sort();
}

/** Recursively list collection keys ("records/companies") under a snapshot. */
async function listCollections(snapshotDir) {
  const root = path.join(snapshotDir, "json");
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (e.name.endsWith(".json")) out.push(rel.replace(/\.json$/, ""));
    }
  }
  await walk(root, "");
  return out.sort();
}

async function readCollection(snapshotDir, key) {
  const file = path.join(snapshotDir, "json", `${key}.json`);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.data)) return parsed.data;
    return [parsed];
  } catch {
    return null;
  }
}

/** Reduce any Attio entity to a flat comparable map. */
export function flattenEntity(entity) {
  if (!entity || typeof entity !== "object") return { value: String(entity) };
  if (entity.values || entity.entry_values) {
    return flattenValues(entity.entry_values ?? entity.values);
  }
  const out = {};
  for (const [k, v] of Object.entries(entity)) {
    if (k === "id") continue;
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

/** Best-effort human label so the report reads like English, not UUIDs. */
export function labelOf(entity, flat = flattenEntity(entity)) {
  const candidates = [
    flat.name,
    flat.full_name,
    flat.title,
    flat.api_slug,
    flat.email_addresses,
    flat.email_address,
    flat.domains,
    flat.content,
    flat.plural_noun,
  ];
  const label = candidates.find((v) => v && v.trim() !== "");
  const short = label ? label.trim().replace(/\s+/g, " ") : entityId(entity);
  return short && short.length > 70 ? short.slice(0, 67) + "..." : short;
}

export function diffCollection(before, after) {
  const index = (rows) => {
    const m = new Map();
    for (const row of rows ?? []) {
      const id = entityId(row);
      if (id) m.set(id, row);
    }
    return m;
  };
  const a = index(before);
  const b = index(after);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, row] of b) {
    if (!a.has(id)) added.push({ id, label: labelOf(row) });
  }
  for (const [id, row] of a) {
    if (!b.has(id)) removed.push({ id, label: labelOf(row) });
  }
  for (const [id, rowB] of b) {
    const rowA = a.get(id);
    if (!rowA) continue;
    const flatA = flattenEntity(rowA);
    const flatB = flattenEntity(rowB);
    const fields = [];
    for (const key of new Set([...Object.keys(flatA), ...Object.keys(flatB)])) {
      // Timestamps that always move are noise, not signal.
      if (key === "updated_at" || key === "last_interaction") continue;
      const va = flatA[key] ?? "";
      const vb = flatB[key] ?? "";
      if (va !== vb) fields.push({ field: key, before: va, after: vb });
    }
    if (fields.length) changed.push({ id, label: labelOf(rowB, flatB), fields });
  }

  return { added, removed, changed };
}

export async function runDiff({
  from,
  to,
  json = false,
  maxExamples = 10,
  quiet = false,
} = {}) {
  const collections = [
    ...new Set([...(await listCollections(from)), ...(await listCollections(to))]),
  ].sort();

  const report = {
    from,
    to,
    collections: {},
    totals: { added: 0, removed: 0, changed: 0 },
  };

  for (const key of collections) {
    const before = await readCollection(from, key);
    const after = await readCollection(to, key);
    if (before === null && after === null) continue;
    const d = diffCollection(before ?? [], after ?? []);
    if (!d.added.length && !d.removed.length && !d.changed.length) continue;
    d.missing_before = before === null;
    d.missing_after = after === null;
    report.collections[key] = d;
    report.totals.added += d.added.length;
    report.totals.removed += d.removed.length;
    report.totals.changed += d.changed.length;
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  if (!quiet) render(report, maxExamples);
  return report;
}

function render(report, maxExamples) {
  console.log("");
  console.log(bold("attio-backup diff"));
  console.log(dim(`  from  ${report.from}`));
  console.log(dim(`  to    ${report.to}`));
  console.log("");

  const keys = Object.keys(report.collections);
  if (!keys.length) {
    console.log(`  ${green("no changes")}\n`);
    return;
  }

  for (const key of keys) {
    const d = report.collections[key];
    const parts = [
      d.added.length ? green(`+${d.added.length}`) : null,
      d.removed.length ? red(`-${d.removed.length}`) : null,
      d.changed.length ? yellow(`~${d.changed.length}`) : null,
    ].filter(Boolean);
    console.log(`  ${bold(key.padEnd(34))} ${parts.join("  ")}`);

    for (const item of d.added.slice(0, maxExamples)) {
      console.log(`    ${green("+")} ${item.label}`);
    }
    if (d.added.length > maxExamples) {
      console.log(dim(`      ...and ${d.added.length - maxExamples} more added`));
    }
    for (const item of d.removed.slice(0, maxExamples)) {
      console.log(`    ${red("-")} ${item.label}`);
    }
    if (d.removed.length > maxExamples) {
      console.log(dim(`      ...and ${d.removed.length - maxExamples} more removed`));
    }
    for (const item of d.changed.slice(0, maxExamples)) {
      console.log(`    ${yellow("~")} ${item.label}`);
      for (const f of item.fields.slice(0, 5)) {
        console.log(
          dim(`        ${f.field}: `) +
            `${trunc(f.before)} ${cyan("→")} ${trunc(f.after)}`,
        );
      }
      if (item.fields.length > 5) {
        console.log(dim(`        ...and ${item.fields.length - 5} more fields`));
      }
    }
    if (d.changed.length > maxExamples) {
      console.log(dim(`      ...and ${d.changed.length - maxExamples} more changed`));
    }
    console.log("");
  }

  const t = report.totals;
  console.log(
    `  ${green(`+${t.added}`)}  ${red(`-${t.removed}`)}  ${yellow(`~${t.changed}`)}` +
      dim("  across " + keys.length + " collection(s)\n"),
  );
}

function trunc(s, n = 44) {
  const v = s === "" ? dim("(empty)") : s;
  return typeof v === "string" && v.length > n ? v.slice(0, n - 3) + "..." : v;
}
