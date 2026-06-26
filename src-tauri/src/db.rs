//! SQLite execution engine for Graft v0.1.
//!
//! A single Tauri command, `execute_sql`, opens (creating if missing) a SQLite
//! database at the given path, runs one statement, and returns a structured
//! result the frontend can render in a table.

use std::str::FromStr;
use std::time::Instant;

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteRow};
use sqlx::{Column, Row, SqlitePool};

/// Result of running a single SQL statement.
#[derive(Serialize)]
pub struct QueryResult {
    /// Column names (empty for statements that return no rows).
    pub columns: Vec<String>,
    /// Row values, each cell serialized to a JSON value.
    pub rows: Vec<Vec<serde_json::Value>>,
    /// Rows affected, for INSERT/UPDATE/DELETE/DDL statements.
    pub rows_affected: u64,
    /// Wall-clock execution time in milliseconds.
    pub elapsed_ms: u128,
}

/// SQLite is loosely typed, so we probe a handful of concrete Rust types in
/// turn and return the first that decodes. Good enough for v0.1; richer type
/// mapping can come with the schema explorer in v0.3.
fn cell_to_json(row: &SqliteRow, idx: usize) -> serde_json::Value {
    use serde_json::Value;

    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return v.map_or(Value::Null, Value::from);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(idx) {
        return v.map_or(Value::Null, Value::from);
    }
    if let Ok(v) = row.try_get::<Option<bool>, _>(idx) {
        return v.map_or(Value::Null, Value::from);
    }
    if let Ok(v) = row.try_get::<Option<String>, _>(idx) {
        return v.map_or(Value::Null, Value::from);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return v.map_or(Value::Null, |b| Value::from(format!("<{} bytes>", b.len())));
    }
    Value::Null
}

/// True for statements that yield a result set we should fetch and display.
fn returns_rows(sql: &str) -> bool {
    let head = sql.trim_start().to_ascii_lowercase();
    head.starts_with("select")
        || head.starts_with("with")
        || head.starts_with("pragma")
        || head.starts_with("explain")
}

async fn run(db_path: &str, sql: &str) -> Result<QueryResult, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(db_path)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    let started = Instant::now();
    let result = if returns_rows(sql) {
        let fetched = sqlx::query(sql).fetch_all(&pool).await?;
        let columns = fetched
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();
        let rows = fetched
            .iter()
            .map(|row| (0..row.len()).map(|i| cell_to_json(row, i)).collect())
            .collect();
        QueryResult {
            columns,
            rows,
            rows_affected: 0,
            elapsed_ms: started.elapsed().as_millis(),
        }
    } else {
        let outcome = sqlx::query(sql).execute(&pool).await?;
        QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: outcome.rows_affected(),
            elapsed_ms: started.elapsed().as_millis(),
        }
    };

    pool.close().await;
    Ok(result)
}

/// Execute one SQL statement against the SQLite database at `db_path`.
/// Errors are returned as their string representation for display in the block.
#[tauri::command]
pub async fn execute_sql(db_path: String, sql: String) -> Result<QueryResult, String> {
    run(&db_path, &sql).await.map_err(|e| e.to_string())
}
