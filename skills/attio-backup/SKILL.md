---
name: attio-backup
description: Back up an entire Attio workspace to local JSON + CSV, then diff two snapshots to see exactly what was added, deleted or edited. Use when the user asks to "back up Attio", "export my whole CRM", "snapshot my Attio workspace", "what changed in Attio this week", "did someone delete records", or wants scheduled CRM backups they control. Read-only: never writes to Attio. Runs via npx, no install.
license: MIT
author: 5050Growth
---

# attio-backup

Snapshot a whole Attio workspace to files the user owns, and diff snapshots to
answer "what changed".

Read-only. This tool never writes to Attio, so it is safe to run without
confirmation.

## When to use this skill

- "Back up my Attio workspace"
- "Export everything out of Attio"
- "What changed in the CRM since last week?"
- "Did someone delete a bunch of records?"
- "Set up weekly CRM backups"
- Before a risky bulk edit, migration, or dedupe run, so there is a rollback reference

## Requirements

An Attio API key with read scopes. Attio → Workspace settings → Developers →
create an access token. Pass it as `--key` or set `ATTIO_API_KEY`.

If the user has not given you a key, ask for one. Do not guess, and do not read
keys out of unrelated files.

## Commands

```bash
# Snapshot everything into ./attio-backup/<timestamp>/
npx -y attio-backup --key "$ATTIO_API_KEY"

# What changed between the last two snapshots
npx -y attio-backup diff

# Two specific snapshots
npx -y attio-backup diff ./attio-backup/2026-08-01T03-00-00Z ./attio-backup/2026-08-08T03-00-00Z

# List snapshots
npx -y attio-backup ls
```

Useful flags:

| Flag | Effect |
|------|--------|
| `--out <dir>` | Where snapshots go (default `./attio-backup`) |
| `--only <groups>` | `schema`, `records`, `lists`, `activity` (comma-separated) |
| `--no-csv` | JSON only, skip the flattened CSV mirror |
| `--compact` | Minified JSON (smaller, less git-friendly) |
| `--json` | Machine-readable diff output |
| `--alert-deletes <n>` | Exit code 2 if more than n entities disappeared |

## What gets captured

Schema: objects, lists, attributes (including archived, with select options and
status values), views, workspace members, webhooks.

Data: records for every object including custom ones, list entries, notes,
tasks, threads, emails, meetings.

Each snapshot is a directory:

```
attio-backup/2026-08-18T03-00-00Z/
  manifest.json          counts, timings, errors, workspace id
  json/                  faithful API responses, one file per collection
  csv/                   flattened mirror, opens in Excel or Sheets
```

## Reading the output

Start with `manifest.json`. `partial: true` means at least one collection
failed, and `errors[]` says which. A 403 on `emails` or `meetings` almost
always means the API key lacks those scopes, not that the backup broke.

The `json/` tree is the source of truth. `csv/` is a convenience view: it keeps
only currently-active attribute values, so it will not show superseded history.

## Scheduling

This tool deliberately has no scheduler. It is a plain command, so use whatever
the user already runs:

```bash
# cron, weekly at 03:00 Sunday
0 3 * * 0 cd /srv/backups && ATTIO_API_KEY=xxx npx -y attio-backup

# alert when a backup shows more than 50 deletions
0 4 * * 0 cd /srv/backups && npx -y attio-backup diff --alert-deletes 50
```

GitHub Actions, n8n Execute Command, systemd timers and Task Scheduler all work
the same way.

## Restore

There is no restore command, on purpose. Full-workspace restore is not safe:
record ids are workspace-scoped and every record-reference would need remapping.

To recover specific records, read them out of `json/records/<object>.json` and
write them back with a normal Attio upsert, dry-run first. Say this plainly if
the user asks for one-click restore.

## Notes for the agent

- Never run this against a workspace the user has not named.
- The tool prints an API call count. On a large workspace expect roughly one
  call per 500 records, plus a handful for schema.
- Rate limiting and retries are handled internally, so do not add sleeps.
- If the user wants this in a repo, add `attio-backup/` to `.gitignore`. A
  snapshot contains the entire CRM.
