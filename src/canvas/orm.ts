/**
 * Relational (ORM-ish) bridge: nested data ⇄ multi-table INSERT statements.
 *
 * The JSON/nested view is treated as a real data source. A join result — or an
 * imported nested JSON document — is mapped back onto the actual tables using
 * the cached database schema (columns + foreign keys, see `store.dbSchema`), so
 * one document can seed several related tables in one go.
 *
 * Everything here is pure: no React, no store, no Tauri. That keeps the mapping
 * rules testable on their own.
 */
import type { DbSchema, ForeignKey, QueryResult, TableInfo } from "../types";
import { quoteIdent, sqlLiteral, type SqlValue } from "../sqlFormat";
import {
  buildNestedGroups,
  detectNestedShape,
  type Cell,
} from "./resultShape";

export interface InsertScript {
  /** The generated SQL (may be empty when nothing could be mapped). */
  sql: string;
  /** Human-readable notes: guessed tables, unmapped columns, fallbacks. */
  warnings: string[];
}

/** Minimum share of columns that must exist in a table for it to be a match. */
const MATCH_THRESHOLD = 0.6;

/**
 * Best table for a set of column names. Views are skipped (you cannot INSERT
 * into one). Returns null when nothing matches well enough — the caller then
 * emits a `«table»` placeholder rather than guessing wrong.
 */
