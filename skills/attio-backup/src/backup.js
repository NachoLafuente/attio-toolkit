/**
 * Full-workspace Attio snapshot.
 *
 * Design rule: one failing endpoint must never kill the run. Missing scopes on
 * an API key are normal (emails and meetings in particular), so every collector
 * is isolated and its failure is recorded in manifest.json instead of thrown.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AttioClient, pool } from "./client.js";
import { flattenRecord, entityId, flattenValues } from "./flatten.js";
import { toCsv } from "./csv.js";
import { Progress, bold, dim, green, red, yellow, humanDuration } from "./ui.js";

export const VERSION = "0.1.1";

export function snapshotName(date = new Date()) {
  return date.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

export async function runBackup({
  apiKey,
  outDir = "./attio-backup",
  concurrency = 6,
  csv = true,
  compact = false,
  only = null,
  client = null,
  quiet = false,
} = {}) {
  const api = client ?? new AttioClient({ apiKey });
  const startedAt = new Date();
  const dir = path.join(outDir, snapshotName(startedAt));
  const jsonDir = path.join(dir, "json");
  const csvDir = path.join(dir, "csv");

  await mkdir(jsonDir, { recursive: true });
  if (csv) await mkdir(csvDir, { recursive: true });

  const counts = {};
  const errors = [];
  const progress = new Progress({ quiet });
  const wants = only
    ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const wanted = (group) => !wants || wants.has(group);

  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  /** Run one collector, record its result, and never rethrow. */
  async function collect(label, group, fn, { csvRows } = {}) {
    if (!wanted(group)) return null;
    progress.start(label);
    try {
      const data = await fn((n) => progress.update(n));
      const rows = Array.isArray(data) ? data : [data];
      const parts = label.split("/");
      await writeJson(path.join(jsonDir, ...parts) + ".json", data, compact);
      if (csv && csvRows) {
        const flat = rows.map(csvRows);
        if (flat.length) {
          const file = path.join(csvDir, ...parts) + ".csv";
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, toCsv(flat), "utf8");
        }
      }
      counts[label] = rows.length;
      progress.finish(label, rows.length);
      return data;
    } catch (err) {
      const skipped = err.status === 403 || err.status === 404;
      errors.push({
        collection: label,
        status: err.status ?? null,
        message: err.message,
      });
      counts[label] = 0;
      progress.finish(label, 0, {
        skipped,
        error: skipped ? `HTTP ${err.status}` : err.message,
      });
      return null;
    }
  }

  log(bold(`\nattio-backup ${VERSION}`));
  log(dim(`  → ${dir}\n`));

  // ---- workspace identity -------------------------------------------------
  const self = await collect("self", "schema", () => api.get("/v2/self"));
  const workspace = {
    id: self?.data?.workspace_id ?? self?.workspace_id ?? null,
    name: self?.data?.workspace_name ?? self?.workspace_name ?? null,
  };
  if (workspace.name) log(dim(`  workspace: ${workspace.name}\n`));

  // ---- schema -------------------------------------------------------------
  const objects =
    (await collect("objects", "schema", () =>
      api.get("/v2/objects").then((r) => r?.data ?? []),
    )) ?? [];

  const lists =
    (await collect("lists", "schema", () =>
      api.get("/v2/lists").then((r) => r?.data ?? []),
    )) ?? [];

  await collect("workspace_members", "schema", () =>
    api.get("/v2/workspace_members").then((r) => r?.data ?? []),
  );
  await collect("webhooks", "schema", () =>
    api.collectOffset("GET", "/v2/webhooks"),
  );

  // ---- attributes + views, per object and per list -------------------------
  const targets = [
    ...objects.map((o) => ({ target: "objects", slug: slugOf(o), entity: o })),
    ...lists.map((l) => ({ target: "lists", slug: slugOf(l), entity: l })),
  ].filter((t) => t.slug);

  await pool(targets, concurrency, async ({ target, slug }) => {
    await collect(
      `attributes/${target}-${slug}`,
      "schema",
      async () => {
        const attrs = await api.collectOffset(
          "GET",
          `/v2/${target}/${slug}/attributes`,
          { query: { show_archived: true } },
        );
        // Select and status attributes carry their allowed values elsewhere.
        await pool(attrs, 3, async (attr) => {
          const type = attr?.type;
          if (type !== "select" && type !== "status") return;
          const sub = type === "select" ? "options" : "statuses";
          try {
            const res = await api.get(
              `/v2/${target}/${slug}/attributes/${attr.api_slug}/${sub}`,
            );
            attr[sub] = res?.data ?? [];
          } catch {
            // Non-fatal: the attribute itself is already captured.
          }
        });
        return attrs;
      },
    );

    await collect(`views/${target}-${slug}`, "schema", () =>
      api.collectCursor(`/v2/${target}/${slug}/views`, {
        query: { show_archived: true },
      }),
    );
  });

  // ---- records ------------------------------------------------------------
  if (wanted("records") && objects.length) {
    for (const obj of objects) {
      const slug = slugOf(obj);
      if (!slug) continue;
      await collect(
        `records/${slug}`,
        "records",
        (tick) =>
          api.collectOffset("POST", `/v2/objects/${slug}/records/query`, {
            pageSize: 500,
            onPage: tick,
          }),
        { csvRows: flattenRecord },
      );
    }
  }

  // ---- list entries -------------------------------------------------------
  if (wanted("lists") && lists.length) {
    for (const list of lists) {
      const slug = slugOf(list);
      if (!slug) continue;
      await collect(
        `list-entries/${slug}`,
        "lists",
        (tick) =>
          api.collectOffset("POST", `/v2/lists/${slug}/entries/query`, {
            pageSize: 500,
            onPage: tick,
          }),
        { csvRows: flattenEntry },
      );
    }
  }

  // ---- activity -----------------------------------------------------------
  await collect(
    "notes",
    "activity",
    (tick) => api.collectOffset("GET", "/v2/notes", { onPage: tick }),
    { csvRows: flattenNote },
  );
  await collect(
    "tasks",
    "activity",
    (tick) => api.collectOffset("GET", "/v2/tasks", { onPage: tick }),
    { csvRows: flattenTask },
  );
  await collect("threads", "activity", (tick) =>
    api.collectOffset("GET", "/v2/threads", { onPage: tick }),
  );
  await collect("emails", "activity", (tick) =>
    api.collectCursor("/v2/emails", { onPage: tick }),
  );
  await collect("meetings", "activity", (tick) =>
    api.collectCursor("/v2/meetings", { onPage: tick }),
  );

  // ---- manifest -----------------------------------------------------------
  const finishedAt = new Date();
  const manifest = {
    tool: "attio-backup",
    version: VERSION,
    workspace,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt - startedAt,
    api_requests: api.requestCount,
    counts,
    errors,
    partial: errors.length > 0,
  };
  await writeJson(path.join(dir, "manifest.json"), manifest, false);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log("");
  log(
    `  ${bold(String(total))} entities in ${humanDuration(manifest.duration_ms)}` +
      dim(` · ${api.requestCount} API calls`),
  );
  if (errors.length) {
    log(
      `  ${yellow(String(errors.length))} collection(s) incomplete ` +
        dim("(see manifest.json → errors)"),
    );
    for (const e of errors.slice(0, 5)) {
      log(dim(`    ${e.collection}: ${e.status ?? ""} ${e.message}`));
    }
  } else {
    log(`  ${green("complete")}`);
  }
  log(dim(`  ${dir}\n`));

  return { dir, manifest };
}

