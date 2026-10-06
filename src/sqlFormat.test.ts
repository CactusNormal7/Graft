import { describe, expect, it } from "vitest";
import { quoteIdent, sqlEquals, sqlLiteral } from "./sqlFormat";
import { basename, resolveFrom } from "./paths";

describe("sqlFormat", () => {
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

describe("resolveFrom", () => {
  it("resolves a relative path next to the base file, keeping absolute ones", () => {
    expect(resolveFrom("/p/shop.graft", "shop.db")).toBe("/p/shop.db");
    expect(resolveFrom("/p/shop.graft", "/data/x.db")).toBe("/data/x.db");
    expect(resolveFrom("C:\\p\\shop.graft", "shop.db")).toBe("C:\\p\\shop.db");
    expect(resolveFrom("C:\\p\\shop.graft", "D:/x.db")).toBe("D:/x.db");
    expect(resolveFrom("shop.graft", "shop.db")).toBe("shop.db");
  });
});
