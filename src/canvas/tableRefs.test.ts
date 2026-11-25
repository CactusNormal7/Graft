import { describe, expect, it } from "vitest";
import { referencedTableKeys, tableNamesIn } from "./tableRefs";
import type { TableInfo } from "../types";

const table = (name: string, schema?: string): TableInfo => ({
  name,
  schema,
  kind: "table",
  columns: [],
  foreign_keys: [],
});
const tables = [table("users"), table("orders"), table("leads", "sales"), table("audit_log")];

describe("table references", () => {
  it("reads FROM lists, joins and aliases", () => {
    // `ON i.id` yields a candidate too (ON also introduces CREATE INDEX /
    // TRIGGER targets); it matches no table, so it links nothing.
    expect(tableNamesIn("SELECT * FROM users u, orders AS o JOIN items i ON i.id = o.id")).toEqual([
      "users",
      "orders",
      "items",
      "i.id",
    ]);
  });

  it("matches writes, DDL and qualified or quoted names", () => {
    const sql = `
      INSERT INTO "orders" (id) VALUES (1);
      UPDATE sales.leads SET score = 0;
      CREATE TABLE IF NOT EXISTS audit_log (user_id INT REFERENCES users (id));
      CREATE TRIGGER t AFTER INSERT ON \`orders\` FOR EACH ROW BEGIN END;`;
    expect(referencedTableKeys(sql, tables)).toEqual(["orders", "sales.leads", "audit_log", "users"]);
  });

  it("ignores comments, strings and unknown names", () => {
    const sql = "-- FROM users\nSELECT 'FROM orders' FROM /* JOIN orders */ leads WHERE x = 'it''s'";
    expect(referencedTableKeys(sql, tables)).toEqual(["sales.leads"]);
    expect(referencedTableKeys("WITH recent AS (SELECT 1) SELECT * FROM recent", tables)).toEqual([]);
  });
});
