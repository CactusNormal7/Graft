//! INSERT statements from a query result — the `generate_inserts` MCP tool.
//!
//! A Rust port of the flat path of the app's ORM bridge (`src/canvas/orm.ts`):
//! the target table is the one whose columns best cover the result's (views
//! excluded, at least 60 %, the narrower table on a tie), and only columns
//! that exist in it are written. The app's parent → children (JOIN) variant
//! is not ported: rows are inserted one table at a time.

use serde_json::Value;

use crate::db::schema::TableInfo;
use crate::db::{Engine, QueryResult};

/// Minimum share of result columns a table must have to be the target.
const MATCH_THRESHOLD: f64 = 0.6;

pub struct InsertScript {
    pub sql: String,
    pub warnings: Vec<String>,
}

/// Best table for a set of column names (see the module documentation).
pub fn match_table<'a>(columns: &[String], tables: &'a [TableInfo]) -> Option<&'a TableInfo> {
    if columns.is_empty() {
        return None;
    }
    let mut best: Option<(&TableInfo, f64)> = None;
    for table in tables.iter().filter(|t| t.kind == "table") {
        let hits = columns
            .iter()
            .filter(|c| table.columns.iter().any(|tc| tc.name.eq_ignore_ascii_case(c)))
            .count();
        let score = hits as f64 / columns.len() as f64;
        let is_better = match best {
            None => score > 0.0,
            Some((current, best_score)) => {
                score > best_score
                    || (score == best_score && table.columns.len() < current.columns.len())
            }
        };
        if is_better {
            best = Some((table, score));
        }
    }
    best.filter(|(_, score)| *score >= MATCH_THRESHOLD).map(|(table, _)| table)
}

/// Quote an identifier for the engine (backticks for MySQL).
pub fn quote_ident(engine: Engine, name: &str) -> String {
    match engine {
        Engine::Mysql => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

/// A JSON cell as a SQL literal.
pub fn sql_literal(engine: Engine, value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(b) if engine == Engine::Postgres => b.to_string().to_uppercase(),
        Value::Bool(b) => if *b { "1" } else { "0" }.into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

/// One `INSERT` per row of `result` into the best-matching table.
pub fn generate_inserts(result: &QueryResult, tables: &[TableInfo], engine: Engine) -> InsertScript {
    let mut warnings = Vec::new();
    let Some(table) = match_table(&result.columns, tables) else {
        warnings.push(format!(
            "no table has at least {:.0}% of the result's columns",
            MATCH_THRESHOLD * 100.0
        ));
        return InsertScript { sql: String::new(), warnings };
    };
    let kept: Vec<usize> = (0..result.columns.len())
        .filter(|&i| table.columns.iter().any(|c| c.name.eq_ignore_ascii_case(&result.columns[i])))
        .collect();
    let skipped: Vec<&str> = (0..result.columns.len())
        .filter(|i| !kept.contains(i))
        .map(|i| result.columns[i].as_str())
        .collect();
    if !skipped.is_empty() {
        warnings.push(format!("columns not in {}: {}", table.name, skipped.join(", ")));
    }
    if result.truncated {
        warnings.push(format!(
            "only the first {} of {} rows were fetched",
            result.rows.len(),
            result.total_rows
        ));
    }

    let target = match &table.schema {
        Some(schema) => format!("{}.{}", quote_ident(engine, schema), quote_ident(engine, &table.name)),
        None => quote_ident(engine, &table.name),
    };
    let column_list = kept
        .iter()
        .map(|&i| quote_ident(engine, &result.columns[i]))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = result
        .rows
        .iter()
        .map(|row| {
            let values = kept
                .iter()
                .map(|&i| sql_literal(engine, row.get(i).unwrap_or(&Value::Null)))
                .collect::<Vec<_>>()
                .join(", ");
            format!("INSERT INTO {target} ({column_list}) VALUES ({values});")
        })
        .collect::<Vec<_>>()
        .join("\n");
    InsertScript { sql, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::ColumnInfo;
    use serde_json::json;

    fn table(name: &str, kind: &str, columns: &[&str]) -> TableInfo {
        TableInfo {
            name: name.into(),
            schema: None,
            kind: kind.into(),
            columns: columns
                .iter()
                .map(|c| ColumnInfo { name: (*c).into(), data_type: String::new(), notnull: false, pk: false })
                .collect(),
            foreign_keys: vec![],
            indexes: vec![],
            definition: None,
        }
    }

    fn result(columns: &[&str], rows: Vec<Vec<Value>>) -> QueryResult {
        QueryResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            total_rows: rows.len(),
            rows,
            rows_affected: 0,
            elapsed_ms: 0,
            truncated: false,
        }
    }

    #[test]
    fn matches_the_best_table_excluding_views() {
        let tables = [
            table("users_view", "view", &["id", "name"]),
            table("users", "table", &["id", "name", "email", "created_at"]),
            table("people", "table", &["id", "name", "email"]),
        ];
        let columns = vec!["id".to_string(), "NAME".to_string(), "email".to_string()];
        assert_eq!(match_table(&columns, &tables).unwrap().name, "people", "narrower wins a tie");
        assert!(match_table(&["x".to_string(), "y".to_string()], &tables).is_none());
    }

    #[test]
    fn writes_one_insert_per_row_with_engine_quoting() {
        let tables = [table("users", "table", &["id", "name", "active"])];
        let rows = vec![vec![json!(1), json!("O'Hara"), json!(true), json!(9)], vec![json!(2), Value::Null, json!(false), json!(9)]];
        let data = result(&["id", "name", "active", "total"], rows);

        let pg = generate_inserts(&data, &tables, Engine::Postgres);
        assert_eq!(
            pg.sql,
            "INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (1, 'O''Hara', TRUE);\n\
             INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (2, NULL, FALSE);"
        );
        assert_eq!(pg.warnings, vec!["columns not in users: total"]);

        let mysql = generate_inserts(&data, &tables, Engine::Mysql);
        assert!(mysql.sql.starts_with("INSERT INTO `users` (`id`, `name`, `active`) VALUES (1, 'O''Hara', 1);"));
    }
}
