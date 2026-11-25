import { describe, expect, it } from "vitest";
import { formatSql } from "./formatSql";

describe("formatSql", () => {
  it("formats and upper-cases keywords", () => {
    expect(formatSql("select a, b from t where x=1", "sqlite")).toBe(
      "SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1",
    );
  });

  it("keeps {{favorite}} references intact", () => {
    expect(formatSql("select * from {{recent_users}} r", "postgres")).toContain(
      "{{recent_users}} r",
    );
  });

  it("uses the engine dialect", () => {
    expect(formatSql("select `a` from t", "mysql")).toContain("`a`");
  });

  it("throws on unparseable SQL", () => {
    expect(() => formatSql("select (( from", "sqlite")).toThrow();
  });
});
