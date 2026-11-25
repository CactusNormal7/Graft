/**
 * Locate an execution error inside a block's SQL so the editor can underline
 * it. Pure (no CodeMirror / Tauri) so it is unit-testable.
 *
 * Engines report errors differently:
 *  - Postgres gives a character position (the backend forwards it 0-based);
 *  - SQLite and MySQL only quote the offending token (`near "FORM"`,
 *    `near 'FORM t' at line 2`), so the token is searched in the SQL.
 * When nothing can be located, the first non-blank line is flagged so the user
 * still sees where the failing statement starts.
 */

/** Error shape returned by the `execute_sql` command (Rust `SqlError`). */
export interface SqlErrorPayload {
  message: string;
  /** 0-based character offset in the executed SQL, when the engine gives one. */
  position?: number | null;
}

/** A range of the editor document, in characters. */
export interface ErrorRange {
  from: number;
  to: number;
}

const IDENTIFIER_CHAR = /[\w$]/;
/** SQLite / Postgres: `near "token"` (doubled quotes escape a quote). */
const DOUBLE_QUOTED_NEAR = /near "((?:[^"]|"")*)"/;
/** MySQL: `near 'rest of the statement' at line N`. */
const MYSQL_NEAR = /near '([\s\S]*?)' at line (\d+)/;

function isSqlErrorPayload(err: unknown): err is SqlErrorPayload {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

/** Message of any rejection from `invoke` (structured error or plain string). */
export function errorMessage(err: unknown): string {
  return isSqlErrorPayload(err) ? err.message : String(err);
}

/** Position carried by a structured error, if any. */
export function errorPosition(err: unknown): number | null {
  if (!isSqlErrorPayload(err)) return null;
  return typeof err.position === "number" ? err.position : null;
}

/** End of the token starting at `from`: an identifier, or a single symbol. */
function tokenEnd(sql: string, from: number): number {
  if (!IDENTIFIER_CHAR.test(sql[from] ?? "")) return Math.min(sql.length, from + 1);
  let end = from;
  while (end < sql.length && IDENTIFIER_CHAR.test(sql[end])) end++;
  return end;
}

/** Offset of the first character of 1-based `line`. */
function lineStart(sql: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = sql.indexOf("\n", offset);
    if (next === -1) return offset;
    offset = next + 1;
  }
  return offset;
}

function firstNonBlankLine(sql: string): ErrorRange | null {
  const match = /\S[^\n]*/.exec(sql);
  if (!match) return null;
  return { from: match.index, to: match.index + match[0].trimEnd().length };
}

function rangeOfToken(sql: string, token: string, searchFrom = 0): ErrorRange | null {
  const needle = token.trim();
  if (!needle) return null;
  const at = sql.indexOf(needle, searchFrom);
  if (at === -1) return null;
  return { from: at, to: at + needle.length };
}

function rangeFromMessage(sql: string, message: string): ErrorRange | null {
  const mysql = MYSQL_NEAR.exec(message);
  if (mysql) {
    // MySQL quotes the whole remainder of the statement: keep its first token.
    const firstToken = mysql[1].trim().split(/\s+/)[0] ?? "";
    return rangeOfToken(sql, firstToken, lineStart(sql, Number(mysql[2])));
  }
  const quoted = DOUBLE_QUOTED_NEAR.exec(message);
  if (quoted) return rangeOfToken(sql, quoted[1].replace(/""/g, '"'));
  return null;
}

/**
 * Range to underline in `sql` (the editor text) for `error`, raised while
 * running `executedSql` — which differs from `sql` when `{{favorite}}`
 * references were expanded. A reported position is only trusted when both
 * texts are identical; otherwise offsets would point into the expansion.
 */
export function locateError(
  sql: string,
  error: SqlErrorPayload,
  executedSql: string = sql,
): ErrorRange | null {
  const position = error.position;
  if (typeof position === "number" && executedSql === sql && position < sql.length) {
    return { from: position, to: tokenEnd(sql, position) };
  }
  return rangeFromMessage(sql, error.message) ?? firstNonBlankLine(sql);
}
