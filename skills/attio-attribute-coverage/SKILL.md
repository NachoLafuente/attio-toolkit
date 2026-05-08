---
name: attio-attribute-coverage
description: Show which Attio attributes are actually filled vs unused per object. Flags probable bloat (<10% filled) so you know what's safe to archive. Use when the user asks "which attributes are used in my Attio", "what fields are dead", "schema cleanup", "what to remove from my CRM", "are we using these custom fields", or pastes a token and asks about schema hygiene. Read-only. Output is a markdown report (or JSON with --json).
license: MIT
author: 5050Growth
---

# attio-attribute-coverage

For each object in your workspace, computes the % of records that have each attribute filled in. Flags attributes that are clearly bloat (<10% fill rate) so schema cleanup is a 30-second decision instead of an hour-long audit.

## When to use this skill

Run when a workspace has too many attributes, a user wants to clean up their schema, or before a migration where you want to drop dead fields. Natural pairing: `/attio-audit` will tell you "schema is bloated"; this skill tells you exactly which attributes are bloating it.

## Inputs

- Attio API token via `--token`, `ATTIO_API_KEY`, or `ATTIO_OAUTH2`
- Optional `--object <slug>` (repeatable) to scope which objects to scan; defaults to every object in the workspace

## How to run

```bash
ATTIO_API_KEY=<token> python skills/attio-attribute-coverage/coverage.py
ATTIO_API_KEY=<token> python skills/attio-attribute-coverage/coverage.py --object companies
ATTIO_API_KEY=<token> python skills/attio-attribute-coverage/coverage.py --object people --object companies
ATTIO_API_KEY=<token> python skills/attio-attribute-coverage/coverage.py --json
```

## What it checks

- Lists all attributes per object via the `/attributes` endpoint
- Samples up to 500 records per object via the `/records/query` endpoint
- For each attribute, counts how many sampled records have a non-null, non-empty value
- Categorizes:
  - **Well-used** (>=50%): the team actually fills this in
  - **Underused** (10-49%): inconsistent use, worth a discussion
  - **Probably bloat** (<10%): rarely or never used, archive candidate

## Output structure

- Summary: object count, attribute count, # of bloat and underused custom attributes
- Per-object section with attributes grouped by category
- Suggested cleanup list (custom attributes only; system attributes can't be deleted)

## Limitations

- Sample-based: 500 records per object. For workspaces with >500 records of an object, fill rates are estimates from a representative sample.
- "Filled" means non-null, non-empty list, non-empty string, or non-empty dict. Some workspaces use sentinel values (e.g. "N/A", 0, "unknown") that this skill counts as filled.
- System attributes (record_id, created_at, etc.) show up as 100% filled but are not removable.

## Safe to run on production

Read-only. One GET per object plus one POST query per object. Zero writes. On a workspace with 5 objects, expect about 10 API calls.
