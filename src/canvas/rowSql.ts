/**
 * SQL for row-level actions on a result (UPDATE / DELETE / duplicate / open).
 *
 * These statements touch real data, so the target must be unambiguous: the
 * result has to map to exactly one table (every result column belongs to it)
 * and include that table's full primary key. Anything less — a join, a
 * computed column, a table without a declared primary key — yields a reason
 * instead of a guess. The generated SQL is opened in a new block for review;
 * nothing is executed here.
 *
 * Pure module: no React, no store, no Tauri.
 */
import type { DbSchema, TableInfo } from "../types";
import { quoteIdent, sqlEquals, sqlLiteral } from "../sqlFormat";
import type { Cell } from "./resultShape";

/** The table a result's rows can be written back to. */
export interface RowTarget {
  table: string;
  /** Result column indexes forming the primary key (in key order). */
  keyIndexes: number[];
  /** Single `INTEGER PRIMARY KEY` (rowid alias): the database assigns it. */
  generatedKey: boolean;
}

export type RowTargetResult =
  | { ok: true; target: RowTarget }
  | { ok: false; reason: string };

const lower = (s: string) => s.toLowerCase();

/** Resolve the single table `columns` (a result's columns) come from. */
export function resolveRowTarget(columns: string[], schema: DbSchema): RowTargetResult {
  if (columns.length === 0) return { ok: false, reason: "The result has no columns." };
  const names = columns.map(lower);
  if (new Set(names).size !== names.length) {
    return { ok: false, reason: "The result has duplicate column names." };
  }

  const candidates = schema.filter(
    (t) =>
      t.kind === "table" &&
      names.every((n) => t.columns.some((c) => lower(c.name) === n)),
  );
  if (candidates.length === 0) {
    return { ok: false, reason: "The result doesn't map to a single table." };
  }
  // Several tables can contain the selected columns; prefer the one with
  // exactly these columns, and refuse to guess between equals.
  const exact = candidates.filter((t) => t.columns.length === columns.length);
  const pool = exact.length > 0 ? exact : candidates;
  if (pool.length > 1) {
    const list = pool.map((t) => t.name).join(", ");
    return { ok: false, reason: `Ambiguous target table (${list}).` };
  }
  return targetFor(pool[0], names);
}

function targetFor(table: TableInfo, names: string[]): RowTargetResult {
  const pk = table.columns.filter((c) => c.pk);
  if (pk.length === 0) {
    return { ok: false, reason: `"${table.name}" has no declared primary key.` };
  }
  const keyIndexes = pk.map((c) => names.indexOf(lower(c.name)));
  if (keyIndexes.some((i) => i < 0)) {
    const key = pk.map((c) => c.name).join(", ");
    return { ok: false, reason: `Select the primary key (${key}) to act on rows.` };
  }
  const generatedKey = pk.length === 1 && lower(pk[0].data_type) === "integer";
  return { ok: true, target: { table: table.name, keyIndexes, generatedKey } };
}

/** `WHERE` condition identifying `row` by its primary key. */
export function rowKeyCondition(target: RowTarget, row: Cell[], columns: string[]): string {
  return target.keyIndexes.map((i) => sqlEquals(columns[i], row[i])).join(" AND ");
}

export function isKeyColumn(target: RowTarget, columnIndex: number): boolean {
  return target.keyIndexes.includes(columnIndex);
}

const REVIEW = "-- Generated from a result row: review before running.\n";

export function selectRowSql(target: RowTarget, row: Cell[], columns: string[]): string {
  return `SELECT * FROM ${quoteIdent(target.table)} WHERE ${rowKeyCondition(target, row, columns)};`;
}

export function updateCellSql(
  target: RowTarget,
  row: Cell[],
  columns: string[],
  columnIndex: number,
  value: Cell,
): string {
  return (
    REVIEW +
    `UPDATE ${quoteIdent(target.table)} SET ${quoteIdent(columns[columnIndex])} = ${sqlLiteral(value)}` +
    ` WHERE ${rowKeyCondition(target, row, columns)};\n`
  );
}

export function deleteRowSql(target: RowTarget, row: Cell[], columns: string[]): string {
  return (
    REVIEW +
    `DELETE FROM ${quoteIdent(target.table)} WHERE ${rowKeyCondition(target, row, columns)};\n`
  );
}

/** INSERT of a copy of `row`. A generated key is left out so the database
 *  assigns a fresh one; any other key is kept and must be edited by hand. */
export function duplicateRowSql(target: RowTarget, row: Cell[], columns: string[]): string {
  const keep = columns
    .map((_, i) => i)
    .filter((i) => !(target.generatedKey && isKeyColumn(target, i)));
  const note = target.generatedKey
    ? ""
    : "-- The primary key is copied as-is: change it before running.\n";
  const cols = keep.map((i) => quoteIdent(columns[i])).join(", ");
  const vals = keep.map((i) => sqlLiteral(row[i])).join(", ");
  const insert =
    keep.length === 0
      ? `INSERT INTO ${quoteIdent(target.table)} DEFAULT VALUES;`
      : `INSERT INTO ${quoteIdent(target.table)} (${cols}) VALUES (${vals});`;
  return REVIEW + note + insert + "\n";
}
