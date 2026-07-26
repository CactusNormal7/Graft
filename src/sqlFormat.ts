/** SQL literal / identifier formatting, shared by the result views, the store
 *  and the INSERT generator so escaping rules live in exactly one place. */

export type SqlValue = string | number | boolean | null | undefined;

/** Double-quote an identifier, escaping embedded quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Render a value as a SQL literal (single quotes escaped by doubling). */
export function sqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}
