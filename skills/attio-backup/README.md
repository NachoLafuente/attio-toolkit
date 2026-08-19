# attio-backup

Back up an entire [Attio](https://attio.com) workspace to JSON and CSV you own,
then diff two snapshots to see exactly what changed.

Zero dependencies. Nothing is uploaded anywhere. Read-only against Attio.

```bash
npx -y attio-backup
```

## Why

Attio has no built-in point-in-time backup. If someone bulk-edits a field or
deletes 400 records on a Tuesday, there is no "undo last week".

Most backup products solve this by holding your CRM on their servers and
charging monthly. This does the same job as a command you run yourself, so your
data never leaves your machine and there is no vendor to trust.

## Usage

```bash
# Snapshot everything into ./attio-backup/<timestamp>/
export ATTIO_API_KEY=sk_...
npx -y attio-backup

# What changed between the last two snapshots
npx -y attio-backup diff

# List snapshots
npx -y attio-backup ls
```

Get an API key from Attio → Workspace settings → Developers. Read scopes are
enough.

### Example diff

```
attio-backup diff
  from  ./attio-backup/2026-08-11T03-00-00Z
  to    ./attio-backup/2026-08-18T03-00-00Z

  records/companies                  +1  -1  ~1
    + Beta AG
    - Zombie Corp
    ~ Acme GmbH
        arr: 120000 EUR → 250000 EUR
        stage: Lead → Qualified

  +1  -1  ~1  across 1 collection(s)
```

## What it captures

**Schema**: objects, lists, attributes (including archived, with their select
options and status values), views, workspace members, webhooks.

**Data**: records for every object including custom ones, list entries, notes,
tasks, threads, emails, meetings.

Output layout:

```
attio-backup/2026-08-18T03-00-00Z/
  manifest.json          counts, timings, errors, workspace id
  json/                  faithful API responses, one file per collection
    objects.json
    records/companies.json
    list-entries/pipeline.json
    attributes/objects-companies.json
    notes.json
    ...
  csv/                   flattened mirror, opens in Excel or Sheets
    records/companies.csv
    notes.csv
    ...
```

The `json/` tree is the source of truth. The `csv/` mirror flattens Attio's
nested value objects down to readable scalars, keeping only currently-active
values.

## Options

| Flag | Effect |
|------|--------|
| `--key <token>` | API key. Falls back to `$ATTIO_API_KEY`, then prompts |
| `--out <dir>` | Snapshot directory (default `./attio-backup`) |
| `--only <groups>` | `schema`, `records`, `lists`, `activity` |
| `--no-csv` | JSON only |
| `--compact` | Minified JSON |
| `--concurrency <n>` | Parallel requests (default 6) |
| `--json` | Machine-readable diff on stdout |
| `--alert-deletes <n>` | Exit 2 if more than n entities disappeared |
| `--quiet` | Errors only |

Exit codes: `0` success, `1` error, `2` `--alert-deletes` threshold exceeded.

## Scheduling

There is no built-in scheduler, deliberately. It is a plain command, so use
whatever you already run.

```bash
# cron: weekly snapshot, then alert if more than 50 things vanished
0 3 * * 0 cd /srv/backups && ATTIO_API_KEY=xxx npx -y attio-backup --quiet
0 4 * * 0 cd /srv/backups && npx -y attio-backup diff --alert-deletes 50
```

GitHub Actions, n8n Execute Command nodes, systemd timers and Windows Task
Scheduler all work identically.

## Use with AI agents

The package ships a `SKILL.md`, so Claude Code, Codex and other agent runtimes
pick it up as a skill. Point your agent at the installed package and ask it to
back up or diff a workspace in plain English.

## Partial backups are normal

If the API key lacks a scope, that collection is recorded in
`manifest.json → errors` and the rest of the backup still completes. A 403 on
`emails` or `meetings` is the usual case. One endpoint failing never aborts the
run.

## Restore

There is no restore command, on purpose. Full-workspace restore is not safe:
record ids are workspace-scoped, so every record-reference would need remapping
and a partial failure leaves the CRM in a worse state than the incident did.

To recover specific records, read them from `json/records/<object>.json` and
write them back with a normal Attio upsert. Dry-run first.

## Security

- Snapshots contain your entire CRM. Add `attio-backup/` to `.gitignore`.
- The tool makes no network calls other than to `api.attio.com`.
- No telemetry, no analytics, no dependencies to audit.
- CSV cells beginning with `=`, `+`, `-` or `@` are prefixed with `'` to
  neutralise spreadsheet formula injection from CRM text fields.

## Development

```bash
npm test        # 19 tests, no network, runs against a fake Attio API
```

## Licence

MIT
