/** RFC 4180 CSV writer. Union of all row keys becomes the header. */

export function toCsv(rows, { columns } = {}) {
  if (!rows || rows.length === 0) return "";

  const header = columns ?? unionKeys(rows);
  const lines = [header.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(header.map((k) => escapeCell(row[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

function unionKeys(rows) {
  // Insertion order matters: id/created_at land first because flattenRecord
  // puts them first on every row.
  const seen = new Set();
  for (const row of rows) for (const k of Object.keys(row)) seen.add(k);
  return [...seen];
}

export function escapeCell(value) {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection on untrusted CRM text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