// ---- helpers --------------------------------------------------------------

function slugOf(entity) {
  return (
    entity?.api_slug ??
    entity?.id?.list_id ??
    entity?.id?.object_id ??
    null
  );
}

async function writeJson(file, data, compact) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(data, null, compact ? 0 : 2) + "\n",
    "utf8",
  );
}

function flattenEntry(entry) {
  return {
    id: entityId(entry),
    parent_record_id: entry?.parent_record_id ?? "",
    parent_object: entry?.parent_object ?? "",
    created_at: entry?.created_at ?? "",
    ...flattenValues(entry?.entry_values ?? entry?.values),
  };
}

function flattenNote(note) {
  return {
    id: entityId(note),
    title: note?.title ?? "",
    parent_object: note?.parent_object ?? "",
    parent_record_id: note?.parent_record_id ?? "",
    created_at: note?.created_at ?? "",
    content: note?.content_plaintext ?? note?.content_markdown ?? "",
  };
}

function flattenTask(task) {
  return {
    id: entityId(task),
    content: task?.content_plaintext ?? task?.content ?? "",
    is_completed: task?.is_completed ? "true" : "false",
    deadline_at: task?.deadline_at ?? "",
    created_at: task?.created_at ?? "",
    assignees: (task?.assignees ?? [])
      .map((a) => a.referenced_actor_id ?? a.email_address ?? "")
      .filter(Boolean)
      .join("; "),
    linked_records: (task?.linked_records ?? [])
      .map((r) => `${r.target_object ?? ""}:${r.target_record_id ?? ""}`)
      .join("; "),
  };
}
