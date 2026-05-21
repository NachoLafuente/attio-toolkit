---
name: attio-audit
description: Score an Attio workspace 0-100 on data quality, schema hygiene, list health, and activity. Use when the user asks to "audit my Attio workspace", "check my CRM hygiene", "is my Attio set up well", "grade my Attio", or pastes an Attio API key and asks how clean their data is. Read-only, ~10 API calls by default (500-record sample). Output is a markdown report (or JSON with --json). Full-scan mode available.
license: MIT
author: 5050Growth
---

# attio-audit

Score an Attio workspace 0-100 across four dimensions. Read-only, no writes, no Excel files.

## When to use this skill

Run when the user wants a quick health check of their Attio CRM, or before recommending changes to their setup. The audit produces a single grade plus a focused fix list, suitable for sharing in chat or pasting into a doc.

Do NOT use this skill if the user wants:
- A migration plan (different scope, different deliverable)
- Per-record cleanup (use the CLI instead)
- Excel reports (this skill outputs markdown by design)

## Inputs

The skill needs an Attio API token. Resolution order:
1. `--token <value>` flag
2. `ATTIO_API_KEY` env var
3. `ATTIO_OAUTH2` env var

If none are set, prompt the user for the token before running.

## Before running: ask which scope

Before invoking the script, ask the user:

> "500-record sample is enough for a representative grade and runs in ~10 seconds. Want me to do all records instead (slower, exact counts)?"

Default to the sample unless they ask for the full scan. The full scan paginates every record in People + Companies — hundreds to thousands of API calls on large workspaces, can take minutes. The grade barely moves between sample and full; full mode mostly matters if the user wants exact absolute numbers for a case study or report.

## How to run

Sample mode (default, ~10 calls):

```bash
ATTIO_API_KEY=<token> python skills/attio-audit/audit.py
```

Full scan (paginates every record):

```bash
ATTIO_API_KEY=<token> python skills/attio-audit/audit.py --full
```

JSON output (machine-readable, works with either mode):

```bash
ATTIO_API_KEY=<token> python skills/attio-audit/audit.py --json
ATTIO_API_KEY=<token> python skills/attio-audit/audit.py --full --json
```

## What gets checked

| Dimension | Max | What it measures |
|-----------|-----|------------------|
| Data quality | 30 | % of People with email, % of Companies with domain, % of People with owner |
| Schema hygiene | 25 | Avg attributes per object, presence of bloated objects (>50 attrs) |
| Lists | 20 | Total list count vs sprawl, % of lists with at least one entry |
| Activity | 25 | Workspace member count, % of People created in last 30 days |

Total: 0-100. Letter grade: A (90+), B (80+), C (70+), D (60+), F (<60).

## Output structure

The default markdown output has:
- Header with workspace name + slug + run timestamp
- Big total grade
- Per-dimension breakdown with progress bars and findings
- "Where to focus": top 3 dimensions ranked by point recovery potential

## Limitations

- Default mode samples 500 records per object. Score is a representative estimate, not an exhaustive scan. Use `--full` for exact numbers.
- Owner detection only sees attributes on the record itself. Workspaces that model ownership through list entries will look like they have no owners, which the report flags explicitly.
- Does not check workflow/automation health (Attio API does not expose automation run history).
- Does not detect duplicate records (separate problem, separate tool).

## Safe to run on production

The audit makes only GET and POST query calls. It never writes, deletes, or modifies anything. It's safe to run during business hours on a live workspace.
