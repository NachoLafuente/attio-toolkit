# attio-cli (multi-workspace wrapper)

A thin Python wrapper around `attio-pp-cli` (a Go CLI generated from Attio's official OpenAPI spec by [Printing Press](https://printingpress.dev)). Adds first-class multi-workspace support, which the underlying single-tenant binary does not have.

## Why this wrapper exists

The Printing Press generated Attio CLI is excellent: 150+ subcommands, a local SQLite mirror with FTS5 search, agent-friendly JSON output, profiles. But it assumes one CLI install per workspace.

If you run an Attio consultancy or manage multiple Attio tenants, you likely have keys for many workspaces. This wrapper:

1. Reads `ATTIO_API_KEY_<WORKSPACE>` from a project `.env` file
2. Routes the call to the right key based on `--ws <name>`
3. Isolates each workspace's local SQLite cache, sync state, and profile config under `~/.attio-cli-ws/<workspace>/` so workspaces never cross-contaminate

## Install

You need `attio-pp-cli` installed at `~/.local/bin/attio-pp-cli`. Get it via Printing Press:

```bash
# Install the Printing Press generator (requires Go 1.26.3+)
go install github.com/mvanhorn/cli-printing-press/v4/cmd/printing-press@latest

# Generate the Attio CLI from the official OpenAPI spec
printing-press generate \
  --spec https://api.attio.com/openapi/api \
  --spec https://api.attio.com/openapi/standard-objects \
  --name attio --spec-source official --force --lenient --validate=false

# Build and install the binary
cd ~/printing-press/library/attio
go build -o ~/.local/bin/attio-pp-cli ./cmd/attio-pp-cli
```

Then drop the wrapper into your project:

```bash
curl -fsSL https://raw.githubusercontent.com/NachoLafuente/attio-toolkit/main/cli/attio -o ./attio
chmod +x ./attio
```

## .env layout

Add one line per workspace to your project `.env`:

```ini
ATTIO_API_KEY_COMPANY1=<token>
ATTIO_API_KEY_COMPANY2=<token>
ATTIO_API_KEY_COMPANY3=<token>
```

The wrapper resolves `--ws company1` to `ATTIO_API_KEY_COMPANY1`.

## Usage

```bash
./attio ws list                              # list known workspaces from .env
./attio --ws company1 self --agent           # auth check + workspace metadata
./attio --ws company2 lists list             # list all lists
./attio --ws company3 sync                   # sync workspace to local SQLite
./attio --ws company1 search "acme"          # FTS5 search over synced data
./attio --ws company2 --help                 # full attio-pp-cli help
```

Anything after `--ws <name>` is passed straight through to `attio-pp-cli`.

## Recommended flags

The underlying binary has a `--agent` flag that sets every agent-friendly default in one shot (`--json --compact --no-input --no-color --yes`). Use it when piping output to scripts or LLMs:

```bash
./attio --ws company1 lists list --agent | jq '.results.data[].name'
```

## Per-workspace state

Each workspace has its own local data directory:

```
~/.attio-cli-ws/company1/.local/share/attio-pp-cli/data.db   # Company 1 cache + sync state
~/.attio-cli-ws/company2/.local/share/attio-pp-cli/data.db   # Company 2 cache + sync state
```

Mechanism: the wrapper sets `HOME=~/.attio-cli-ws/<workspace>` for the subprocess only. Side-effect: profiles, feedback logs, and config files are also per-workspace. That's intentional.

## Troubleshooting

- **"command not found"**: make sure `~/.local/bin` is on your `$PATH` or set `ATTIO_PP_CLI_PATH=/full/path/to/attio-pp-cli`
- **Auth failure**: run `./attio --ws <name> auth status` to see which token the binary received
- **Stale cache showing wrong workspace**: confirm `~/.attio-cli-ws/<workspace>/.local/share/attio-pp-cli/` exists; if not, the wrapper isn't isolating correctly. File an issue.

## Why not just use the official Attio TypeScript SDK?

The SDK is great for app development. The CLI is for one-shot queries, terminal workflows, and agent-driven automation, where shelling out beats spinning up a TypeScript runtime each call.
