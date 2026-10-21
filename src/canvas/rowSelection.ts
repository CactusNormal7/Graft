/**
 * Row selection in a result table, with the usual desktop gestures:
 * click selects one row, Mod-click (⌘ on macOS, Ctrl elsewhere) toggles a
 * row, Shift-click selects the range from the anchor (the last row clicked
 * without Shift), Mod-Shift-click adds that range to the selection.
 *
 * Indexes are absolute positions in the result (not in the visible page), so
 * a selection survives paging. Pure module: no React.
 */

export interface RowSelection {
  /** Selected row indexes. */
  rows: ReadonlySet<number>;
  /** Start of the next Shift-range; null before any click. */
  anchor: number | null;
}

export const EMPTY_SELECTION: RowSelection = { rows: new Set(), anchor: null };

export interface ClickModifiers {
  /** ⌘ (macOS) or Ctrl (Windows) held. */
  toggle: boolean;
  /** Shift held. */
  range: boolean;
}

function rangeOf(a: number, b: number): number[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Selection after clicking row `index` with `mods`. */
export function clickRow(sel: RowSelection, index: number, mods: ClickModifiers): RowSelection {
  if (mods.range && sel.anchor !== null) {
    const range = rangeOf(sel.anchor, index);
    // The anchor stays put so successive Shift-clicks resize the range.
    const rows = mods.toggle ? new Set([...sel.rows, ...range]) : new Set(range);
    return { rows, anchor: sel.anchor };
  }
  if (mods.toggle) {
    const rows = new Set(sel.rows);
    if (rows.has(index)) rows.delete(index);
    else rows.add(index);
    return { rows, anchor: index };
  }
  return { rows: new Set([index]), anchor: index };
}

/** Right-click: keep a selection that contains the row (to act on all of
 *  it), otherwise select just that row. */
export function contextRow(sel: RowSelection, index: number): RowSelection {
  return sel.rows.has(index) ? sel : { rows: new Set([index]), anchor: index };
}

export function selectAll(count: number): RowSelection {
  if (count <= 0) return EMPTY_SELECTION;
  return { rows: new Set(rangeOf(0, count - 1)), anchor: 0 };
}

/** Selected indexes in result order. */
export function orderedRows(sel: RowSelection): number[] {
  return [...sel.rows].sort((a, b) => a - b);
}
