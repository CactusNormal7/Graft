import type { ColumnInfo, DbSchema, ForeignKey, TableInfo } from "../types";

/** Shorthand for a column in test schemas. */
export function col(name: string, dataType = "TEXT", pk = false): ColumnInfo {
  return { name, data_type: dataType, notnull: false, pk };
}

export function table(
  name: string,
  columns: ColumnInfo[],
  foreignKeys: ForeignKey[] = [],
  kind = "table",
): TableInfo {
  return { name, kind, columns, foreign_keys: foreignKeys };
}

/** users(id PK, name) ← reviews(rid PK, user_id → users, body). */
export const usersReviews: DbSchema = [
  table("users", [col("id", "INTEGER", true), col("name")]),
  table(
    "reviews",
    [col("rid", "INTEGER", true), col("user_id", "INTEGER"), col("body")],
    [{ column: "user_id", to_table: "users", to_column: "" }],
  ),
];
