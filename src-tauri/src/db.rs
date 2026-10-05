//! SQLite execution engine for Graft v0.1.
//!
//! `execute_sql` opens (creating if missing) a SQLite database at the given
//! path, runs the SQL, and returns a structured result the frontend can render
//! in a table. `introspect_schema` returns the tables/views with their columns
//! and foreign keys.

use std::time::Instant;

use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, Statement};

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
    pub elapsed_ms: u64,
    /// Total rows the query produced — may exceed `rows.len()`.
    pub total_rows: usize,
    /// True when `rows` was capped and isn't the whole result set.
    pub truncated: bool,
}

/// Open a single connection to the database file. A pool would be overkill:
/// each command runs one unit of work and closes the connection afterwards.
/// `filename()` (rather than URL parsing) keeps Windows paths and paths
/// containing `?` or `#` intact.
async fn connect(db_path: &str) -> Result<SqliteConnection, sqlx::Error> {
    SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .connect()
        .await
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

/// Skip leading whitespace and SQL comments (`-- …` and `/* … */`) so the
/// statement keyword can be inspected.
fn strip_leading_comments(sql: &str) -> &str {
    let mut rest = sql.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("--") {
            rest = after.find('\n').map_or("", |i| &after[i + 1..]).trim_start();
        } else if let Some(after) = rest.strip_prefix("/*") {
            rest = after.find("*/").map_or("", |i| &after[i + 2..]).trim_start();
        } else {
            return rest;
        }
    }
}

/// True when `word` appears in `haystack` as a standalone keyword (not as part
/// of a longer identifier). `haystack` must already be lowercase.
fn contains_keyword(haystack: &str, word: &str) -> bool {
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    haystack.match_indices(word).any(|(i, _)| {
        let before = haystack[..i].chars().next_back();
        let after = haystack[i + word.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

/// True for statements that yield a result set we should fetch and display.
fn returns_rows(sql: &str) -> bool {
    const ROW_KEYWORDS: [&str; 5] = ["select", "with", "pragma", "explain", "values"];
    let head = strip_leading_comments(sql).to_ascii_lowercase();
    ROW_KEYWORDS.iter().any(|k| head.starts_with(k)) || contains_keyword(&head, "returning")
}

/// Fetch a result set, converting at most `max_rows` rows to JSON. The rest of
/// the stream is only counted — never materialized — so a huge result costs
/// neither memory nor IPC payload.
async fn fetch_rows(
    conn: &mut SqliteConnection,
    sql: &str,
    max_rows: usize,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>, usize), sqlx::Error> {
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0usize;

    {
        let mut stream = sqlx::query(sql).fetch(&mut *conn);
        while let Some(row) = stream.try_next().await? {
            if total_rows == 0 {
                columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            }
            if total_rows < max_rows {
                rows.push((0..row.len()).map(|i| cell_to_json(&row, i)).collect());
            }
            total_rows += 1;
        }
    }

    // An empty result still has columns: ask SQLite for the statement's shape
    // so the UI can show headers. Best effort — some scripts can't be prepared.
    if columns.is_empty() {
        if let Ok(stmt) = conn.prepare(sql).await {
            columns = stmt.columns().iter().map(|c| c.name().to_string()).collect();
        }
    }

    Ok((columns, rows, total_rows))
}

async fn run(db_path: &str, sql: &str, max_rows: usize) -> Result<QueryResult, sqlx::Error> {
    let mut conn = connect(db_path).await?;

    let started = Instant::now();
    let result = if returns_rows(sql) {
        let (columns, rows, total_rows) = fetch_rows(&mut conn, sql, max_rows).await?;
        QueryResult {
            columns,
            truncated: total_rows > rows.len(),
            rows,
            rows_affected: 0,
            elapsed_ms: elapsed_ms(started),
            total_rows,
        }
    } else {
        let outcome = sqlx::query(sql).execute(&mut conn).await?;
        QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: outcome.rows_affected(),
            elapsed_ms: elapsed_ms(started),
            total_rows: 0,
            truncated: false,
        }
    };

    conn.close().await?;
    Ok(result)
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Execute SQL against the SQLite database at `db_path`.
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
    /// Empty when the FK implicitly targets the parent's primary key.
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

async fn table_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<ColumnInfo>, sqlx::Error> {
    // Table-valued pragma functions take the name as a bound parameter, so no
    // identifier escaping is needed.
    let rows: Vec<(String, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT name, type, \"notnull\", pk FROM pragma_table_info(?) ORDER BY cid",
    )
    .bind(table)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(name, data_type, notnull, pk)| ColumnInfo {
            name,
            data_type: data_type.unwrap_or_default(),
            notnull: notnull != 0,
            pk: pk != 0,
        })
        .collect())
}

async fn table_foreign_keys(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<ForeignKey>, sqlx::Error> {
    // Views have no foreign keys; the pragma simply returns an empty set.
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT \"from\", \"table\", \"to\" FROM pragma_foreign_key_list(?) ORDER BY id, seq",
    )
    .bind(table)
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(column, to_table, to_column)| ForeignKey {
            column,
            to_table,
            to_column: to_column.unwrap_or_default(),
        })
        .collect())
}

