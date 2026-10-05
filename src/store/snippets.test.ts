import { describe, expect, it } from "vitest";
import { expandSnippets, toSnippetName } from "./snippets";
import type { Snippet } from "../types";

const snippet = (name: string, sql: string): Snippet => ({
  id: name,
  name,
  sql,
  blockType: "query",
});

describe("expandSnippets", () => {
  it("inlines a reference as a parenthesized subquery, without its semicolon", () => {
    const s = [snippet("recent", "SELECT * FROM users;")];
    expect(expandSnippets("SELECT * FROM {{ recent }} r", s)).toBe(
      "SELECT * FROM (SELECT * FROM users) r",
    );
  });

  it("resolves nested references and leaves unknown or cyclic ones intact", () => {
    const s = [snippet("a", "SELECT * FROM {{b}}"), snippet("b", "SELECT 1"), snippet("c", "{{c}}")];
    expect(expandSnippets("{{a}}", s)).toBe("(SELECT * FROM (SELECT 1))");
    expect(expandSnippets("{{nope}}", s)).toBe("{{nope}}");
    expect(expandSnippets("{{c}}", s)).toBe("({{c}})");
  });
});

describe("toSnippetName", () => {
  it("produces names a {{reference}} can match", () => {
    expect(toSnippetName("  Query 1 ")).toBe("Query_1");
    expect(toSnippetName("users/active (FR)")).toBe("users_active_FR");
    expect(toSnippetName("a.b-c_d")).toBe("a.b-c_d");
    expect(toSnippetName(" ?? ")).toBe("");
  });
});
