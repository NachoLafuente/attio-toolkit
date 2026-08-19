#!/usr/bin/env node
/**
 * attio-schema CLI.
 *
 * Read-only by construction: the only Attio endpoints this tool ever calls are
 * /v2/self, /v2/objects, /v2/lists and /v2/objects/:slug/attributes. It never
 * requests a record, so no customer data can reach the output.
 */

import { join } from "node:path";
import { AttioClient } from "../src/client.js";
import { fetchSchema } from "../src/schema.js";
import { render, loadModel, listSnapshots, diffSchemas, formatDiff, VERSION } from "../src/run.js";

const HELP = `
attio-schema ${VERSION}

  Draw an Attio workspace schema as an ER diagram, and diff two snapshots.
  Reads schema only. Never reads records.

Usage
  npx attio-schema                      snapshot the workspace and render it
  npx attio-schema diff                 compare the last two snapshots
  npx attio-schema diff <a> <b>         compare two specific snapshots
  npx attio-schema ls                   list snapshots

Auth
  --key <token>        Attio API key. Defaults to $ATTIO_API_KEY, else prompts.
                       Read scopes are enough. This tool never writes to Attio.

Options
  --out <dir>          Output directory              (default ./attio-schema)
  --format <list>      html,svg,mermaid,json         (default html,mermaid,json)
  --anonymize          Strip workspace identity and all names, keep structure.
                       Makes the diagram safe to publish.
  --no-lists           Objects only, omit lists
  --max-rows <n>       Fields shown per card         (default 8)
  --seed <n>           Layout seed, change to reshuffle  (default 1)
  --quiet              Only print errors
  -h, --help           This text
  -v, --version

Examples
  ATTIO_API_KEY=... npx attio-schema --format svg,mermaid
  ATTIO_API_KEY=... npx attio-schema --anonymize      # safe to post publicly
  npx attio-schema diff                               # what changed since last time
`;

async function main(argv) {
  const args = parseArgs(argv);

  if (args.flags.help || args.flags.h) return void console.log(HELP.trim());
  if (args.flags.version || args.flags.v) return void console.log(VERSION);

  const outDir = args.opts.out || "./attio-schema";
  const quiet = Boolean(args.flags.quiet);
  const log = quiet ? () => {} : (...m) => console.error(...m);

  const command = args.positional[0] || "map";

  if (command === "ls") {
    const snaps = await listSnapshots(outDir);
    if (!snaps.length) return void console.log(`No snapshots in ${outDir}`);
    for (const s of snaps) console.log(s);
    return;
  }

  if (command === "diff") {
    let [a, b] = args.positional.slice(1);
    if (!a || !b) {
      const snaps = await listSnapshots(outDir);
      if (snaps.length < 2) {
        fail(`Need two snapshots to diff. Found ${snaps.length} in ${outDir}.`);
      }
      // listSnapshots is newest-first.
      b = join(outDir, snaps[0]);
      a = join(outDir, snaps[1]);
      log(`Comparing ${snaps[1]} to ${snaps[0]}`);
    }

    const [before, after] = await Promise.all([loadModel(a), loadModel(b)]);
    const delta = diffSchemas(before, after);
    console.log(formatDiff(delta));

    const target = join(outDir, "diff");
    const { files } = await render(after, {
      outDir: target,
      formats: parseFormats(args.opts.format),
      delta,
      basename: "diff",
      maxRows: Number(args.opts["max-rows"] || 8),
      seed: Number(args.opts.seed || 1),
      includeLists: !args.flags["no-lists"],
    });
    log("");
    for (const f of files) log(`  ${f}`);
    return;
  }

  if (command !== "map") fail(`Unknown command "${command}". Try --help.`);

  const apiKey = args.opts.key || process.env.ATTIO_API_KEY || process.env.ATTIO_OAUTH2;
  if (!apiKey) {
    fail(
      "No Attio API key. Pass --key, or set ATTIO_API_KEY.\n" +
        "Create one at Attio > Workspace settings > Developers. Read scopes are enough.",
    );
  }

  const api = new AttioClient({ apiKey });
  log("Reading schema (read-only, no records)…");

  const model = await fetchSchema(api, {
    anonymize: Boolean(args.flags.anonymize),
    includeLists: !args.flags["no-lists"],
    onProgress: (what) => log(`  ${what}`),
  });

  const stamp = model.generatedAt.replace(/[:.]/g, "-");
  const target = join(outDir, stamp);

  const { files, stats } = await render(model, {
    outDir: target,
    formats: parseFormats(args.opts.format),
    maxRows: Number(args.opts["max-rows"] || 8),
    seed: Number(args.opts.seed || 1),
    includeLists: !args.flags["no-lists"],
  });

  log("");
  log(
    `${stats.objects} objects, ${stats.lists} lists, ${stats.attributes} fields, ` +
      `${stats.relationships} relationships (${stats.twoWay} two-way, ${stats.oneWay} one-way)` +
      (stats.orphans ? `, ${stats.orphans} unlinked` : ""),
  );
  log(`${api.requestCount} API requests.`);
  log("");
  for (const f of files) log(`  ${f}`);
}

function parseFormats(value) {
  if (!value) return ["html", "mermaid", "json"];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Minimal argv parser: --flag, --key value, --key=value, and positionals. */
function parseArgs(argv) {
  const flags = {};
  const opts = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const bare = arg.replace(/^-+/, "");
    const [name, inline] = bare.split(/=(.*)/s);
    if (inline !== undefined) {
      opts[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("-") && TAKES_VALUE.has(name)) {
      opts[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }

  return { flags, opts, positional };
}

const TAKES_VALUE = new Set(["key", "out", "format", "max-rows", "seed"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err?.message || err);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
