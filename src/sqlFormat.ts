/** SQL literal / identifier formatting, shared by the result views, the store
 *  and the INSERT generator so escaping rules live in exactly one place. */
import type { DbType } from "./types";

export type SqlValue = string | number | boolean | null | undefined;

/**
 * Engine of the open project. Module state rather than a parameter because
 * generated SQL (row actions, INSERT generation…) is built in many places and
 * there is exactly one active connection; the store keeps it in sync
 * (`setSqlDialect`).
 */
let dialect: DbType = "sqlite";

export function setSqlDialect(engine: DbType) {
  dialect = engine;
}

/** Quote an identifier for the active engine: backticks for MySQL (double
 *  quotes are string literals there unless ANSI_QUOTES is on), double quotes
 *  elsewhere; embedded quote characters are doubled. */
export function quoteIdent(name: string): string {
  if (dialect === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** `schema.table`, each part quoted; unqualified when there is no schema. */
export function qualifiedName(name: string, schema?: string): string {
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);
}

/** Render a value as a SQL literal (single quotes escaped by doubling). */
export function sqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  // Postgres booleans reject 1/0; SQLite and MySQL store them as integers.
  if (typeof v === "boolean") return dialect === "postgres" ? String(v).toUpperCase() : v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** `ident = literal`, or `ident IS NULL` for a null value — `= NULL` never
 *  matches in SQL. */
export function sqlEquals(ident: string, v: SqlValue): string {
  return v === null || v === undefined
    ? `${quoteIdent(ident)} IS NULL`
    : `${quoteIdent(ident)} = ${sqlLiteral(v)}`;
}
