import { describe, expect, it } from "vitest";
import { generateInserts, jsonToInserts, matchTable, warningsHeader } from "./orm";
import type { QueryResult } from "../types";
import { col, table, usersReviews } from "../test/schema";

const result = (columns: string[], rows: QueryResult["rows"]): QueryResult => ({
  columns,
  rows,
  rows_affected: 0,
  elapsed_ms: 0,
});

/** The parent-key subquery used when the key isn't in the data. */
const LAST_USER = `(SELECT "id" FROM "users" ORDER BY rowid DESC LIMIT 1)`;

describe("matchTable", () => {
  it("skips views and needs the match threshold", () => {
    const schema = [
      table("v_users", [col("id"), col("name")], [], "view"),
      table("users", [col("id"), col("name"), col("email")]),
    ];
    expect(matchTable(["id", "name"], schema)?.name).toBe("users");
    expect(matchTable(["foo", "bar", "id"], schema)).toBeNull();
  });

  it("breaks ties toward the narrower table", () => {
    const schema = [
      table("wide", [col("id"), col("name"), col("a"), col("b")]),
      table("narrow", [col("id"), col("name")]),
    ];
    expect(matchTable(["ID", "Name"], schema)?.name).toBe("narrow");
  });
});

describe("generateInserts", () => {
  it("links every child to its parent, not to the previous child", () => {
    const { sql } = generateInserts(
      result(
        ["name", "body"],
        [
          ["ann", "r1"],
          ["ann", "r2"],
          ["bob", "r3"],
        ],
      ),
      usersReviews,
    );
    const lines = sql.trim().split("\n").filter(Boolean);
    expect(lines).toEqual([
      `INSERT INTO "users" ("name") VALUES ('ann');`,
      `INSERT INTO "reviews" ("body", "user_id") VALUES ('r1', ${LAST_USER});`,
      `INSERT INTO "reviews" ("body", "user_id") VALUES ('r2', ${LAST_USER});`,
      `INSERT INTO "users" ("name") VALUES ('bob');`,
      `INSERT INTO "reviews" ("body", "user_id") VALUES ('r3', ${LAST_USER});`,
    ]);
    expect(sql).not.toContain("last_insert_rowid");
  });

  it("uses the parent's explicit key when it is selected", () => {
    const { sql } = generateInserts(
      result(
        ["id", "name", "body"],
        [
          [7, "ann", "r1"],
          [7, "ann", "r2"],
        ],
      ),
      usersReviews,
    );
    expect(sql).toContain(`INSERT INTO "users" ("id", "name") VALUES (7, 'ann');`);
    expect(sql).toContain(`INSERT INTO "reviews" ("body", "user_id") VALUES ('r2', 7);`);
  });

  it("falls back to flat INSERTs with a placeholder table", () => {
    const { sql, warnings } = generateInserts(result(["x"], [[1], [2]]), usersReviews);
    expect(sql).toBe(`INSERT INTO "«table»" ("x") VALUES (1);\nINSERT INTO "«table»" ("x") VALUES (2);\n`);
    expect(warnings.join(" ")).toContain("No matching table");
  });

  it("refuses an empty result", () => {
    expect(generateInserts(result(["a"], []), usersReviews).sql).toBe("");
  });
});

describe("jsonToInserts", () => {
  it("maps nested arrays to child tables linked by the foreign key", () => {
    const { sql } = jsonToInserts(
      [{ name: "cid", reviews: [{ body: "x" }, { body: "y" }] }],
      usersReviews,
    );
    expect(sql.trim().split("\n")).toEqual([
      `INSERT INTO "users" ("name") VALUES ('cid');`,
      `INSERT INTO "reviews" ("body", "user_id") VALUES ('x', ${LAST_USER});`,
      `INSERT INTO "reviews" ("body", "user_id") VALUES ('y', ${LAST_USER});`,
    ]);
  });

  it("rejects input that isn't an object or an array of objects", () => {
    expect(jsonToInserts(42, usersReviews).sql).toBe("");
  });
});

describe("warningsHeader", () => {
  it("renders warnings as SQL comments", () => {
    expect(warningsHeader([])).toBe("");
    expect(warningsHeader(["a", "b"])).toBe("-- a\n-- b\n\n");
  });
});
