import type { Snippet } from "../types";

/** Matches a `{{ name }}` favorite-block reference. */
const SNIPPET_REF = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * Replace `{{name}}` references with the referenced favorite's SQL, wrapped in
 * parentheses so it drops straight into a subquery position:
 *
 *   SELECT * FROM {{recent_users}} WHERE country = 'FR'
 *     → SELECT * FROM (SELECT * FROM users WHERE ...) WHERE country = 'FR'
 *
 * Nested references resolve recursively. A reference that is already being
 * expanded (direct or mutual recursion) is left untouched rather than looping,
 * as is an unknown name — so the database reports a clear error instead of the
 * editor silently producing something unexpected.
 */
export function expandSnippets(
  sql: string,
  snippets: Snippet[],
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): string {
  if (depth > 10) return sql;
  return sql.replace(SNIPPET_REF, (match, rawName: string) => {
    const name = rawName.trim();
    if (seen.has(name)) return match; // cycle → leave as written
    const snippet = snippets.find((s) => s.name === name);
    if (!snippet) return match; // unknown → leave as written
    const body = snippet.sql.trim().replace(/;\s*$/, "");
    const inner = expandSnippets(
      body,
      snippets,
      new Set([...seen, name]),
      depth + 1,
    );
    return `(${inner})`;
  });
}
