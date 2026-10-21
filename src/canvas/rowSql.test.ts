import { describe, expect, it } from "vitest";
import {
  deleteRowSql,
  deleteRowsSql,
  duplicateRowSql,
  duplicateRowsSql,
  rowsKeyCondition,
  selectRowsSql,
  updateCellRowsSql,
  resolveRowTarget,
  selectRowSql,
  updateCellSql,
  type RowTarget,
} from "./rowSql";
import { col, table, usersReviews } from "../test/schema";

function targetOf(columns: string[], schema = usersReviews): RowTarget {
  const resolved = resolveRowTarget(columns, schema);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.target;
}

describe("resolveRowTarget", () => {
  it("resolves a single-table result that includes the primary key", () => {
    expect(targetOf(["id", "name"])).toEqual({
      table: "users",
      keyIndexes: [0],
      generatedKey: true,
    });
  });

  it("refuses results it can't map safely", () => {
    const reason = (columns: string[], schema = usersReviews) => {
      const r = resolveRowTarget(columns, schema);
      return r.ok ? null : r.reason;
    };
    expect(reason(["name"])).toMatch(/primary key/);
    expect(reason(["name", "body"])).toMatch(/single table/); // a join
    expect(reason(["id", "id"])).toMatch(/duplicate/);
    expect(reason(["a"], [table("t", [col("a")])])).toMatch(/no declared primary key/);
    expect(
      reason(["id"], [table("a", [col("id", "INTEGER", true)]), table("b", [col("id", "INTEGER", true)])]),
    ).toMatch(/Ambiguous/);
  });

  it("handles composite keys", () => {
    const schema = [table("m", [col("a", "TEXT", true), col("b", "TEXT", true), col("v")])];
    const t = targetOf(["v", "b", "a"], schema);
    expect(t.generatedKey).toBe(false);
    expect(selectRowSql(t, ["x", "B", "A"], ["v", "b", "a"])).toBe(
      `SELECT * FROM "m" WHERE "a" = 'A' AND "b" = 'B';`,
    );
  });
});

describe("row statements", () => {
  const columns = ["id", "name"];
  const t = targetOf(columns);
  const row = [3, "o'neil"];

  it("updates one cell by primary key", () => {
    expect(updateCellSql(t, row, columns, 1, null)).toContain(
      `UPDATE "users" SET "name" = NULL WHERE "id" = 3;`,
    );
  });

  it("deletes by primary key", () => {
    expect(deleteRowSql(t, row, columns)).toContain(`DELETE FROM "users" WHERE "id" = 3;`);
  });

  it("duplicates without a generated key", () => {
    expect(duplicateRowSql(t, row, columns)).toContain(
      `INSERT INTO "users" ("name") VALUES ('o''neil');`,
    );
  });

  it("keeps a non-generated key and says so", () => {
    const schema = [table("tags", [col("code", "TEXT", true), col("label")])];
    const sql = duplicateRowSql(targetOf(["code", "label"], schema), ["fr", "French"], ["code", "label"]);
    expect(sql).toContain("change it before running");
    expect(sql).toContain(`INSERT INTO "tags" ("code", "label") VALUES ('fr', 'French');`);
  });

  it("matches a NULL key with IS NULL", () => {
    expect(selectRowSql(t, [null, "x"], columns)).toBe(`SELECT * FROM "users" WHERE "id" IS NULL;`);
  });
});

describe("multi-row statements", () => {
  const columns = ["id", "name"];
  const t = targetOf(columns);
  const rows = [[1, "a"], [3, "b"], [1, "dup"]];

  it("matches a single-column key with IN, deduplicated, and nulls with IS NULL", () => {
    expect(rowsKeyCondition(t, rows, columns)).toBe(`"id" IN (1, 3)`);
    expect(rowsKeyCondition(t, [[1, "a"], [null, "b"]], columns)).toBe(`"id" = 1 OR "id" IS NULL`);
    expect(selectRowsSql(t, rows, columns)).toBe(`SELECT * FROM "users" WHERE "id" IN (1, 3);`);
  });

  it("matches a composite key row by row", () => {
    const schema = [table("m", [col("a", "TEXT", true), col("b", "TEXT", true), col("v")])];
    const cols = ["a", "b", "v"];
    const ct = targetOf(cols, schema);
    expect(rowsKeyCondition(ct, [["x", "1", 0], ["y", "2", 0]], cols)).toBe(
      `("a" = 'x' AND "b" = '1')\n   OR ("a" = 'y' AND "b" = '2')`,
    );
  });

  it("updates, deletes and duplicates every selected row in one statement", () => {
    expect(updateCellRowsSql(t, rows, columns, 1, null)).toContain(
      `UPDATE "users" SET "name" = NULL WHERE "id" IN (1, 3);`,
    );
    const del = deleteRowsSql(t, rows, columns);
    expect(del).toContain("3 result rows");
    expect(del).toContain(`DELETE FROM "users" WHERE "id" IN (1, 3);`);
    expect(duplicateRowsSql(t, [[1, "a"], [2, "b"]], columns)).toContain(
      `INSERT INTO "users" ("name") VALUES\n  ('a'),\n  ('b');`,
    );
  });

  it("keeps single-row output unchanged", () => {
    expect(deleteRowsSql(t, [[3, "x"]], columns)).toBe(deleteRowSql(t, [3, "x"], columns));
    expect(duplicateRowsSql(t, [[3, "x"]], columns)).toBe(duplicateRowSql(t, [3, "x"], columns));
  });
});
