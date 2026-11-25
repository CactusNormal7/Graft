import { afterEach, describe, expect, it } from "vitest";
import { qualifiedName, quoteIdent, setSqlDialect, sqlEquals, sqlLiteral } from "./sqlFormat";
import { basename } from "./paths";

describe("sqlFormat", () => {
  afterEach(() => setSqlDialect("sqlite"));

  it("quotes for the active engine", () => {
    setSqlDialect("mysql");
    expect(quoteIdent("we`ird")).toBe("`we``ird`");
    expect(qualifiedName("t", "shop")).toBe("`shop`.`t`");
    setSqlDialect("postgres");
    expect(qualifiedName("orders", "sales")).toBe('"sales"."orders"');
    expect(qualifiedName("orders")).toBe('"orders"');
    expect(sqlLiteral(false)).toBe("FALSE");
  });

  it("escapes identifiers and literals", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(Number.NaN)).toBe("NULL");
    expect(sqlLiteral(true)).toBe("1");
  });

  it("compares NULL with IS NULL", () => {
    expect(sqlEquals("a", null)).toBe('"a" IS NULL');
    expect(sqlEquals("a", 2)).toBe('"a" = 2');
  });
});

describe("basename", () => {
  it("handles POSIX and Windows separators", () => {
    expect(basename("/home/me/p.db")).toBe("p.db");
    expect(basename("C:\\Users\\me\\p.db")).toBe("p.db");
    expect(basename("p.db")).toBe("p.db");
  });
});