export function matchTable(
  columns: string[],
  schema: DbSchema,
): TableInfo | null {
  if (columns.length === 0) return null;
  let best: TableInfo | null = null;
  let bestScore = 0;
  for (const table of schema) {
    if (table.kind !== "table") continue;
    const names = new Set(table.columns.map((c) => c.name.toLowerCase()));
    let hits = 0;
    for (const c of columns) if (names.has(c.toLowerCase())) hits++;
    const score = hits / columns.length;
    // Tie-break toward the narrower table: a better-fitting shape.
    if (score > bestScore) {
      bestScore = score;
      best = table;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

/** The foreign key on `child` pointing at `parent`, if any. */
export function findForeignKey(
  child: TableInfo,
  parent: TableInfo,
): ForeignKey | null {
  const target = parent.name.toLowerCase();
  return (
    child.foreign_keys.find((fk) => fk.to_table.toLowerCase() === target) ?? null
  );
}

/** Primary-key column name of a table (first one for composite keys). */
function primaryKeyOf(table: TableInfo): string | null {
  return table.columns.find((c) => c.pk)?.name ?? null;
}

/** Keep only the columns that actually exist on the target table. */
function keepKnown(
  columns: string[],
  table: TableInfo | null,
): { kept: string[]; dropped: string[] } {
  if (!table) return { kept: columns, dropped: [] };
  const names = new Set(table.columns.map((c) => c.name.toLowerCase()));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const c of columns) {
    (names.has(c.toLowerCase()) ? kept : dropped).push(c);
  }
  return { kept, dropped };
}

function insertStatement(
  tableName: string,
  columns: string[],
  values: SqlValue[],
): string {
  const cols = columns.map(quoteIdent).join(", ");
  const vals = values.map(sqlLiteral).join(", ");
  return `INSERT INTO ${quoteIdent(tableName)} (${cols}) VALUES (${vals});`;
}

/** A value that must be emitted verbatim (not quoted), e.g. last_insert_rowid(). */
const RAW = Symbol("raw");
type RawValue = { [RAW]: string };
const raw = (expr: string): RawValue => ({ [RAW]: expr });
const isRaw = (v: unknown): v is RawValue =>
  typeof v === "object" && v !== null && RAW in (v as object);

function renderValue(v: SqlValue | RawValue): string {
  return isRaw(v) ? v[RAW] : sqlLiteral(v);
}

function insertStatementRaw(
  tableName: string,
  columns: string[],
  values: Array<SqlValue | RawValue>,
): string {
  const cols = columns.map(quoteIdent).join(", ");
  const vals = values.map(renderValue).join(", ");
  return `INSERT INTO ${quoteIdent(tableName)} (${cols}) VALUES (${vals});`;
}

// ---------------------------------------------------------------------------
// Result set → INSERTs
// ---------------------------------------------------------------------------
/**
 * Turn a query result into INSERT statements. When the result has a detectable
 * parent→children join shape AND both sides map to real tables, the output is
 * relational: one parent INSERT followed by its children, with the foreign key
 * wired up. Otherwise it degrades to flat per-row INSERTs.
 */
export function generateInserts(
  result: QueryResult,
  schema: DbSchema,
): InsertScript {
  const warnings: string[] = [];
  if (result.columns.length === 0 || result.rows.length === 0) {
    return { sql: "", warnings: ["Result is empty — nothing to generate."] };
  }
  if (result.truncated) {
    warnings.push(
      `Result was truncated: only the ${result.rows.length} loaded rows are exported.`,
    );
  }

  const shape = detectNestedShape(result);

  if (shape) {
    const parentCols = shape.parentIndexes.map((i) => result.columns[i]);
    const childCols = shape.childIndexes.map((i) => result.columns[i]);
    const parentTable = matchTable(parentCols, schema);
    const childTable = matchTable(childCols, schema);

    if (parentTable && childTable) {
      const fk = findForeignKey(childTable, parentTable);
      if (!fk) {
        warnings.push(
          `No foreign key found from "${childTable.name}" to "${parentTable.name}" — child rows are inserted without linking.`,
        );
      }
      warnings.push(
        `Mapped parent → "${parentTable.name}", children → "${childTable.name}".`,
      );

      const parentKept = keepKnown(parentCols, parentTable);
      const childKept = keepKnown(childCols, childTable);
      if (parentKept.dropped.length) {
        warnings.push(
          `Ignored columns not in "${parentTable.name}": ${parentKept.dropped.join(", ")}.`,
        );
      }
      if (childKept.dropped.length) {
        warnings.push(
          `Ignored columns not in "${childTable.name}": ${childKept.dropped.join(", ")}.`,
        );
      }

      const pk = primaryKeyOf(parentTable);
      const colIndex = new Map(result.columns.map((c, i) => [c, i]));
      const groups = buildNestedGroups(result, shape);
      const out: string[] = [];

      for (const group of groups) {
        const parentValues = parentKept.kept.map(
          (c) => group.parent[colIndex.get(c)!] as SqlValue,
        );
        out.push(insertStatement(parentTable.name, parentKept.kept, parentValues));

        // Link children: prefer the parent's explicit PK value; fall back to
        // last_insert_rowid() when the key is auto-generated / not selected.
        let linkValue: SqlValue | RawValue | null = null;
        if (fk) {
          const pkCol = fk.to_column || pk;
          if (pkCol && colIndex.has(pkCol) && parentKept.kept.includes(pkCol)) {
            linkValue = group.parent[colIndex.get(pkCol)!] as SqlValue;
          } else {
            linkValue = raw("last_insert_rowid()");
          }
        }

        for (const childRow of group.children) {
          const cols = [...childKept.kept];
          const vals: Array<SqlValue | RawValue> = cols.map(
            (c) => childRow[colIndex.get(c)!] as SqlValue,
          );
          // Add the FK column when the query didn't select it.
          if (fk && !cols.some((c) => c.toLowerCase() === fk.column.toLowerCase())) {
            cols.push(fk.column);
            vals.push(linkValue);
          }
          out.push(insertStatementRaw(childTable.name, cols, vals));
        }
        out.push("");
      }

      return { sql: out.join("\n").trim() + "\n", warnings };
    }

    warnings.push(
      "Could not map both sides of the relation to tables — falling back to flat INSERTs.",
    );
  }

  // Flat fallback: every row into a single table.
  const table = matchTable(result.columns, schema);
  const name = table?.name ?? "«table»";
  if (!table) {
    warnings.push(
      "No matching table found — replace «table» with the target table name.",
    );
  } else {
    warnings.push(`Mapped rows → "${table.name}".`);
  }
  const { kept, dropped } = keepKnown(result.columns, table);
  if (dropped.length) {
    warnings.push(`Ignored columns not in "${name}": ${dropped.join(", ")}.`);
  }
  const colIndex = new Map(result.columns.map((c, i) => [c, i]));
  const out = result.rows.map((row) =>
    insertStatement(
      name,
      kept,
      kept.map((c) => row[colIndex.get(c)!] as SqlValue),
    ),
  );
  return { sql: out.join("\n") + "\n", warnings };
}

// ---------------------------------------------------------------------------
// Nested JSON → INSERTs (import)
// ---------------------------------------------------------------------------
type JsonObject = Record<string, unknown>;

const isPlainObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Turn a nested JSON document into multi-table INSERTs. Scalar fields of an
 * object become a row in the matching table; each array-of-objects field
 * becomes rows in its own table, linked by the foreign key back to the parent.
 * Nesting is followed to any depth.
 */
export function jsonToInserts(data: unknown, schema: DbSchema): InsertScript {
  const warnings: string[] = [];
  const out: string[] = [];

  const items = Array.isArray(data) ? data : [data];
  const objects = items.filter(isPlainObject);
  if (objects.length === 0) {
    return {
      sql: "",
      warnings: ["Expected a JSON object or an array of objects."],
    };
  }

  const seenTables = new Set<string>();

  const emit = (
    obj: JsonObject,
    parent: { table: TableInfo; keyValue: SqlValue | RawValue } | null,
    depth: number,
  ) => {
    if (depth > 10) return;

    const scalarKeys: string[] = [];
    const childKeys: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) childKeys.push(k);
      else if (!isPlainObject(v)) scalarKeys.push(k);
      // Nested single objects are ignored for now (no unambiguous mapping).
    }

    const table = matchTable(scalarKeys, schema);
    if (!table) {
      warnings.push(
        `No table matches fields [${scalarKeys.join(", ")}] — skipped.`,
      );
      return;
    }
    if (!seenTables.has(table.name)) {
      seenTables.add(table.name);
      warnings.push(`Mapped [${scalarKeys.slice(0, 4).join(", ")}…] → "${table.name}".`);
    }

    const { kept, dropped } = keepKnown(scalarKeys, table);
    if (dropped.length) {
      warnings.push(`Ignored fields not in "${table.name}": ${dropped.join(", ")}.`);
    }

    const cols = [...kept];
    const vals: Array<SqlValue | RawValue> = kept.map(
      (k) => obj[k] as SqlValue,
    );

    // Wire this row back to its parent when a FK exists.
    if (parent) {
      const fk = findForeignKey(table, parent.table);
      if (fk && !cols.some((c) => c.toLowerCase() === fk.column.toLowerCase())) {
        cols.push(fk.column);
        vals.push(parent.keyValue);
      } else if (!fk) {
        warnings.push(
          `No foreign key from "${table.name}" to "${parent.table.name}" — rows are not linked.`,
        );
      }
    }

    out.push(insertStatementRaw(table.name, cols, vals));

    // Children reference this row: explicit PK if present, else the rowid just
    // inserted above.
    const pk = primaryKeyOf(table);
    const keyValue: SqlValue | RawValue =
      pk && kept.includes(pk) ? (obj[pk] as SqlValue) : raw("last_insert_rowid()");

    for (const key of childKeys) {
      const arr = obj[key] as unknown[];
      for (const child of arr) {
        if (isPlainObject(child)) emit(child, { table, keyValue }, depth + 1);
      }
    }
  };

  for (const obj of objects) {
    emit(obj, null, 0);
    out.push("");
  }

  return { sql: out.join("\n").trim() + "\n", warnings };
}

/** Format the warnings as a SQL comment header. */
export function warningsHeader(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return warnings.map((w) => `-- ${w}`).join("\n") + "\n\n";
}

/** Exposed for the flat/relational decision in tests and callers. */
export type { Cell };
