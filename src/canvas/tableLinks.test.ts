import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { isTableLink, referencedKeysOnPage, tableLinkEdges } from "./tableLinks";
import type { TableInfo } from "../types";

const schema: TableInfo[] = ["users", "orders"].map((name) => ({
  name,
  kind: "table",
  columns: [],
  foreign_keys: [],
}));

const block = (id: string, sql: string): Node => ({
  id,
  type: "sqlBlock",
  position: { x: 0, y: 0 },
  data: { sql },
});
const tableNode = (id: string, table: string): Node => ({
  id,
  type: "tableNode",
  position: { x: 0, y: 0 },
  data: { table },
});

describe("table links", () => {
  const nodes = [
    block("b1", "SELECT * FROM users JOIN orders ON orders.user_id = users.id"),
    block("b2", "SELECT 1"),
    tableNode("t-users", "users"),
  ];

  it("links blocks to the table nodes present on the page", () => {
    const edges = tableLinkEdges(nodes, schema);
    expect(edges.map((e) => [e.source, e.target])).toEqual([["t-users", "b1"]]);
    expect(edges.every((e) => isTableLink(e.id) && e.deletable === false)).toBe(true);
  });

  it("lists every referenced table, on the canvas or not", () => {
    expect(referencedKeysOnPage(nodes, schema)).toEqual(["users", "orders"]);
    expect(tableLinkEdges([block("b", "SELECT * FROM users")], schema)).toEqual([]);
  });
});
