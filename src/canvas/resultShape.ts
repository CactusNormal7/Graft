/**
 * Auto-detects the "parent → children[]" shape hidden inside a flat join
 * result and rebuilds it as a tree. No SQL naming convention required.
 *
 * Heuristic — starting from the left, a column is a "parent" column if its
 * value stays constant within every group defined by the parent columns
 * already picked. As soon as a column varies inside at least one such group,
 * it (and every column to its right) is a "child" column. Rows sharing the
 * same parent tuple collapse into one group, with their child rows piled
 * into an array.
 *
 *   audit.id | audit.name | constat.id | constat.title
 *   1        | Audit A    | 10         | c1
 *   1        | Audit A    | 11         | c2
 *   2        | Audit B    | 20         | c3
 *
 * detects `[audit.id, audit.name]` as parent (both constant when grouped by
 * audit.id) and `[constat.id, constat.title]` as child rows.
 *
 * Performance note: group identity uses compact typed string keys built once
 * per row and extended incrementally as parent columns are accepted — the whole
 * detection is O(rows × columns) with no per-row JSON.stringify. Groups keep
 * *references* to the raw rows; callers materialize objects only for the rows
 * they actually display (see `ResultTable`), so a 50k-row result costs a few
 * thousand strings instead of ~1M objects.
 */
import type { QueryResult } from "../types";

export type Cell = string | number | boolean | null;

export interface NestedShape {
  parentIndexes: number[];
  childIndexes: number[];
  /** Human-friendly label for the child array (guessed from column names). */
  childLabel: string;
  /** Per-row parent key, computed during detection and reused when grouping. */
  keys: string[];
}

export interface NestedGroup {
  /** A representative row carrying this group's parent tuple. */
  parent: Cell[];
  /** Raw child rows (deduped; all-null LEFT JOIN rows skipped). */
  children: Cell[][];
}

/** Separator that cannot appear in a rendered cell value. */
const SEP = "\u001f";

/** Compact, type-tagged key fragment for one cell. Far cheaper than
 *  JSON.stringify, and keeps 1 (number) distinct from "1" (string). */
function cellKey(v: Cell): string {
  if (v === null) return "\u0000";
  switch (typeof v) {
    case "number":
      return "n" + v;
    case "boolean":
      return v ? "bt" : "bf";
    default:
      return "s" + (v as string);
  }
}

/** Detects the parent/child split. Returns null when no nesting is available
 *  (e.g., every row is unique — nothing to collapse). */
export function detectNestedShape(result: QueryResult): NestedShape | null {
  const { columns, rows } = result;
  if (columns.length < 2 || rows.length < 2) return null;

  const n = rows.length;
  // Seed with column 0 — in a typical join query the leftmost column is the
  // parent's identity, and it's the natural grouping key.
  const parentIndexes: number[] = [0];
  const keys = new Array<string>(n);
  for (let r = 0; r < n; r++) keys[r] = cellKey(rows[r][0]);

  for (let k = 1; k < columns.length; k++) {
    if (!isConstantWithinKeys(rows, keys, k)) break;
    parentIndexes.push(k);
    for (let r = 0; r < n; r++) keys[r] = keys[r] + SEP + cellKey(rows[r][k]);
  }

  const parentSet = new Set(parentIndexes);
  const childIndexes: number[] = [];
  for (let k = 0; k < columns.length; k++) {
    if (!parentSet.has(k)) childIndexes.push(k);
  }

  // Nothing to nest → let the caller fall back to the flat rows.
  if (childIndexes.length === 0) return null;
  if (!hasRepeatedKey(keys)) return null;

  return {
    parentIndexes,
    childIndexes,
    childLabel: guessChildLabel(childIndexes.map((i) => columns[i])),
    keys,
  };
}

/** Convenience — true iff the nested shape has something to show. */
export function hasNestedShape(result: QueryResult): boolean {
  return detectNestedShape(result) !== null;
}

/** Build the grouped tree using the detected shape. Groups reference the raw
 *  rows; no per-cell objects are allocated here. */
export function buildNestedGroups(
  result: QueryResult,
  shape: NestedShape,
): NestedGroup[] {
  const { rows } = result;
  const { childIndexes, keys } = shape;
  const order: string[] = [];
  const map = new Map<string, NestedGroup>();
  const seenChildKeys = new Map<string, Set<string>>();
  // Reused scratch buffer for the child dedupe key (join is faster than
  // repeated string concatenation in V8).
  const dedupeParts = new Array<string>(childIndexes.length);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const key = keys[r];

    let group = map.get(key);
    if (!group) {
      group = { parent: row, children: [] };
      map.set(key, group);
      order.push(key);
      seenChildKeys.set(key, new Set());
    }

    // Skip LEFT JOIN "no match" rows where every child cell is null.
    let allNull = true;
    for (let i = 0; i < childIndexes.length; i++) {
      if (row[childIndexes[i]] !== null) {
        allNull = false;
        break;
      }
    }
    if (allNull) continue;

    for (let i = 0; i < childIndexes.length; i++) {
      dedupeParts[i] = cellKey(row[childIndexes[i]]);
    }
    const dedupe = dedupeParts.join(SEP);
    const seen = seenChildKeys.get(key)!;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    group.children.push(row);
  }

  return order.map((k) => map.get(k)!);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/** True when column `k` has at most one distinct value inside every group
 *  identified by `keys` — i.e., k can safely join the parent set. */
function isConstantWithinKeys(
  rows: Cell[][],
  keys: string[],
  k: number,
): boolean {
  const seen = new Map<string, Cell>();
  for (let r = 0; r < rows.length; r++) {
    const key = keys[r];
    const v = rows[r][k];
    if (!seen.has(key)) seen.set(key, v);
    else if (!cellsEqual(seen.get(key)!, v)) return false;
  }
  return true;
}

function hasRepeatedKey(keys: string[]): boolean {
  const seen = new Set<string>();
  for (let r = 0; r < keys.length; r++) {
    if (seen.has(keys[r])) return true;
    seen.add(keys[r]);
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
