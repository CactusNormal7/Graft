import { describe, expect, it } from "vitest";
import { connectionFromFile, connectionLabel, connectionProblem } from "./connection";
import type { NotebookFile } from "./types";

const file = (fields: Partial<NotebookFile>): NotebookFile => ({
  version: 5,
  name: "p",
  dbType: "sqlite",
  dbPath: null,
  ...fields,
});

describe("connections", () => {
  it("reads v6 connections and migrates legacy SQLite paths", () => {
    const pg = { id: "c", engine: "postgres" as const, host: "h", user: "u" };
    expect(connectionFromFile(file({ version: 6, connection: pg }))).toEqual(pg);
    expect(connectionFromFile(file({ dbPath: "/data/app.db" }))).toMatchObject({
      engine: "sqlite",
      path: "/data/app.db",
    });
    expect(connectionFromFile(file({}))).toBeNull();
  });

  it("labels a connection without secrets", () => {
    expect(connectionLabel({ id: "c", engine: "sqlite", path: "C:\\db\\app.db" })).toBe("app.db");
    expect(
      connectionLabel({ id: "c", engine: "mysql", host: "db", user: "ada", database: "shop" }),
    ).toBe("ada@db:3306/shop");
    expect(connectionLabel(null)).toBe("No database");
  });

  it("reports the first missing field", () => {
    expect(connectionProblem({ id: "c", engine: "postgres", host: "h", user: "" })).toBe(
      "User is required.",
    );
    expect(connectionProblem({ id: "c", engine: "mysql", host: "h", user: "u" })).toBe(
      "Database is required for MySQL.",
    );
    expect(connectionProblem({ id: "c", engine: "postgres", host: "h", user: "u", port: 0 })).toBe(
      "Port must be between 1 and 65535.",
    );
    expect(connectionProblem({ id: "c", engine: "sqlite" })).toBeNull();
  });
});
