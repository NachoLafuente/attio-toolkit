/**
 * Orchestration: model -> graph -> layout -> files on disk.
 * Kept separate from bin/cli.js so it can be driven from a script or a test.
 */

import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { buildGraph, graphStats } from "./graph.js";
import { layoutGraph } from "./layout.js";
import { toMermaid } from "./render/mermaid.js";
import { toSvg } from "./render/svg.js";
import { toHtml } from "./render/html.js";
import { diffSchemas, nodeStatuses, formatDiff } from "./diff.js";

export const VERSION = "0.1.0";

const FORMATS = new Set(["html", "svg", "mermaid", "json"]);

/**
 * Render a schema model to disk.
 *
 * @param {object} model    Output of fetchSchema(), or a loaded snapshot.
 * @param {object} opts
 * @param {string} opts.outDir
 * @param {string[]} [opts.formats]  Defaults to html + mermaid + json.
 * @param {object} [opts.delta]      Diff to overlay on the drawing.
 * @param {string} [opts.basename]
 * @returns {Promise<{files: string[], stats: object}>}
 */
export async function render(model, opts) {
  const {
    outDir,
    formats = ["html", "mermaid", "json"],
    delta = null,
    basename = "schema",
    maxRows = 8,
    seed = 1,
    includeLists = true,
  } = opts;

  for (const f of formats) {
    if (!FORMATS.has(f)) {
      throw new Error(`Unknown format "${f}". Choose from: ${[...FORMATS].join(", ")}`);
    }
  }

  const graph = buildGraph(model, { includeLists });
  const stats = graphStats(graph);
  const status = delta ? nodeStatuses(delta) : new Map();

  await mkdir(outDir, { recursive: true });
  const files = [];
  const write = async (name, contents) => {
    const path = join(outDir, name);
    await writeFile(path, contents, "utf8");
    files.push(path);
  };

  const title = delta ? "Attio schema changes" : "Attio schema";
  const subtitle = delta
    ? summariseDelta(delta)
    : model.anonymized
      ? "anonymised"
      : "";

  if (formats.includes("json")) {
    await write(`${basename}.json`, JSON.stringify(model, null, 2) + "\n");
  }
  if (formats.includes("mermaid")) {
    await write(`${basename}.mmd`, toMermaid(graph));
  }

  if (formats.includes("html") || formats.includes("svg")) {
    const laid = layoutGraph(graph, { maxRows, seed });
    if (formats.includes("svg")) {
      await write(`${basename}.svg`, toSvg(laid, { status, title }) + "\n");
    }
    if (formats.includes("html")) {
      await write(
        `${basename}.html`,
        toHtml(laid, {
          status,
          stats,
          workspace: model.workspace,
          title,
          subtitle,
          legend: delta ? DIFF_LEGEND : null,
        }),
      );
    }
  }

  if (delta) {
    await write(`${basename}-changes.txt`, formatDiff(delta) + "\n");
  }

  return { files, stats };
}

const DIFF_LEGEND = `
  <span><span class="swatch" style="background:var(--ok)"></span>added</span>
  <span><span class="swatch" style="background:var(--bad)"></span>removed</span>
  <span><span class="swatch" style="background:var(--warn)"></span>changed</span>
  <span><b>Solid</b> two-way relationship</span>
  <span><b>Dashed</b> one-way reference</span>
`;

function summariseDelta(delta) {
  const s = delta.summary;
  const bits = [];
  const add = (n, word) => n && bits.push(`${n} ${word}`);
  add(s.objectsAdded, "objects added");
  add(s.objectsRemoved, "objects removed");
  add(s.objectsChanged, "objects changed");
  add(s.attributesAdded, "fields added");
  add(s.attributesRemoved, "fields removed");
  add(s.attributesChanged, "fields changed");
  return bits.length ? bits.join(", ") : "no changes";
}

/** Load a snapshot from a file path, or from a directory holding schema.json. */
export async function loadModel(path) {
  const candidates = [path, join(path, "schema.json")];
  let lastErr;
  for (const c of candidates) {
    try {
      return JSON.parse(await readFile(c, "utf8"));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not read a schema snapshot at ${path}: ${lastErr?.message}`);
}

/** Snapshot directories, newest first, as written by the default command. */
export async function listSnapshots(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export { diffSchemas, formatDiff };
