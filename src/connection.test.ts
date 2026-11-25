import { describe, expect, it } from "vitest";
import {
  connectionFromFile,
  connectionLabel,
  connectionProblem,
  parseConnectionUrl,
} from "./connection";
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

  it("fills the form fields from a Postgres connection URL", () => {
    expect(
      parseConnectionUrl("postgresql://ada%40corp:p%2Fss@db.example.com:6543/my%20db?sslmode=require"),
    ).toEqual({
      fields: {
        engine: "postgres",
        host: "db.example.com",
        port: 6543,
        database: "my db",
        user: "ada@corp",
        sslMode: "require",
      },
      password: "p/ss",
    });
  });

  it("leaves absent URL parts undefined and reads MySQL URLs", () => {
    expect(parseConnectionUrl(" mysql://root@[::1]/shop?ssl-mode=DISABLED ")).toEqual({
      fields: {
        engine: "mysql",
        host: "::1",
        port: undefined,
        database: "shop",
        user: "root",
        sslMode: "disable",
      },
      password: undefined,
    });
  });

  it("rejects URLs it cannot map to a connection", () => {
    expect(parseConnectionUrl("localhost:5432")).toHaveProperty("error");
    expect(parseConnectionUrl("not a url")).toHaveProperty("error");
    expect(parseConnectionUrl("https://example.com/db")).toHaveProperty("error");
    expect(parseConnectionUrl("postgresql://h1,h2/db")).toHaveProperty("error");
  });
});
