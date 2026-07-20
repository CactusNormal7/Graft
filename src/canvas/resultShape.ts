/**
 * Auto-detects the "parent → children[]" shape hidden inside a flat join
 * result and rebuilds it as a tree. No SQL naming convention required.
 *
 * Heuristic — starting from the left, a column is a "parent" column if its
 * value stays constant within every group defined by the parent columns
 * already picked. As soon as a column varies inside at least one such group,
 * it (and every column to its right) is a "child" column. Rows sharing the
 * same parent tuple collapse into one group, with their child tuples piled
 * into an array.
 *
 *   audit.id | audit.name | constat.id | constat.title
 *   1        | Audit A    | 10         | c1
 *   1        | Audit A    | 11         | c2
 *   2        | Audit B    | 20         | c3
 *
 * detects `[audit.id, audit.name]` as parent (both constant when grouped by
 * audit.id) and `[constat.id, constat.title]` as child rows.
 */
import type { QueryResult } from "../types";

export type Cell = string | number | boolean | null;

export interface NestedShape {
  parentIndexes: number[];
  childIndexes: number[];
  /** Human-friendly label for the child array (guessed from column names). */
  childLabel: string;
}

export interface NestedGroup {
  parent: Array<{ key: string; value: Cell; colIndex: number }>;
  children: Array<Array<{ key: string; value: Cell; colIndex: number }>>;
}

/** Detects the parent/child split. Returns null when no nesting is available
 *  (e.g., every row is unique — nothing to collapse). */
export function detectNestedShape(result: QueryResult): NestedShape | null {
  const { columns, rows } = result;
  if (columns.length < 2 || rows.length < 2) return null;

  // Seed with column 0 — in a typical join query the leftmost column is the
  // parent's identity, and it's the natural grouping key. Without a seed the
  // algorithm can never accept col[0] as parent (it varies across the whole
  // result), and we'd degenerate to "all columns are children".
  const parentIndexes: number[] = [0];
  for (let k = 1; k < columns.length; k++) {
    if (isConstantWithinGroups(rows, parentIndexes, k)) {
      parentIndexes.push(k);
    } else {
      break;
    }
  }

  const childIndexes: number[] = [];
  for (let k = 0; k < columns.length; k++) {
    if (!parentIndexes.includes(k)) childIndexes.push(k);
  }

  // Nothing to nest → let the caller fall back to records/table.
  if (childIndexes.length === 0) return null;
  if (!hasAnyRepeatedParent(rows, parentIndexes)) return null;

  return {
    parentIndexes,
    childIndexes,
    childLabel: guessChildLabel(childIndexes.map((i) => columns[i])),
  };
}

/** Convenience — true iff nested view has something to show. */
export function hasNestedShape(result: QueryResult): boolean {
  return detectNestedShape(result) !== null;
}

/** Build the grouped tree using the detected shape. */
export function buildNestedGroups(
  result: QueryResult,
  shape: NestedShape,
): NestedGroup[] {
  const { columns, rows } = result;
  const order: string[] = [];
  const map = new Map<string, NestedGroup>();
  const seenChildKeys = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = groupKey(row, shape.parentIndexes);

    let group = map.get(key);
    if (!group) {
      group = {
        parent: shape.parentIndexes.map((i) => ({
          key: columns[i],
          value: row[i],
          colIndex: i,
        })),
        children: [],
      };
      map.set(key, group);
      order.push(key);
      seenChildKeys.set(key, new Set());
    }

    const childItem = shape.childIndexes.map((i) => ({
      key: columns[i],
      value: row[i],
      colIndex: i,
    }));

    // Skip LEFT JOIN "no match" rows where every child cell is null.
    if (childItem.every((c) => c.value === null)) continue;

    const seen = seenChildKeys.get(key)!;
    const dedupe = JSON.stringify(childItem.map((c) => c.value));
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    group.children.push(childItem);
  }

  return order.map((k) => map.get(k)!);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function groupKey(row: Cell[], indexes: number[]): string {
  return JSON.stringify(indexes.map((i) => row[i]));
}

/** True when column `k` has at most one distinct value inside every group
 *  formed by `parentIndexes` — i.e., k can safely join the parent set. */
function isConstantWithinGroups(
  rows: Cell[][],
  parentIndexes: number[],
  k: number,
): boolean {
  const seen = new Map<string, Cell>();
  for (const row of rows) {
    const key = groupKey(row, parentIndexes);
    if (!seen.has(key)) {
      seen.set(key, row[k]);
    } else if (!cellsEqual(seen.get(key)!, row[k])) {
      return false;
    }
  }
  return true;
}

function hasAnyRepeatedParent(rows: Cell[][], parentIndexes: number[]): boolean {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = groupKey(row, parentIndexes);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.get(key)! > 1) return true;
  }
  return false;
}

function cellsEqual(a: Cell, b: Cell): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return String(a) === String(b);
}

/** Guess a label for the child array from the shared prefix / table name of
 *  the child column names. Examples:
 *   ["constat_id", "constat_title"]           → "constat"
 *   ["c.id", "c.title"]                       → "c"
 *   ["constats.id", "constats.title"]         → "constats"
 *   ["created_at", "updated_at"]              → "items" (no common table hint)
 */
function guessChildLabel(childCols: string[]): string {
  if (childCols.length === 0) return "items";

  // Dot-qualified: pick common table prefix if all share it.
  const dotted = childCols.map((c) => c.split(".")[0]);
  if (dotted.every((d, i, a) => d === a[0] && d !== childCols[i])) return dotted[0];

  // Snake-case common prefix (foo_bar, foo_baz → "foo").
  const first = childCols[0];
  const under = first.indexOf("_");
  if (under > 0) {
    const prefix = first.slice(0, under);
    if (childCols.every((c) => c.startsWith(prefix + "_"))) return prefix;
  }

  return "items";
}
