# attio-toolkit

**Open-source tools for people who actually run Attio in production.**

Built and maintained by [5050Growth](https://5050growth.com), an [Attio Expert](https://attio.com/experts/5050growth) consultancy.

```
┌──────────────────────────────────────────────────────────────────┐
│  /attio-audit       Score any workspace 0-100. Markdown out.     │
│  cli/attio          Multi-workspace wrapper for attio-pp-cli.    │
└──────────────────────────────────────────────────────────────────┘
```

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Built by 5050Growth](https://img.shields.io/badge/built_by-5050Growth-black)](https://5050growth.com)

---

## Why this exists

If you sell to or build for companies on Attio, you eventually run into the same set of questions:

1. Is this workspace actually clean, or is the team about to migrate junk into a fresh CRM?
2. How do I run quick API checks across five client workspaces without juggling tokens?
3. Can my Claude Code agent talk to Attio without burning 5,000 tokens per call?

This toolkit answers those three questions. Read-only, terminal-first, agent-friendly. No SaaS subscription, no dashboards, no signup.

Built for **founders, RevOps engineers, and Attio consultants** who'd rather run a script than buy another tool.

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

Output looks like this:

```
# Attio Audit: ACME Corp

**Workspace:** `acme` · **Run:** 2026-05-08 14:22

## Grade: 73/100 (C)

`██████████████████████████████░░░░░░░░░░`

### Data quality: 22/30
- 87% of People have an email (174/200 sample): 10/10
- 64% of Companies have a domain (128/200 sample): 7/10
- 71% of People have an owner attribute on the record itself: 5/10

### Schema hygiene: 18/25
- 6 total objects (2 custom)
- Avg 24 attrs/object, max 38: 15/15
- No object exceeds 50 attributes: 10/10

### Lists: 13/20
- 18 lists in workspace
- 60% of sampled lists have at least one entry: 7/10
- List sprawl (consider archiving): 6/10

### Activity: 20/25
- 4 workspace members: 10/10
- 12% of sampled People created in last 30d: 10/15

## Where to focus
1. Lists (7 points available)
2. Schema hygiene (7 points available)
3. Data quality (8 points available)
```

Full skill docs: [skills/attio-audit/SKILL.md](skills/attio-audit/SKILL.md).

### `cli/attio`: Multi-workspace CLI wrapper

A 75-line Python wrapper around [Printing Press](https://printingpress.dev)'s generated `attio-pp-cli` Go binary. The Go CLI is great (150+ subcommands, FTS5-powered local SQLite mirror, agent-friendly flags). The wrapper adds the one thing the upstream binary doesn't have natively: **first-class multi-workspace support**.

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

## Quick start (audit only, no CLI dependency)

```bash
git clone https://github.com/NachoLafuente/attio-toolkit.git
cd attio-toolkit
pip install -r requirements.txt
ATTIO_API_KEY=<your-attio-token> python skills/attio-audit/audit.py
```

That's it. The audit needs nothing but Python 3.10+ and the `requests` library.

---

## Quick start (with the CLI wrapper)

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

Hi, I'm [Nacho](https://www.linkedin.com/in/nacholafuente/). I run [5050Growth](https://5050growth.com), a small [Attio Expert](https://attio.com/experts/5050growth) consultancy. We help founders, VCs, and SaaS teams migrate to Attio cleanly, build the integrations the workspace needs to actually run, and turn the CRM into something the team trusts. Past work includes VC funds, gym SaaS, UHNW networks, and energy suppliers.

This repo is the productized version of work we do on real client engagements. The audit is the same diagnostic we run on day zero of a new migration. The CLI is what we use across our own client work to keep multi-tenant Attio operations sane.

### Need help with your GTM Attio setup?

Book time with me directly: [calendar.notion.so/meet/nacholafuentemoreno/gtm-expert](https://calendar.notion.so/meet/nacholafuentemoreno/gtm-expert)

Or drop a line at [nacho@5050growth.com](mailto:nacho@5050growth.com).

### Liked the toolkit?

If it saved you time, [leave a review on the Attio Experts directory](https://attio.com/experts/5050growth/review). Two minutes of your day, real fuel for ours.

---

## Contributing

Issues and PRs welcome. Two ground rules:

1. **No client data in tests or examples.** Use the synthetic Attio sandbox or hash anything before committing.
2. **Read-only by default.** New skills should default to making no writes. If a skill needs to write, gate it behind an explicit `--write` flag and a confirmation prompt.

## License

MIT. See [LICENSE](LICENSE).

## Credits

The CLI binary is generated by [Printing Press](https://printingpress.dev) (`mvanhorn/cli-printing-press`). The wrapper, the audit, and the multi-workspace pattern are 5050Growth's contributions.
