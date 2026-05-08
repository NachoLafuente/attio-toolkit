---
name: attio-stale-records
description: Find Attio records that haven't been touched in a while and surface obvious archive candidates. Use when the user asks to "find dead records", "clean up my Attio", "find stale leads/companies/deals", "what's safe to archive", "audit dormant records", or pastes a token and asks about CRM hygiene. Read-only, sample-based. Output is a markdown report (or JSON with --json).
license: MIT
author: 5050Growth
---

# attio-stale-records

Surfaces records that haven't been updated in a configurable number of days, broken down by object and age bucket, with a list of "quick wins" that are clearly safe to archive.

## When to use this skill

Run when the workspace feels cluttered, when a user says "I want to clean up my CRM", before a migration or schema change, or as part of a quarterly hygiene routine. Pairs naturally with `/attio-audit` (which gives you a score) by telling you exactly what to clean up.

## Inputs

- Attio API token via `--token`, `ATTIO_API_KEY`, or `ATTIO_OAUTH2`
- Optional `--days N` (default 90) to set the idle threshold
- Optional `--object <slug>` (repeatable) to scope which objects to scan; defaults to people, companies, deals

## How to run

```bash
ATTIO_API_KEY=<token> python skills/attio-stale-records/stale.py
ATTIO_API_KEY=<token> python skills/attio-stale-records/stale.py --days 180
ATTIO_API_KEY=<token> python skills/attio-stale-records/stale.py --object people --object companies
ATTIO_API_KEY=<token> python skills/attio-stale-records/stale.py --json
```

## What it checks

- Last-updated timestamp on each record (falls back to created_at if no update timestamp)
- Per-object stale count and percentage
- Age distribution buckets: 30-90d, 90-180d, 180-365d, 365+d
- Quick wins: records that are BOTH ancient (>180d or 2x threshold) AND sparse (no email + no company link for People; no domain + no team for Companies)

## Output structure

- Total stale count + per-object breakdown table
- Age distribution
- Quick wins list with object, name, idle days
- Recommended next step

## Limitations

- Sample-based: pulls up to 1000 records per object. For workspaces with more than 1000 records of an object, you're seeing a sample.
- "Quick win" sparseness rules are baked in for People and Companies. Custom objects are checked for staleness only, not sparseness.
- Does not actually archive or delete. This skill only reports.

## Safe to run on production

Read-only. Three POST query calls (one per object). Zero writes.