async fn introspect(db_path: &str) -> Result<Vec<TableInfo>, sqlx::Error> {
    let mut conn = connect(db_path).await?;

    let entries: Vec<(String, String)> = sqlx::query_as(
        "SELECT name, type FROM sqlite_master \
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
         ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await?;

    let mut schema = Vec::with_capacity(entries.len());
    for (name, kind) in entries {
        let columns = table_columns(&mut conn, &name).await?;
        let foreign_keys = table_foreign_keys(&mut conn, &name).await?;
        schema.push(TableInfo {
            name,
            kind,
            columns,
            foreign_keys,
        });
    }

    conn.close().await?;
    Ok(schema)
}

/// Introspect the SQLite database at `db_path`: tables/views with their
/// columns (type, notnull, pk) and foreign keys. Powers editor autocompletion
/// and the relation-aware (ORM) features; cached in the project file.
#[tauri::command]
pub async fn introspect_schema(db_path: String) -> Result<Vec<TableInfo>, String> {
    introspect(&db_path).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_row_returning_statements() {
        assert!(returns_rows("SELECT 1"));
        assert!(returns_rows("  with x as (select 1) select * from x"));
        assert!(returns_rows("-- comment\nSELECT 1"));
        assert!(returns_rows("/* block */ -- line\n  select 1"));
        assert!(returns_rows("VALUES (1), (2)"));
        assert!(returns_rows("INSERT INTO t (a) VALUES (1) RETURNING id"));
        assert!(!returns_rows("INSERT INTO returning_log (a) VALUES (1)"));
        assert!(!returns_rows("-- migration\nCREATE TABLE t (id INTEGER)"));
        assert!(!returns_rows("UPDATE t SET a = 1"));
    }

    #[tokio::test]
    async fn executes_and_caps_rows() {
        let dir = std::env::temp_dir().join(format!("graft-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("t.db");
        let db = db.to_string_lossy();

        run(&db, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", 10)
            .await
            .unwrap();
        let inserted = run(&db, "INSERT INTO t (name) VALUES ('a'), ('b'), ('c')", 10)
            .await
            .unwrap();
        assert_eq!(inserted.rows_affected, 3);

        let capped = run(&db, "-- all rows\nSELECT * FROM t", 2).await.unwrap();
        assert_eq!(capped.columns, vec!["id", "name"]);
        assert_eq!(capped.rows.len(), 2);
        assert_eq!(capped.total_rows, 3);
        assert!(capped.truncated);

        let empty = run(&db, "SELECT id, name FROM t WHERE 0", 10).await.unwrap();
        assert_eq!(empty.columns, vec!["id", "name"]);
        assert!(empty.rows.is_empty());

        let schema = introspect(&db).await.unwrap();
        assert_eq!(schema.len(), 1);
        assert_eq!(schema[0].columns.len(), 2);
        assert!(schema[0].columns[0].pk);

        std::fs::remove_dir_all(&dir).ok();
    }
}
