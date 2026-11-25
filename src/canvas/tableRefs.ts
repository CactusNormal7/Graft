/**
 * Which schema tables a block's SQL references — drives the dashed links
 * between SQL blocks and table nodes on the canvas. Pure, unit-tested.
 *
 * A lightweight scan, not a parser: comments and string literals are
 * skipped, then the identifier following FROM / JOIN / INTO / UPDATE /
 * TABLE / REFERENCES / ON (and each comma-separated name of a FROM list) is
 * matched against the introspected tables. Unknown names (CTEs, aliases,
 * subqueries) simply match nothing.
 */
import type { TableInfo } from "../types";

const TABLE_KEYWORDS = new Set(["from", "join", "into", "update", "table", "references", "on"]);
/** Words that may sit between a keyword and the table name. */
const SKIPPED_WORDS = new Set(["only", "if", "not", "exists", "lateral", "ignore"]);

type Token = { kind: "word"; text: string } | { kind: "symbol"; text: string };

/** Identifiers (bare or quoted with "…", `…`, […]) and single-char symbols. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (char === "'") {
      // '' escapes a quote inside a string literal.
      let end = i + 1;
      while (end < sql.length && !(sql[end] === "'" && sql[end + 1] !== "'")) {
        end += sql[end] === "'" ? 2 : 1;
      }
      i = end + 1;
    } else if (char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      const end = sql.indexOf(close, i + 1);
      const stop = end === -1 ? sql.length : end;
      tokens.push({ kind: "word", text: sql.slice(i + 1, stop) });
      i = stop + 1;
    } else if (/[\w$]/.test(char)) {
      const match = /^[\w$]+/.exec(rest)!;
      tokens.push({ kind: "word", text: match[0] });
      i += match[0].length;
    } else {
      if (!/\s/.test(char)) tokens.push({ kind: "symbol", text: char });
      i += 1;
    }
  }
  return tokens;
}

/** Read `name` or `schema.name` starting at `start`; returns it and the next index. */
function readName(tokens: Token[], start: number): { name: string; next: number } | null {
  const first = tokens[start];
  if (first?.kind !== "word") return null;
  if (tokens[start + 1]?.text === "." && tokens[start + 2]?.kind === "word") {
    return { name: `${first.text}.${tokens[start + 2].text}`, next: start + 3 };
  }
  return { name: first.text, next: start + 1 };
}

/** Skip an optional alias (`AS x` or a bare word that is not a keyword). */
function skipAlias(tokens: Token[], index: number): number {
  const word = tokens[index];
  if (word?.kind !== "word") return index;
  const lower = word.text.toLowerCase();
  if (lower === "as") return index + 2;
  return TABLE_KEYWORDS.has(lower) || RESERVED_AFTER_TABLE.has(lower) ? index : index + 1;
}

const RESERVED_AFTER_TABLE = new Set([
  "where", "group", "order", "having", "limit", "left", "right", "inner", "outer", "full",
  "cross", "natural", "set", "values", "select", "union", "returning", "using", "for",
  "window", "offset", "fetch", "default", "with", "begin", "execute", "each", "after",
  "before", "instead",
]);

/** Candidate table names written in `sql`, in order of appearance. */
export function tableNamesIn(sql: string): string[] {
  const tokens = tokenize(sql);
  const names: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== "word" || !TABLE_KEYWORDS.has(token.text.toLowerCase())) continue;
    const isFromList = token.text.toLowerCase() === "from";
    let position = i + 1;
    while (tokens[position]?.kind === "word" && SKIPPED_WORDS.has(tokens[position].text.toLowerCase())) {
      position += 1;
    }
    let read = readName(tokens, position);
    while (read) {
      names.push(read.name);
      if (!isFromList) break;
      const afterAlias = skipAlias(tokens, read.next);
      read = tokens[afterAlias]?.text === "," ? readName(tokens, afterAlias + 1) : null;
    }
  }
  return names;
}

/** Key of a table as shown on the canvas: `schema.name` or `name`. */
export function tableKey(table: Pick<TableInfo, "name" | "schema">): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

/** Keys of the schema tables (and views) referenced by `sql`, deduplicated.
 *  Unqualified names also match tables of non-default schemas. */
export function referencedTableKeys(sql: string, tables: TableInfo[]): string[] {
  const byName = new Map<string, string>();
  for (const table of tables) {
    byName.set(tableKey(table).toLowerCase(), tableKey(table));
    if (!byName.has(table.name.toLowerCase())) byName.set(table.name.toLowerCase(), tableKey(table));
  }
  const keys = new Set<string>();
  for (const name of tableNamesIn(sql)) {
    const key = byName.get(name.toLowerCase());
    if (key) keys.add(key);
  }
  return [...keys];
}
