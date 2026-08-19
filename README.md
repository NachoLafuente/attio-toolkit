# attio-toolkit

**The Attio toolkit for consultants and operators managing multi-tenant CRM work.** Audit any workspace 0-100 in 30 seconds. Find dead records and schema bloat. Multi-workspace CLI baked in. Built on production engagements.

By [5050Growth](https://5050growth.com), a verified [Attio Expert](https://attio.com/experts/5050growth) consultancy. **10+ Attio engagements shipped in the past three months.**

```
┌──────────────────────────────────────────────────────────────────┐
│  /attio-audit                Score any workspace 0-100.          │
│  /attio-cost-explorer        Estimate your bill across plans.    │
│  /attio-stale-records        Surface archive candidates.         │
│  /attio-attribute-coverage   Find schema bloat (dead fields).    │
│  /attio-backup               Snapshot a workspace, diff two.     │
│  cli/attio                   Multi-workspace wrapper.            │
└──────────────────────────────────────────────────────────────────┘
```

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Built by 5050Growth](https://img.shields.io/badge/built_by-5050Growth-black)](https://5050growth.com)
[![Attio Expert](https://img.shields.io/badge/Attio-Expert-black)](https://attio.com/experts/5050growth)

> **Need help interpreting your audit, or want a plan to fix what it surfaces?**
> [Book a 30-min consult →](https://calendar.notion.so/meet/nacholafuentemoreno/gtm-expert)

---

## What makes this different from other Attio CLIs

GitHub has a handful of Attio CLI projects. Most assume one CLI install per token, are dev-tooling only, and don't address what working consultants actually need. This toolkit:

- **Treats multi-workspace as a first-class concern.** Built for people running 5+ Attio tenants concurrently. Per-workspace isolated state, drop-in `.env` discovery.
- **Ships diagnostic skills, not just API access.** The audit, cost-explorer, stale-records, and attribute-coverage skills produce chat-friendly markdown reports you can paste into client docs. Other CLIs give you raw JSON.
- **Built from real engagements.** Every skill encodes a check we run on actual client work as an [Attio Expert](https://attio.com/experts/5050growth).
- **Read-only by design.** No write actions, no destructive operations. Safe to run on production. See [SECURITY.md](SECURITY.md).

---

## See it before you run it

Three sanitized example workspaces with full reports under [examples/](examples/):

- [Clean workspace](examples/clean-workspace/) (91/100, A): healthy ops, what good looks like
- [Messy migration](examples/messy-migration/) (64/100, D): just migrated from another CRM, lots of stale data
- [Bloated schema](examples/bloated-schema/) (71/100, C): organic growth over years, custom attribute sprawl

Browse the examples first. If one matches your workspace, run the relevant skill against your token to get your own report.

---

## Run it in 10 minutes

```bash
# 1. Get the toolkit (30 seconds)
git clone https://github.com/NachoLafuente/attio-toolkit.git
cd attio-toolkit
pip install -r requirements.txt

# 2. Run the audit on your workspace (30 seconds)
ATTIO_API_KEY=<your-attio-api-token> python skills/attio-audit/audit.py

# 3. Read the report (8 minutes)
#    Find your weakest dimension. Run the matching deep-dive skill:
#    - schema flagged?  -> python skills/attio-attribute-coverage/coverage.py
#    - lots of records? -> python skills/attio-stale-records/stale.py --days 90
#    - cost question?   -> python skills/attio-cost-explorer/cost.py

# 4. If the report flagged things you don't want to fix alone (1 minute)
#    -> https://calendar.notion.so/meet/nacholafuentemoreno/gtm-expert
```

That's it. Python 3.10+ and the `requests` library are the only dependencies for the audit and the three deep-dive skills.

---

## What's in here

### `/attio-audit`: Score any Attio workspace 0-100

Read-only audit across four dimensions:

| Dimension | What it checks |
|-----------|---------------|
| Data quality (30) | Email coverage on People, domain coverage on Companies, owner attribution |
| Schema hygiene (25) | Object count, attributes per object, schema bloat detection |
| Lists (20) | List sprawl, % of lists with at least one entry |
| Activity (25) | Workspace member count, % of People created in last 30 days |

Output is a markdown report you can paste into Slack, Notion, or a client deliverable. Run it on any workspace where you have an API key. Takes about 10 read-only API calls and finishes in under 30 seconds on a normal workspace.

```bash
ATTIO_API_KEY=<your-token> python skills/attio-audit/audit.py
```

Full skill docs: [skills/attio-audit/SKILL.md](skills/attio-audit/SKILL.md). Sample output: [examples/clean-workspace/audit.md](examples/clean-workspace/audit.md).

### `/attio-cost-explorer`: Estimate your Attio bill across plan tiers

Tells you the cheapest plan that fits your current footprint, what you'd pay across all tiers, and where you might save. Useful before signing a contract, deciding to upgrade, or sanity-checking a bill.

```bash
ATTIO_API_KEY=<your-token> python skills/attio-cost-explorer/cost.py
```

Full skill docs: [skills/attio-cost-explorer/SKILL.md](skills/attio-cost-explorer/SKILL.md). Sample output: [examples/clean-workspace/cost-explorer.md](examples/clean-workspace/cost-explorer.md).

### `/attio-stale-records`: Surface archive candidates

Finds records nobody has touched in a while, broken down by object and age. Identifies "quick wins": records that are both ancient AND sparse (no email, no domain, no key fields), so you can clean up safely without thinking.

```bash
ATTIO_API_KEY=<your-token> python skills/attio-stale-records/stale.py --days 90
```

Full skill docs: [skills/attio-stale-records/SKILL.md](skills/attio-stale-records/SKILL.md). Sample output: [examples/messy-migration/stale-records.md](examples/messy-migration/stale-records.md).

### `/attio-attribute-coverage`: Find schema bloat (dead fields)

For each object, shows the % of records that actually have each attribute filled. Flags attributes used on <10% of records as probable bloat. The natural follow-up to `/attio-audit` saying "your schema is heavy": this tells you exactly which fields to delete first.

```bash
ATTIO_API_KEY=<your-token> python skills/attio-attribute-coverage/coverage.py --object companies
```

Full skill docs: [skills/attio-attribute-coverage/SKILL.md](skills/attio-attribute-coverage/SKILL.md). Sample output: [examples/bloated-schema/attribute-coverage.md](examples/bloated-schema/attribute-coverage.md).

### `/attio-backup`: Snapshot a workspace, diff two snapshots

Walks every object and attribute and writes the whole workspace to local JSON + CSV. Run it twice and `diff` tells you exactly what changed between the two snapshots: records added, deleted, and every field that moved. The answer to "who changed this and when" that Attio's audit log doesn't give you.

The only Node skill here; the rest are Python.

```bash
ATTIO_API_KEY=<your-token> npx -y attio-backup            # snapshot now
ATTIO_API_KEY=<your-token> npx -y attio-backup diff       # compare the last two
```

Full skill docs: [skills/attio-backup/SKILL.md](skills/attio-backup/SKILL.md).

### `cli/attio`: Multi-workspace CLI wrapper

A small Python wrapper around [Printing Press](https://printingpress.dev)'s generated `attio-pp-cli` Go binary. The Go CLI is great (150+ subcommands, FTS5-powered local SQLite mirror, agent-friendly flags). The wrapper adds the one thing the upstream binary doesn't have natively: **first-class multi-workspace support**.

```bash
./cli/attio ws list                              # list workspaces from .env
./cli/attio --ws company1 self --agent           # auth check
./cli/attio --ws company2 lists list             # list all lists
./cli/attio --ws company3 sync                   # sync to local SQLite
./cli/attio --ws company1 search "acme"          # FTS5 search over synced data
```

Each workspace gets isolated local state (cache, sync, profile) under `~/.attio-cli-ws/<workspace>/`. No cross-contamination between client workspaces.

Full CLI docs: [cli/README.md](cli/README.md).

---

## Why these four dimensions

The audit weights data quality, schema hygiene, lists, and activity because those are the four levers that actually predict whether a team will trust the CRM 90 days from now. Pulled from production engagements (10+ in the past three months), here's why each made the cut:

- **Data quality** answers "can the team find a record when they need it." Email coverage on People, domain coverage on Companies, and owner attribution decide whether searches and reports work at all. If this is below 70%, every other improvement is theatre.
- **Schema hygiene** answers "is the team navigating signal or noise." Workspaces accumulate custom attributes faster than they retire them. Once an object passes ~50 attributes, the form view becomes a wall and people give up filling fields, which loops back into bad data quality.
- **Lists** answer "is this CRM modeling a process or just storing records." Empty lists or list sprawl (20+ lists, half empty) is a tell that the team has tried multiple processes and abandoned them mid-flight.
- **Activity** answers "is anyone actually using this." A workspace with 3,000 records and 30-day activity below 5% is a graveyard regardless of how clean it is.

The point weights (30/25/20/25) come from how often each dimension blocks a follow-up engagement in practice. Data quality issues block everything, so they get the highest weight. Lists are the least decisive of the four, so they get the lowest.

This is opinionated. If you disagree with the weights, the JSON output gives you the raw subscores so you can re-grade however you like.

---

## Quick start with the CLI wrapper

```bash
# 1. Install Printing Press (requires Go 1.26.3+)
go install github.com/mvanhorn/cli-printing-press/v4/cmd/printing-press@latest

# 2. Generate the Attio CLI from the official spec
printing-press generate \
  --spec https://api.attio.com/openapi/api \
  --spec https://api.attio.com/openapi/standard-objects \
  --name attio --spec-source official --force --lenient --validate=false

# 3. Build and install the binary
cd ~/printing-press/library/attio
go build -o ~/.local/bin/attio-pp-cli ./cmd/attio-pp-cli

# 4. Drop the wrapper alongside your .env
curl -fsSL https://raw.githubusercontent.com/NachoLafuente/attio-toolkit/main/cli/attio -o ./attio
chmod +x ./attio

# 5. Add ATTIO_API_KEY_<WORKSPACE> entries to .env
./attio ws list
./attio --ws yourworkspace self --agent
```

Step-by-step in [cli/README.md](cli/README.md).

---

## Roadmap

Likely next additions, in rough priority order:

- `/attio-migration-readiness`: pre-migration checklist + risk score for moving INTO Attio from another CRM
- `/attio-duplicates`: chat-friendly duplicate detection without bulk-merging anything
- Compound CLI commands for common consultant patterns (3-hop owner resolution, list-membership lookup)

If you have a specific need, open an issue or [drop me a note](https://www.linkedin.com/in/nacholafuente/).

---

## Who's behind this

Hi, I'm [Nacho](https://www.linkedin.com/in/nacholafuente/). I run [5050Growth](https://5050growth.com), an [Attio Expert](https://attio.com/experts/5050growth) consultancy. We've shipped 10+ Attio engagements in the past three months: clean migrations, integration builds, and turning CRMs into something the team trusts.

This repo is the productized version of work we do on real client engagements. The audit is the same diagnostic we run on day zero of a new migration. The CLI is what we use across our own client work to keep multi-tenant Attio operations sane.

### Need help with your GTM Attio setup?

Book time with me directly: [calendar.notion.so/meet/nacholafuentemoreno/gtm-expert](https://calendar.notion.so/meet/nacholafuentemoreno/gtm-expert)

Or drop a line at [nacho@5050growth.com](mailto:nacho@5050growth.com).

### Liked the toolkit?

If it saved you time, [leave a review on the Attio Experts directory](https://attio.com/experts/5050growth/review). Two minutes of your day, real fuel for ours.

---

## Contributing

Issues and PRs welcome. Three ground rules:

1. **No client data in tests or examples.** Use synthetic data or anonymize before committing.
2. **Read-only by default.** New skills should default to making no writes. If a skill needs to write, gate it behind an explicit `--write` flag and a confirmation prompt.
3. **Run the test suite.** `pip install -r requirements-dev.txt && python -m pytest`. CI runs the same on every PR.

## Security

See [SECURITY.md](SECURITY.md) for token handling, scope requirements, and how to report vulnerabilities.

## License

MIT. See [LICENSE](LICENSE).

## Credits

The CLI binary is generated by [Printing Press](https://printingpress.dev) (`mvanhorn/cli-printing-press`). The wrapper, the audit, the cost-explorer, the stale-records skill, the attribute-coverage skill, and the multi-workspace pattern are 5050Growth's contributions.
