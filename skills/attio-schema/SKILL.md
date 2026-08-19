---
name: attio-schema
description: Draw an Attio workspace data model as an ER diagram (SVG, interactive HTML, or Mermaid) and diff two schema snapshots to see exactly what changed. Use when the user asks to "show me my Attio schema", "diagram my CRM", "what does my data model look like", "what changed in my workspace", "ER diagram for Attio", or wants to visualise objects, attributes and relationships. Read-only, schema only, never reads records. Typically 5-15 API calls.
license: MIT
author: 5050Growth
---

# attio-schema

Turn an Attio workspace into a picture of its data model, and diff two pictures.

## When to use this skill

- Someone wants to see how their Attio workspace is actually wired: which objects exist, how they link, which fields are on each.
- Someone asks what changed in a workspace between two points in time.
- You are about to advise on a schema change and want the current state in front of you first.
- Someone wants a diagram to put in a document, a proposal, or a README.

Do NOT use this skill for:
- Data quality or hygiene scoring (use `attio-audit`)
- Finding unused fields (use `attio-attribute-coverage`)
- Backing up records (use `attio-backup`)

## Safety properties worth stating out loud

- **Schema only.** The tool calls `/v2/self`, `/v2/objects`, `/v2/lists` and `/v2/objects/:slug/attributes`. It never calls a record endpoint, so no customer data can appear in the output. There is a test that asserts this.
- **Read-only.** No POST, PATCH, PUT or DELETE anywhere in the code path.
- **No network in the output.** The generated HTML makes zero external requests. No CDN, no fonts, no analytics. It opens offline and is safe to email to a client. There is a test that asserts this too.
- **`--anonymize`** strips the workspace name and id and replaces every object, list and field name with a stable pseudonym derived from its UUID. Structure survives, names do not. Use it before posting a diagram publicly.

## Inputs

An Attio API token, resolved in this order:
1. `--key <value>`
2. `ATTIO_API_KEY`
3. `ATTIO_OAUTH2`

Read scopes are enough. If none are set, ask the user for the token before running.

## How to run

```bash
# Snapshot and render (html + mermaid + json by default)
ATTIO_API_KEY=<token> npx -y attio-schema

# Just the Mermaid block, to paste into a README or Obsidian note
ATTIO_API_KEY=<token> npx -y attio-schema --format mermaid

# A standalone SVG for a proposal or slide
ATTIO_API_KEY=<token> npx -y attio-schema --format svg

# Safe to publish: no workspace name, no field names
ATTIO_API_KEY=<token> npx -y attio-schema --anonymize

# What changed since the last snapshot
npx -y attio-schema diff
```

Output lands in `./attio-schema/<timestamp>/` by default. Change it with `--out`.

## Reading the diagram

| Element | Meaning |
|---|---|
| Solid line | A true two-way Attio Relationship. Both objects carry a linked attribute. |
| Dashed line | A one-way record-reference. Only the source object knows about the link. |
| `1` / `N` badge | How many records sit on that end of the line. |
| `?` badge | Unknown. One-way references say nothing about the far side. |
| Dashed card border | A list, not an object. |
| `*` after a field | Required. |
| `32f` in the header | Total field count, including system fields not listed on the card. |

The one-way versus two-way distinction is the useful one. A one-way reference will not render as a tab on the other object's record page in the Attio UI, which is a common cause of "why can't I see the linked records from this side".

## Interpreting the result for a user

Things worth flagging when you see them:

- **Unlinked objects.** An object with no relationships is usually either a leftover from an import or a design mistake. The CLI reports the count.
- **A high one-way count.** Suggests the schema was built through the API rather than the UI, and record pages will feel disconnected.
- **`?` badges everywhere.** Same signal as above.
- **Very wide cards** (many fields) on an object with few relationships. Often a spreadsheet that was pasted into the CRM rather than modelled.

## Options

| Flag | Effect |
|---|---|
| `--out <dir>` | Output directory (default `./attio-schema`) |
| `--format <list>` | `html,svg,mermaid,json` (default `html,mermaid,json`) |
| `--anonymize` | Strip identity and names, keep structure |
| `--no-lists` | Objects only |
| `--max-rows <n>` | Fields shown per card (default 8) |
| `--seed <n>` | Layout seed. Change it if the arrangement is awkward. |
| `--quiet` | Errors only |

The layout is deterministic: the same schema and seed always produce the same picture, so a diagram in a document will not reshuffle when regenerated.

## Diffing

`diff` matches entities on their Attio UUID rather than their slug, so a rename is reported as a rename instead of as a delete plus an add. That distinction matters: "someone renamed `deal_stage`" and "someone deleted `deal_stage` and made a new field" are very different incidents.

It reports added, removed and renamed objects, lists and fields; type, required, unique and multi-value changes; and relationship shape changes, including a two-way Relationship being downgraded to a one-way reference, which silently breaks the reciprocal view in the UI.

The diff renders on the graph: added green, removed red, changed amber.

## Cost

One call each for `/v2/self`, `/v2/objects` and `/v2/lists`, plus one per object for attributes. A typical workspace is 5 to 15 calls and finishes in a couple of seconds. There is no record pagination because there are no records.
