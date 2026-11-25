import { describe, expect, it } from "vitest";
import { errorMessage, errorPosition, locateError } from "./sqlDiagnostics";

const textAt = (sql: string, range: { from: number; to: number } | null) =>
  range ? sql.slice(range.from, range.to) : null;

describe("locateError", () => {
  it("uses the engine position when the SQL ran as written", () => {
    const sql = "SELECT id FROM users WHER id = 1";
    expect(textAt(sql, locateError(sql, { message: "syntax error", position: 21 }))).toBe("WHER");
  });

  it("ignores the position when favorites were expanded", () => {
    const sql = "SELECT * FROM {{recent}} FORM";
    const executed = "SELECT * FROM (SELECT 1) FORM";
    const range = locateError(sql, { message: 'near "FORM": syntax error', position: 3 }, executed);
    expect(textAt(sql, range)).toBe("FORM");
  });

  it("finds the token quoted by SQLite", () => {
    const sql = "SELECT *\nFORM t";
    const range = locateError(sql, { message: '(code: 1) near "FORM": syntax error' });
    expect(textAt(sql, range)).toBe("FORM");
  });

  it("uses the MySQL line hint to find the right occurrence", () => {
    const sql = "SELECT a\nFROM t\nWHER a";
    const range = locateError(sql, {
      message: "You have an error in your SQL syntax; check the manual near 'WHER a' at line 3",
    });
    expect(textAt(sql, range)).toBe("WHER");
  });

  it("falls back to the first non-blank line", () => {
    const sql = "\n  SELECT missing_fn()  \nFROM t";
    const range = locateError(sql, { message: "no such function: missing_fn" });
    expect(textAt(sql, range)).toBe("SELECT missing_fn()");
  });

  it("returns null for an empty editor", () => {
    expect(locateError("   ", { message: "incomplete input" })).toBeNull();
  });
});

describe("error payload helpers", () => {
  it("reads structured and plain errors", () => {
    expect(errorMessage({ message: "boom", position: 4 })).toBe("boom");
    expect(errorPosition({ message: "boom", position: 4 })).toBe(4);
    expect(errorMessage("plain")).toBe("plain");
    expect(errorPosition("plain")).toBeNull();
    expect(errorPosition({ message: "boom", position: null })).toBeNull();
  });
});
