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

/// Default cap on how many rows are converted to JSON and shipped to the
/// frontend. The UI paginates anyway, and serializing a very large result over
/// the Tauri IPC bridge is what makes a big query feel slow.
const DEFAULT_MAX_ROWS: usize = 5_000;

/// Result of running a single SQL statement.
#[derive(Serialize)]
pub struct QueryResult {
    /// Column names (empty for statements that return no rows).
    pub columns: Vec<String>,
    /// Row values, each cell serialized to a JSON value. Capped at `max_rows`.
    pub rows: Vec<Vec<serde_json::Value>>,
    /// Rows affected, for INSERT/UPDATE/DELETE/DDL statements.
    pub rows_affected: u64,
    /// Wall-clock execution time in milliseconds.
    pub elapsed_ms: u128,
    /// Total rows the query produced — may exceed `rows.len()`.
    pub total_rows: usize,
    /// True when `rows` was capped and isn't the whole result set.
    pub truncated: bool,
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

async fn run(db_path: &str, sql: &str, max_rows: usize) -> Result<QueryResult, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(db_path)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    let started = Instant::now();
    let result = if returns_rows(sql) {
        let fetched = sqlx::query(sql).fetch_all(&pool).await?;
        let columns = fetched
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();
        let total_rows = fetched.len();
        let truncated = total_rows > max_rows;
        // Convert only the rows we actually ship: the JSON conversion and the
        // IPC serialization are the expensive part of a large result.
        let rows = fetched
            .iter()
            .take(max_rows)
            .map(|row| (0..row.len()).map(|i| cell_to_json(row, i)).collect())
            .collect();
        QueryResult {
            columns,
            rows,
            rows_affected: 0,
            elapsed_ms: started.elapsed().as_millis(),
            total_rows,
            truncated,
        }
    } else {
        let outcome = sqlx::query(sql).execute(&pool).await?;
        QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: outcome.rows_affected(),
            elapsed_ms: started.elapsed().as_millis(),
            total_rows: 0,
            truncated: false,
        }
    };

    pool.close().await;
    Ok(result)
}

/// Execute one SQL statement against the SQLite database at `db_path`.
/// `max_rows` caps how many rows are returned (defaults to `DEFAULT_MAX_ROWS`).
/// Errors are returned as their string representation for display in the block.
#[tauri::command]
pub async fn execute_sql(
    db_path: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    let max = max_rows.unwrap_or(DEFAULT_MAX_ROWS).max(1);
    run(&db_path, &sql, max).await.map_err(|e| e.to_string())
}

/// One column of a table/view.
#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    /// Declared SQLite type (may be empty for views / untyped columns).
    pub data_type: String,
    pub notnull: bool,
    /// True when the column is part of the primary key.
    pub pk: bool,
}

/// A foreign key: `column` in this table references `to_table(to_column)`.
#[derive(Serialize)]
pub struct ForeignKey {
    pub column: String,
    pub to_table: String,
    pub to_column: String,
}

/// A table or view, with everything the ORM/nested features need to rebuild
/// relations without re-deriving them from query results.
#[derive(Serialize)]
pub struct TableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKey>,
}

async fn introspect(db_path: &str) -> Result<Vec<TableInfo>, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(db_path)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    // (name, type) so we can tag views vs tables.
    let entries: Vec<(String, String)> = sqlx::query_as(
        "SELECT name, type FROM sqlite_master \
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
         ORDER BY name",
    )
    .fetch_all(&pool)
    .await?;

    let mut schema = Vec::with_capacity(entries.len());
    for (table, kind) in entries {
        let escaped = table.replace('"', "\"\"");

        // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk.
        let rows = sqlx::query(&format!("PRAGMA table_info(\"{escaped}\")"))
            .fetch_all(&pool)
            .await?;
        let columns = rows
            .iter()
            .map(|r| ColumnInfo {
                name: r.get::<String, _>("name"),
                data_type: r.try_get::<String, _>("type").unwrap_or_default(),
                notnull: r.try_get::<i64, _>("notnull").unwrap_or(0) != 0,
                pk: r.try_get::<i64, _>("pk").unwrap_or(0) != 0,
            })
            .collect();

        // PRAGMA foreign_key_list columns: id, seq, table, from, to, ...
        // Views have none; the pragma simply returns an empty set.
        let fk_rows = sqlx::query(&format!("PRAGMA foreign_key_list(\"{escaped}\")"))
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        let foreign_keys = fk_rows
            .iter()
            .map(|r| {
                let to_table = r.try_get::<String, _>("table").unwrap_or_default();
                let column = r.try_get::<String, _>("from").unwrap_or_default();
                // `to` is NULL when the FK targets the parent's primary key.
                let to_column = r
                    .try_get::<Option<String>, _>("to")
                    .unwrap_or(None)
                    .unwrap_or_default();
                ForeignKey {
                    column,
                    to_table,
                    to_column,
                }
            })
            .collect();

        schema.push(TableInfo {
            name: table,
            kind,
            columns,
            foreign_keys,
        });
    }

    pool.close().await;
    Ok(schema)
}

/// Introspect the SQLite database at `db_path`: tables/views with their
/// columns (type, notnull, pk) and foreign keys. Powers editor autocompletion
/// and the relation-aware (ORM) features; cached in the project file.
#[tauri::command]
pub async fn introspect_schema(db_path: String) -> Result<Vec<TableInfo>, String> {
    introspect(&db_path).await.map_err(|e| e.to_string())
}
