import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  clickRow,
  contextRow,
  orderedRows,
  selectAll,
  type RowSelection,
} from "./rowSelection";

const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };
const both = { toggle: true, range: true };
const rows = (s: RowSelection) => orderedRows(s);

describe("row selection", () => {
  it("selects one row on a plain click", () => {
    const s = clickRow(clickRow(EMPTY_SELECTION, 2, plain), 5, plain);
    expect(rows(s)).toEqual([5]);
    expect(s.anchor).toBe(5);
  });

  it("toggles rows with Mod-click", () => {
    let s = clickRow(EMPTY_SELECTION, 1, plain);
    s = clickRow(s, 4, toggle);
    s = clickRow(s, 6, toggle);
    expect(rows(s)).toEqual([1, 4, 6]);
    s = clickRow(s, 4, toggle);
    expect(rows(s)).toEqual([1, 6]);
  });

  it("selects a range from the anchor with Shift-click, in either direction", () => {
    let s = clickRow(EMPTY_SELECTION, 3, plain);
    s = clickRow(s, 6, range);
    expect(rows(s)).toEqual([3, 4, 5, 6]);
    s = clickRow(s, 1, range); // the anchor stays at 3
    expect(rows(s)).toEqual([1, 2, 3]);
  });

  it("adds a range to the selection with Mod-Shift-click", () => {
    let s = clickRow(EMPTY_SELECTION, 0, plain);
    s = clickRow(s, 5, toggle);
    s = clickRow(s, 7, both);
    expect(rows(s)).toEqual([0, 5, 6, 7]);
  });

  it("treats Shift-click without an anchor as a plain click", () => {
    expect(rows(clickRow(EMPTY_SELECTION, 4, range))).toEqual([4]);
  });

  it("keeps the selection on right-click inside it, replaces it outside", () => {
    const s = clickRow(clickRow(EMPTY_SELECTION, 1, plain), 3, range);
    expect(contextRow(s, 2)).toBe(s);
    expect(rows(contextRow(s, 8))).toEqual([8]);
  });

  it("selects everything", () => {
    expect(rows(selectAll(4))).toEqual([0, 1, 2, 3]);
    expect(rows(selectAll(0))).toEqual([]);
  });
});
