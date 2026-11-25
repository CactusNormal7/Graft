/** SQL pretty-printing for the "Format SQL" action (Shift+Alt+F). Distinct from
 *  `sqlFormat.ts`, which only escapes literals and identifiers. */
import { format, type SqlLanguage } from "sql-formatter";
import type { DbType } from "./types";

const LANGUAGE_BY_ENGINE: Record<DbType, SqlLanguage> = {
  sqlite: "sqlite",
  postgres: "postgresql",
  mysql: "mysql",
};

/** `{{favorite}}` references are kept verbatim — the formatter would otherwise
 *  split the braces apart and break the reference. Same charset as
 *  `toSnippetName`. */
const FAVORITE_REFERENCE = String.raw`\{\{[A-Za-z0-9_.-]+\}\}`;

/** Format `sql` for the given engine. Throws when the SQL cannot be parsed. */
export function formatSql(sql: string, engine: DbType): string {
  return format(sql, {
    language: LANGUAGE_BY_ENGINE[engine],
    keywordCase: "upper",
    tabWidth: 2,
    paramTypes: { custom: [{ regex: FAVORITE_REFERENCE }] },
  });
}
