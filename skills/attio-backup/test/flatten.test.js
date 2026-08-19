import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenValue, flattenValues, flattenRecord, entityId } from "../src/flatten.js";

const v = (attribute_type, extra) => ({ attribute_type, active_until: null, ...extra });

test("flattenValue covers every output-value type in the v2 spec", () => {
  const cases = [
    [v("text", { value: "hi" }), "hi"],
    [v("number", { value: 42 }), "42"],
    [v("rating", { value: 5 }), "5"],
    [v("date", { value: "2026-01-01" }), "2026-01-01"],
    [v("timestamp", { value: "2026-01-01T00:00:00Z" }), "2026-01-01T00:00:00Z"],
    [v("checkbox", { value: true }), "true"],
    [v("checkbox", { value: false }), "false"],
    [v("currency", { currency_value: 1000, currency_code: "EUR" }), "1000 EUR"],
    [v("select", { option: { title: "Enterprise" } }), "Enterprise"],
    [v("status", { status: { title: "Won" } }), "Won"],
    [v("personal-name", { first_name: "Ada", last_name: "L", full_name: "Ada L" }), "Ada L"],
    [v("personal-name", { first_name: "Ada", last_name: "L" }), "Ada L"],
    [v("email-address", { email_address: "a@b.com" }), "a@b.com"],
    [v("phone-number", { phone_number: "+49123" }), "+49123"],
    [v("domain", { domain: "acme.de" }), "acme.de"],
    [v("record-reference", { target_object: "people", target_record_id: "r1" }), "people:r1"],
    [v("actor-reference", { referenced_actor_type: "workspace-member", referenced_actor_id: "wm1" }), "workspace-member:wm1"],
    [v("location", { line_1: "Str 1", locality: "Berlin", country_code: "DE" }), "Str 1, Berlin, DE"],
    [v("interaction", { interaction_type: "email", interacted_at: "2026-01-01" }), "email @ 2026-01-01"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(flattenValue(input), expected, `type ${input.attribute_type}`);
  }
});

test("flattenValue degrades gracefully on unknown and empty values", () => {
  assert.equal(flattenValue(null), "");
  assert.equal(flattenValue(undefined), "");
  assert.equal(flattenValue(v("text", { value: null })), "");
  assert.equal(flattenValue(v("select", {})), "");
  assert.equal(flattenValue(v("brand-new-type", { value: "x" })), "x");
  assert.equal(flattenValue(v("brand-new-type", { weird: 1 })), JSON.stringify(v("brand-new-type", { weird: 1 })));
});

test("flattenValues keeps only the currently active value", () => {
  const out = flattenValues({
    stage: [
      { ...v("text", { value: "old" }), active_until: "2026-02-01T00:00:00Z" },
      v("text", { value: "new" }),
    ],
  });
  assert.equal(out.stage, "new");
});

test("flattenValues joins multi-value attributes", () => {
  const out = flattenValues({
    email_addresses: [
      v("email-address", { email_address: "a@b.com" }),
      v("email-address", { email_address: "c@d.com" }),
    ],
  });
  assert.equal(out.email_addresses, "a@b.com; c@d.com");
});

test("flattenValues falls back to history when nothing is active", () => {
  const out = flattenValues({
    stage: [{ ...v("text", { value: "archived" }), active_until: "2026-02-01T00:00:00Z" }],
  });
  assert.equal(out.stage, "archived");
});

test("entityId reads every id shape Attio returns", () => {
  assert.equal(entityId({ id: { record_id: "r1" } }), "r1");
  assert.equal(entityId({ id: { entry_id: "e1" } }), "e1");
  assert.equal(entityId({ id: { note_id: "n1" } }), "n1");
  assert.equal(entityId({ id: { workspace_member_id: "wm1" } }), "wm1");
  assert.equal(entityId({ id: "plain" }), "plain");
  assert.equal(entityId({}), null);
});

test("flattenRecord puts identity columns first", () => {
  const row = flattenRecord({
    id: { record_id: "r1" },
    created_at: "2026-01-01T00:00:00Z",
    values: { name: [v("text", { value: "Acme" })] },
  });
  assert.deepEqual(Object.keys(row).slice(0, 3), ["id", "created_at", "web_url"]);
  assert.equal(row.name, "Acme");
});
