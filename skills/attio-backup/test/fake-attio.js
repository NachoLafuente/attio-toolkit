/**
 * A fake Attio API. Lets the whole backup path be tested end to end with no
 * network and no real workspace.
 */

const val = (attribute_type, extra) => ({
  active_from: "2026-01-01T00:00:00.000Z",
  active_until: null,
  ...extra,
  attribute_type,
});

export function makeWorkspace(overrides = {}) {
  return {
    companies: [
      {
        id: { workspace_id: "ws1", object_id: "obj-co", record_id: "rec-co-1" },
        created_at: "2026-01-01T00:00:00.000Z",
        values: {
          name: [val("text", { value: "Acme GmbH" })],
          domains: [val("domain", { domain: "acme.de", root_domain: "acme.de" })],
          arr: [val("currency", { currency_value: 120000, currency_code: "EUR" })],
          stage: [val("status", { status: { id: {}, title: "Lead" } })],
          owner: [
            val("actor-reference", {
              referenced_actor_type: "workspace-member",
              referenced_actor_id: "wm-1",
              name: "Nacho",
            }),
          ],
          // A superseded value that must not leak into the flattened output.
          notes_field: [
            { ...val("text", { value: "old" }), active_until: "2026-02-01T00:00:00.000Z" },
            val("text", { value: "current" }),
          ],
        },
      },
      {
        id: { workspace_id: "ws1", object_id: "obj-co", record_id: "rec-co-2" },
        created_at: "2026-01-02T00:00:00.000Z",
        values: { name: [val("text", { value: "Zombie Corp" })] },
      },
    ],
    people: [
      {
        id: { workspace_id: "ws1", object_id: "obj-pe", record_id: "rec-pe-1" },
        created_at: "2026-01-03T00:00:00.000Z",
        values: {
          name: [val("personal-name", { first_name: "Ada", last_name: "Lovelace", full_name: "Ada Lovelace" })],
          email_addresses: [val("email-address", { email_address: "ada@acme.de" })],
        },
      },
    ],
    notes: [
      {
        id: { note_id: "note-1" },
        title: "Disco call",
        parent_object: "companies",
        parent_record_id: "rec-co-1",
        created_at: "2026-01-04T00:00:00.000Z",
        content_plaintext: "They want, a CSV\nwith \"quotes\"",
      },
    ],
    ...overrides,
  };
}

export function makeFetch(workspace, { failing = ["/v2/emails"] } = {}) {
  return async function fakeFetch(url, init = {}) {
    const u = typeof url === "string" ? new URL(url) : url;
    const p = u.pathname;
    const q = u.searchParams;
    const body = init.body ? JSON.parse(init.body) : {};

    if (failing.includes(p)) return json({ error: "insufficient scope" }, 403);

    const offsetPage = (rows) => {
      const limit = Number(body.limit ?? q.get("limit") ?? 500);
      const offset = Number(body.offset ?? q.get("offset") ?? 0);
      return json({ data: rows.slice(offset, offset + limit) });
    };
    const cursorPage = (rows) => json({ data: rows, pagination: { next_cursor: null } });

    if (p === "/v2/self")
      return json({ data: { workspace_id: "ws1", workspace_name: "Test Workspace" } });

    if (p === "/v2/objects")
      return json({
        data: [
          { id: { object_id: "obj-co" }, api_slug: "companies", plural_noun: "Companies" },
          { id: { object_id: "obj-pe" }, api_slug: "people", plural_noun: "People" },
        ],
      });

    if (p === "/v2/lists")
      return json({ data: [{ id: { list_id: "list-1" }, api_slug: "pipeline", name: "Pipeline" }] });

    if (p === "/v2/workspace_members")
      return json({ data: [{ id: { workspace_member_id: "wm-1" }, email_address: "nacho@example.com" }] });

    if (p === "/v2/webhooks") return offsetPage([]);

    let m;
    if ((m = p.match(/^\/v2\/(objects|lists)\/([^/]+)\/attributes$/))) {
      return offsetPage([
        { id: { attribute_id: "attr-1" }, api_slug: "name", title: "Name", type: "text" },
        { id: { attribute_id: "attr-2" }, api_slug: "stage", title: "Stage", type: "status" },
      ]);
    }
    if ((m = p.match(/^\/v2\/(objects|lists)\/([^/]+)\/attributes\/([^/]+)\/(options|statuses)$/))) {
      return json({ data: [{ id: {}, title: "Lead" }, { id: {}, title: "Qualified" }] });
    }
    if ((m = p.match(/^\/v2\/(objects|lists)\/([^/]+)\/views$/))) {
      return cursorPage([{ id: { view_id: "view-1" }, name: "All records" }]);
    }
    if ((m = p.match(/^\/v2\/objects\/([^/]+)\/records\/query$/))) {
      return offsetPage(workspace[m[1]] ?? []);
    }
    if ((m = p.match(/^\/v2\/lists\/([^/]+)\/entries\/query$/))) {
      return offsetPage([
        {
          id: { entry_id: "entry-1" },
          parent_object: "companies",
          parent_record_id: "rec-co-1",
          created_at: "2026-01-05T00:00:00.000Z",
          entry_values: { stage: [val("status", { status: { title: "Lead" } })] },
        },
      ]);
    }

    if (p === "/v2/notes") return offsetPage(workspace.notes ?? []);
    if (p === "/v2/tasks") return offsetPage([]);
    if (p === "/v2/threads") return offsetPage([]);
    if (p === "/v2/meetings") return cursorPage([]);
    if (p === "/v2/emails") return cursorPage([]);

    return json({ error: "not found" }, 404);
  };
}

function json(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}
