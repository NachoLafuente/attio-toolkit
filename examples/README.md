# Examples

Sanitized example reports the toolkit produces on three representative workspace shapes. All workspace names, record names, and IDs here are synthetic. No real client data appears in this directory.

## What's here

| Scenario | Audit grade | What it represents |
|----------|-------------|--------------------|
| [clean-workspace/](clean-workspace/) | 91/100 (A) | Well-maintained workspace, healthy ops, recent records, sane schema. The "what good looks like" reference. |
| [messy-migration/](messy-migration/) | 64/100 (D) | Recently migrated from another CRM. Records came over but most are untouched. Lots of stale data. |
| [bloated-schema/](bloated-schema/) | 71/100 (C) | Workspace that's grown organically for years. Schema sprawl, custom attributes nobody fills in. |

## How to read these

Each directory contains 2 example outputs from different skills, showing the toolkit's chat-friendly markdown format. If a scenario matches what you're seeing in your own workspace, run the relevant skill against your token to get your own report.

If you want a hand interpreting the results or a plan to fix what they surface, [book a consult](https://calendar.notion.so/meet/nacholafuentemoreno/gtm-expert).
