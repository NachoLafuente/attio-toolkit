#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { runBackup, VERSION } from "../src/backup.js";
import { runDiff, listSnapshots } from "../src/diff.js";
import { bold, dim, red, yellow } from "../src/ui.js";

const HELP = `
${bold("attio-backup")} ${dim(VERSION)}

  Back up a whole Attio workspace to JSON + CSV, then diff two snapshots.

${bold("Usage")}
  npx attio-backup                    back up now
  npx attio-backup diff               compare the last two snapshots
  npx attio-backup diff <a> <b>       compare two specific snapshots
  npx attio-backup ls                 list snapshots

${bold("Auth")}
  --key <token>        Attio API key. Defaults to $ATTIO_API_KEY, else prompts.
                       Create one at Attio → Workspace settings → Developers.
                       Read scopes are enough. This tool never writes to Attio.

${bold("Options")}
  --out <dir>          Output directory            (default ./attio-backup)
  --only <groups>      schema,records,lists,activity  (default: all)
  --no-csv             Skip the flattened CSV mirror
  --compact            Minified JSON instead of pretty-printed
  --concurrency <n>    Parallel requests            (default 6)
  --quiet              Only print errors

${bold("Diff options")}
  --json               Machine-readable diff on stdout
  --alert-deletes <n>  Exit 2 if more than n entities disappeared
  --max-examples <n>   Examples shown per collection  (default 10)

${bold("Cron")}
  Schedule it however you like. It is a plain command.
    0 3 * * 0  cd /srv/backups && ATTIO_API_KEY=... npx -y attio-backup

${bold("Exit codes")}
  0 success   1 error   2 --alert-deletes threshold exceeded
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: "string" },
    out: { type: "string", default: "./attio-backup" },
    only: { type: "string" },
    csv: { type: "boolean", default: true },
    compact: { type: "boolean", default: false },
    concurrency: { type: "string", default: "6" },
    quiet: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    "alert-deletes": { type: "string" },
    "max-examples": { type: "string", default: "10" },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

const command = positionals[0] ?? "backup";

if (values.help || command === "help") {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}

try {
  if (command === "ls") {
    const snaps = await listSnapshots(values.out);
    if (!snaps.length) {
      console.log(dim(`no snapshots in ${values.out}`));
    } else {
      for (const s of snaps) console.log(s);
    }
    process.exit(0);
  }

  if (command === "diff") {
    let [, from, to] = positionals;
    if (!from || !to) {
      const snaps = await listSnapshots(values.out);
      if (snaps.length < 2) {
        console.error(
          red("Need two snapshots to diff.") +
            dim(` Found ${snaps.length} in ${values.out}.`),
        );
        process.exit(1);
      }
      [from, to] = snaps.slice(-2);
    }
    const report = await runDiff({
      from,
      to,
      json: values.json,
      maxExamples: Number(values["max-examples"]) || 10,
      quiet: values.quiet,
    });
    const threshold = values["alert-deletes"];
    if (threshold !== undefined && report.totals.removed > Number(threshold)) {
      console.error(
        yellow(
          `\n  ${report.totals.removed} entities removed, above the --alert-deletes threshold of ${threshold}\n`,
        ),
      );
      process.exit(2);
    }
    process.exit(0);
  }

  if (command !== "backup") {
    console.error(red(`Unknown command: ${command}`));
    console.log(HELP);
    process.exit(1);
  }

  const apiKey =
    values.key || process.env.ATTIO_API_KEY || (await promptSecret("Attio API key: "));
  if (!apiKey) {
    console.error(
      red("No API key.") + " Pass --key, set ATTIO_API_KEY, or enter it when prompted.",
    );
    process.exit(1);
  }

  const { manifest } = await runBackup({
    apiKey,
    outDir: values.out,
    concurrency: Number(values.concurrency) || 6,
    csv: values.csv,
    compact: values.compact,
    only: values.only ?? null,
    quiet: values.quiet,
  });
  process.exit(manifest.partial ? 0 : 0);
} catch (err) {
  console.error(red(`\n${err.name ?? "Error"}: ${err.message}`));
  if (err.status === 401 || err.status === 403) {
    console.error(
      dim("  The API key was rejected. Check it has read access in Attio → Developers.\n"),
    );
  }
  process.exit(1);
}

/** Read a secret from the TTY without echoing it. */
async function promptSecret(question) {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const originalWrite = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = function (s) {
    if (s.includes(question)) originalWrite?.(s);
  };
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    process.stdout.write("\n");
    return answer.trim();
  } finally {
    rl.close();
  }
}
