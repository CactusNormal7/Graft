import { describe, expect, it } from "vitest";
import { buildNestedGroups, detectNestedShape, rowToObject } from "./resultShape";
import type { QueryResult } from "../types";

const join: QueryResult = {
  columns: ["audit_id", "audit_name", "constat_id", "constat_title"],
  rows: [
    [1, "Audit A", 10, "c1"],
    [1, "Audit A", 11, "c2"],
    [2, "Audit B", null, null], // LEFT JOIN without match
  ],
  rows_affected: 0,
  elapsed_ms: 0,
};

describe("detectNestedShape", () => {
  it("splits parent and child columns of a join", () => {
    const shape = detectNestedShape(join);
    expect(shape?.parentIndexes).toEqual([0, 1]);
    expect(shape?.childIndexes).toEqual([2, 3]);
    expect(shape?.childLabel).toBe("constat");
  });

  it("returns null when there is nothing to group", () => {
    expect(detectNestedShape({ ...join, rows: [[1, "a", 1, "x"], [2, "b", 2, "y"]] })).toBeNull();
  });
});

describe("buildNestedGroups", () => {
  it("groups children and skips all-null LEFT JOIN rows", () => {
    const groups = buildNestedGroups(join, detectNestedShape(join)!);
    expect(groups).toHaveLength(2);
    expect(groups[0].children).toHaveLength(2);
    expect(groups[1].children).toHaveLength(0);
  });
});

describe("rowToObject", () => {
  it("suffixes repeated column names instead of overwriting", () => {
    expect(rowToObject([1, 2, 3], ["id", "id", "id"])).toEqual({ id: 1, id_2: 2, id_3: 3 });
  });

  it("is not fooled by inherited property names", () => {
    expect(rowToObject([1], ["constructor"])).toEqual({ constructor: 1 });
  });
});
