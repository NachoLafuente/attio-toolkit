# Security and trust

This toolkit reads from your Attio workspace using your API token. Here's what to expect.

## Read-only by default

Every shipping skill makes only `GET` requests and `POST` query requests (where Attio's API requires a POST body for filtered reads). None of the skills:

- write, update, or delete any record
- modify schema or attributes
- archive, merge, or move records
- send notifications or webhooks
- enroll records into automations

If you grep `requests.request` in any script, you'll find only `"GET"` and `"POST"` for query endpoints (`/records/query`, `/entries/query`).

## Token handling

- The toolkit reads tokens from one of: `--token` flag, `ATTIO_API_KEY` env var, `ATTIO_OAUTH2` env var, or a project-local `.env` file the wrapper discovers from the current working directory.
- Tokens are passed as `Authorization: Bearer <token>` to `https://api.attio.com/v2/` only.
- Tokens are never logged, written to disk by the toolkit, or transmitted to any host other than `api.attio.com`.
- The wrapper sets a per-workspace `HOME=~/.attio-cli-ws/<workspace>` for the underlying Go binary so each tenant's local cache is isolated. Tokens are not persisted there by these skills (the underlying `attio-pp-cli` may persist OAuth state if you opt in via `attio-pp-cli auth login`; see its own docs).

## .env safety

Use a project-local `.env` file with permissions `chmod 600 .env`. Make sure your `.gitignore` excludes it. The shipped `.gitignore` does this by default.

If your `.env` ever ends up in git history, rotate every key in it (Attio dashboard, Settings, API tokens, "revoke and regenerate"). Tokens stay valid even after deletion from the file.

## Synthetic data only in this repo

No real client data appears in:

- example reports under `examples/`
- test fixtures
- README screenshots

Workspace names, record names, and IDs in any committed example are synthetic. If you spot otherwise, [open an issue](https://github.com/NachoLafuente/attio-toolkit/issues) and it'll be redacted.

## Reporting a security issue

If you find a way to use this toolkit to write data, leak tokens, or escalate access, do not file a public issue. Email [nacho@5050growth.com](mailto:nacho@5050growth.com) with details. Expect a reply within two business days.

## Required scopes

Some skills degrade gracefully when the token lacks a particular scope. Recommended scopes for full functionality:

- `record_permission:read`
- `object_configuration:read`
- `list_configuration:read`
- `list_entry:read`
- `user_management:read` (for cost-explorer's seat count and audit's workspace member check)
- `webhook:read` (only if you plan to extend the toolkit; not used today)

If a scope is missing, the affected check is skipped and the report says so explicitly.
