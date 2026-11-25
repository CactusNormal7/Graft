import { describe, expect, it } from "vitest";
import {
  describeIndex,
  describeRoutine,
  describeTrigger,
  explorerSections,
  objectKey,
} from "./schemaTree";
import type { SchemaObjects, TableInfo } from "../types";

const table = (name: string, columns: string[], fields: Partial<TableInfo> = {}): TableInfo => ({
  name,
  kind: "table",
  columns: columns.map((c) => ({ name: c, data_type: "int", notnull: false, pk: false })),
  foreign_keys: [],
  ...fields,
});

const objects: SchemaObjects = {
  triggers: [
    { name: "audit", table: "orders", timing: "AFTER", events: "INSERT", definition: "" },
  ],
  routines: [
    { name: "total_for", kind: "function", arguments: "c integer", returns: "numeric", definition: "" },
    { name: "reset", kind: "procedure", arguments: "", definition: "" },
  ],
};

describe("explorer sections", () => {
  const tables = [
    table("users", ["id", "email"]),
    table("orders", ["id", "user_id"], { schema: "sales" }),
    table("big_orders", ["id"], { kind: "view" }),
  ];

  it("groups and sorts everything without a query", () => {
    const sections = explorerSections(tables, objects, "");
    expect(sections.tables.map(objectKey)).toEqual(["sales.orders", "users"]);
    expect(sections.views.map(objectKey)).toEqual(["big_orders"]);
    expect(sections.routines.map((r) => r.name)).toEqual(["reset", "total_for"]);
  });

  it("filters on names, columns and trigger tables", () => {
    const sections = explorerSections(tables, objects, "EMAIL");
    expect(sections.tables.map(objectKey)).toEqual(["users"]);
    expect(sections.views).toEqual([]);
    expect(explorerSections(tables, objects, "orders").triggers).toHaveLength(1);
    expect(explorerSections(tables, objects, "sales").tables.map(objectKey)).toEqual(["sales.orders"]);
  });

  it("describes indexes, triggers and routines", () => {
    expect(describeIndex({ name: "p", columns: ["id"], unique: true, primary: true })).toBe("PRIMARY KEY (id)");
    expect(describeIndex({ name: "u", columns: ["a", "b"], unique: true, primary: false })).toBe("UNIQUE (a, b)");
    expect(describeTrigger(objects.triggers[0])).toBe("AFTER INSERT ON orders");
    expect(describeRoutine(objects.routines[0])).toBe("total_for(c integer) → numeric");
    expect(describeRoutine(objects.routines[1])).toBe("reset()");
  });
});
