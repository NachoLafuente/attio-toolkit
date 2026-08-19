# attio-schema

**See your Attio data model as a diagram, and see exactly what changed since last time.**

Attio has no ER view. If you want to know how your objects actually link, you click through settings one object at a time and hold it in your head. This draws it.

```bash
ATTIO_API_KEY=<your-token> npx -y attio-schema
```

Writes an interactive HTML diagram, a Mermaid block, and a JSON snapshot to `./attio-schema/<timestamp>/`.

## What you get

| File | What it is |
|---|---|
| `schema.html` | Interactive diagram. Pan, zoom, hover to highlight a node's neighbours, filter by name. Opens offline. |
| `schema.svg` | The same drawing as a standalone vector, for slides, proposals and PDFs. |
| `schema.mmd` | A Mermaid ER block. Paste into GitHub, Obsidian or Notion and it renders. |
| `schema.json` | The normalised model. This is what `diff` compares. |

## Reading it

- **Solid line** — a real two-way Attio Relationship. Both objects carry a linked attribute.
- **Dashed line** — a one-way record-reference. Only the source object knows about it, and Attio's UI will not show a linked-records tab on the other side.
- **`1` / `N`** — how many records sit on that end.
- **`?`** — unknown. A one-way reference tells you nothing about the far side.
- **Dashed card** — a list rather than an object.
- **`*`** — required field.

The one-way versus two-way distinction is usually the most useful thing on the page. It is the standard explanation for "why can't I see the linked records from this side".

## What changed

```bash
npx -y attio-schema diff
```

Compares the two most recent snapshots and renders the change onto the diagram: added green, removed red, changed amber.

Entities are matched on their Attio UUID, not their slug, so a rename shows up as a rename rather than as a delete plus an add. It also catches the quiet ones: a field's type changing, a required flag flipping, or a two-way Relationship being downgraded to a one-way reference.

## Publishing a diagram safely

```bash
ATTIO_API_KEY=<your-token> npx -y attio-schema --anonymize
```

Strips the workspace name and id, and replaces every object, list and field name with a stable pseudonym derived from its UUID. The shape of your data model survives; nothing that names a customer, a deal stage or a business does. Snapshots taken this way still diff against each other.

## Safety

- **Schema only.** The only endpoints touched are `/v2/self`, `/v2/objects`, `/v2/lists` and `/v2/objects/:slug/attributes`. No record endpoint is ever called, so customer data cannot reach the output. A test asserts it.
- **Read-only.** There is no write verb anywhere in the code path.
- **The HTML makes no network requests.** No CDN, no fonts, no analytics, no phoning home. It works offline and is safe to send to a client. A test asserts that too.

## Options

```
--out <dir>          Output directory              (default ./attio-schema)
--format <list>      html,svg,mermaid,json         (default html,mermaid,json)
--anonymize          Strip identity and names, keep structure
--no-lists           Objects only, omit lists
--max-rows <n>       Fields shown per card         (default 8)
--seed <n>           Layout seed, change to reshuffle  (default 1)
--quiet              Only print errors
```

The layout is computed at generation time, not in the browser, and it is deterministic. The same schema and seed always draw the same picture, so a diagram embedded in a document will not reshuffle itself when you regenerate it.

## Cost

Three calls plus one per object. A typical workspace is 5 to 15 requests and takes a couple of seconds. There are no records to paginate.

## Requirements

Node 18.17 or newer. No dependencies.

## License

MIT. Part of [attio-toolkit](https://github.com/NachoLafuente/attio-toolkit) by [5050Growth](https://5050growth.com).
