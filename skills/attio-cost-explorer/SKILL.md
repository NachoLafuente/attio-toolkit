---
name: attio-cost-explorer
description: Estimate your Attio bill across plan tiers. Use when the user asks "should I upgrade/downgrade my Attio plan", "what does my Attio cost", "am I on the right plan", "Attio pricing for my workspace", "how much would Attio cost me", or pastes an Attio API key and asks about pricing. Read-only, ~5 API calls. Output is a markdown report (or JSON with --json).
license: MIT
author: 5050Growth
---

# attio-cost-explorer

Tells you the cheapest Attio plan that fits your current workspace, what you'd pay across all tiers, and where you might save.

## When to use this skill

Run when a user is sizing up Attio pricing decisions: about to start a trial, considering upgrade/downgrade, comparing plans, or auditing software costs. The output is a single markdown report you can paste into a finance doc or share with a stakeholder.

Do NOT use this skill if the user wants:
- Attio's full feature comparison (point them at attio.com/pricing instead)
- Cost projections for hypothetical future workspaces (this only reads current state)

## Inputs

- Attio API token via `--token`, `ATTIO_API_KEY`, or `ATTIO_OAUTH2`
- Optional `--plus-rate` and `--pro-rate` to override default pricing assumptions

## How to run

```bash
ATTIO_API_KEY=<token> python skills/attio-cost-explorer/cost.py
ATTIO_API_KEY=<token> python skills/attio-cost-explorer/cost.py --json
ATTIO_API_KEY=<token> python skills/attio-cost-explorer/cost.py --plus-rate 36 --pro-rate 86
```

## What it checks

- Workspace member count (drives seat-based pricing)
- Number of objects, including custom objects (custom objects force Pro tier)
- List count and record-sample size as footprint context

## Output structure

- Today's footprint (seats, objects, lists, sampled records)
- Cheapest plan that fits + estimated cost
- Cost-across-plans table (Free / Plus / Pro / Enterprise)
- What forces an upgrade (if anything)
- Where you might save

## Limitations

- Pricing is hardcoded to published annual-billing rates as of May 2026. Override via flags if outdated or if your contract differs.
- Does not detect feature usage that may force Enterprise (SAML SSO, audit logs, custom retention).
- Record count is sample-based, not exact. Modern Attio plans (Plus and Pro) have unlimited records, so this is informational.

## Safe to run on production

Read-only. Five GET calls and two POST query calls. Zero writes.
