/**
 * Turn Attio's nested value objects into flat scalars for CSV and diffing.
 *
 * Every attribute on a record is an array of historical values. Only entries
 * with `active_until === null` are current, so a naive flatten shows stale data.
 * Covers all 17 value types in the v2 OpenAPI `output-value` union.
 */

/** Reduce one Attio value object to a readable scalar string. */
export function flattenValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v);

  switch (v.attribute_type) {
    case "text":
    case "number":
    case "rating":
    case "date":
    case "timestamp":
      return v.value === null || v.value === undefined ? "" : String(v.value);

    case "checkbox":
      return v.value ? "true" : "false";

    case "currency":
      return v.currency_value === null || v.currency_value === undefined
        ? ""
        : [v.currency_value, v.currency_code].filter(Boolean).join(" ");

    case "select":
      return v.option?.title ?? "";

    case "status":
      return v.status?.title ?? "";

    case "personal-name":
      return v.full_name || [v.first_name, v.last_name].filter(Boolean).join(" ");

    case "email-address":
      return v.email_address ?? v.original_email_address ?? "";

    case "phone-number":
      return v.phone_number ?? v.original_phone_number ?? "";

    case "domain":
      return v.domain ?? v.root_domain ?? "";

    case "record-reference":
      // Keep the object so a diff shows which record the link moved to.
      return v.target_record_id
        ? `${v.target_object ?? "record"}:${v.target_record_id}`
        : "";

    case "actor-reference":
      return (
        v.name ||
        v.email_address ||
        (v.referenced_actor_id
          ? `${v.referenced_actor_type ?? "actor"}:${v.referenced_actor_id}`
          : "")
      );

    case "location":
      return [
        v.line_1,
        v.line_2,
        v.line_3,
        v.line_4,
        v.locality,
        v.region,
        v.postcode,
        v.country_code,
      ]
        .filter(Boolean)
        .join(", ");

    case "interaction":
      return [v.interaction_type, v.interacted_at].filter(Boolean).join(" @ ");

    default:
      // Unknown or newly added type: fall back to something legible rather
      // than dropping the data on the floor.
      if ("value" in v) return v.value === null ? "" : String(v.value);
      return JSON.stringify(v);
  }
}

/**
 * Flatten a record's `values` map to `{ attribute_slug: "scalar" }`.
 * Multi-select and multi-value attributes join with "; ".
 */
export function flattenValues(values, { multiSeparator = "; " } = {}) {
  const out = {};
  for (const [slug, entries] of Object.entries(values || {})) {
    const list = Array.isArray(entries) ? entries : [entries];
    const active = list.filter(
      (e) => e && (e.active_until === null || e.active_until === undefined),
    );
    const source = active.length ? active : list;
    const parts = source.map(flattenValue).filter((s) => s !== "");
    out[slug] = parts.join(multiSeparator);
  }
  return out;
}

/** Pull the stable id out of any Attio entity (record, entry, note, task...). */
export function entityId(entity) {
  const id = entity?.id;
  if (!id) return null;
  if (typeof id === "string") return id;
  return (
    id.record_id ??
    id.entry_id ??
    id.note_id ??
    id.task_id ??
    id.list_id ??
    id.object_id ??
    id.attribute_id ??
    id.workspace_member_id ??
    id.email_id ??
    id.meeting_id ??
    id.thread_id ??
    id.comment_id ??
    id.view_id ??
    id.webhook_id ??
    null
  );
}

/** Flatten a record into one CSV-ready row, id and timestamps first. */
export function flattenRecord(record) {
  return {
    id: entityId(record),
    created_at: record?.created_at ?? "",
    web_url: record?.web_url ?? "",
    ...flattenValues(record?.values),
  };
}
