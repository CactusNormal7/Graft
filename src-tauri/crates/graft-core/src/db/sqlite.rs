//! SQLite engine: one connection per call (opening a local file is cheap,
//! and nothing stays locked between runs), statement-at-a-time execution with
//! typed cells, exact error positions, and introspection through pragmas.

use std::time::Instant;

use futures_util::TryStreamExt;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, Statement};

use super::schema::{ColumnInfo, ForeignKey, IndexInfo, SchemaSnapshot, TableInfo, TriggerInfo};
use super::{elapsed_ms, returns_rows, utf16_offset, QueryResult, SqlError};

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

/// Re-prepare the statements of `sql` one by one (preparing executes
/// nothing) until one fails with `message`, and return the error's byte offset
/// in `sql`. Needed because sqlx clears the error state (finalizing earlier
/// statements) before `sqlite3_error_offset` can be read, and because that
/// offset is relative to the failing statement, not to the whole script.
///
/// # Safety
/// `db` must be a valid connection handle that no other thread is using.
unsafe fn locate_by_preparing(
    db: *mut libsqlite3_sys::sqlite3,
    sql: &str,
    message: &str,
) -> Option<usize> {
    use libsqlite3_sys as ffi;
    use std::ffi::{CStr, CString};

    let text = CString::new(sql).ok()?;
    let base = text.as_ptr();
    let mut tail = base;
    loop {
        let mut statement = std::ptr::null_mut();
        let mut next = std::ptr::null();
        let rc = ffi::sqlite3_prepare_v2(db, tail, -1, &mut statement, &mut next);
        ffi::sqlite3_finalize(statement);
        let statement_start = usize::try_from(tail.offset_from(base)).ok()?;
        if rc != ffi::SQLITE_OK {
            // A different error means this statement depends on an earlier one
            // having run (e.g. a table it creates): the position is unknown.
            let reason = CStr::from_ptr(ffi::sqlite3_errmsg(db)).to_string_lossy();
            let offset = usize::try_from(ffi::sqlite3_error_offset(db)).ok()?;
            return message.contains(reason.as_ref()).then_some(statement_start + offset);
        }
        if next.is_null() || *next == 0 || next == tail {
            return None;
        }
        tail = next;
    }
}

/// Where SQLite places the error `message` raised while running `sql`, as a
/// byte offset.
async fn sqlite_error_position(
    conn: &mut SqliteConnection,
    sql: &str,
    message: &str,
) -> Option<usize> {
    let mut handle = conn.lock_handle().await.ok()?;
    // SAFETY: the locked handle guarantees sqlx's worker thread is not using
    // the connection while we prepare (and never execute) statements on it.
    unsafe { locate_by_preparing(handle.as_raw_handle().as_ptr(), sql, message) }
}

/// Run `sql` against the SQLite file at `db_path` (created if missing).
pub async fn run(db_path: &str, sql: &str, max_rows: usize) -> Result<QueryResult, SqlError> {
    let mut conn = connect(db_path).await?;
    match execute(&mut conn, sql, max_rows).await {
        Ok(result) => {
            conn.close().await?;
            Ok(result)
        }
        Err(err) => {
            let message = err.to_string();
            let position = sqlite_error_position(&mut conn, sql, &message)
                .await
                .filter(|&byte| byte < sql.len() && sql.is_char_boundary(byte))
                .map(|byte| utf16_offset(sql, byte));
            Err(SqlError { message, position })
        }
    }
}

async fn execute(
    conn: &mut SqliteConnection,
    sql: &str,
    max_rows: usize,
) -> Result<QueryResult, sqlx::Error> {
    let started = Instant::now();
    let result = if returns_rows(sql) {
        let (columns, rows, total_rows) = fetch_rows(conn, sql, max_rows).await?;
        QueryResult {
            columns,
            truncated: total_rows > rows.len(),
            rows,
            rows_affected: 0,
            elapsed_ms: elapsed_ms(started),
            total_rows,
        }
    } else {
        let outcome = sqlx::query(sql).execute(&mut *conn).await?;
        QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: outcome.rows_affected(),
            elapsed_ms: elapsed_ms(started),
            total_rows: 0,
            truncated: false,
        }
    };
    Ok(result)
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

async fn table_indexes(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<IndexInfo>, sqlx::Error> {
    let entries: Vec<(String, bool, String)> =
        sqlx::query_as("SELECT name, \"unique\", origin FROM pragma_index_list(?) ORDER BY seq")
            .bind(table)
            .fetch_all(&mut *conn)
            .await?;
    let mut indexes = Vec::with_capacity(entries.len());
    for (name, unique, origin) in entries {
        // `name` is NULL for expression columns.
        let columns: Vec<(Option<String>,)> =
            sqlx::query_as("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                .bind(&name)
                .fetch_all(&mut *conn)
                .await?;
        indexes.push(IndexInfo {
            columns: columns
                .into_iter()
                .map(|(column,)| column.unwrap_or_else(|| "<expression>".into()))
                .collect(),
            name,
            unique,
            primary: origin == "pk",
        });
    }
    Ok(indexes)
}

/// Timing and events of a `CREATE TRIGGER` statement (SQLite keeps only the
/// SQL text). Timing defaults to BEFORE, as in SQLite.
pub fn trigger_header(sql: &str) -> (String, String) {
    let upper = sql.to_ascii_uppercase();
    let words: Vec<&str> = upper.split_whitespace().collect();
    let header: Vec<&str> = words.iter().copied().take_while(|w| *w != "ON").collect();
    let timing = if header.windows(2).any(|w| w == ["INSTEAD", "OF"]) {
        "INSTEAD OF"
    } else if header.contains(&"AFTER") {
        "AFTER"
    } else {
        "BEFORE"
    };
    let events: Vec<&str> = ["INSERT", "UPDATE", "DELETE"]
        .into_iter()
        .filter(|event| header.contains(event))
        .collect();
    (timing.to_string(), events.join(", "))
}

/// Tables, views, indexes and triggers of the SQLite file at `db_path`.
/// (SQLite has no stored procedures.)
pub async fn introspect(db_path: &str) -> Result<SchemaSnapshot, sqlx::Error> {
    let mut conn = connect(db_path).await?;

    let entries: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT name, type, sql FROM sqlite_master \
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
         ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await?;

    let mut tables = Vec::with_capacity(entries.len());
    for (name, kind, sql) in entries {
        let columns = table_columns(&mut conn, &name).await?;
        let foreign_keys = table_foreign_keys(&mut conn, &name).await?;
        let indexes = table_indexes(&mut conn, &name).await?;
        tables.push(TableInfo {
            definition: if kind == "view" { sql } else { None },
            name,
            schema: None,
            kind,
            columns,
            foreign_keys,
            indexes,
        });
    }

    let trigger_rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await?;
    let triggers = trigger_rows
        .into_iter()
        .map(|(name, table, sql)| {
            let definition = sql.unwrap_or_default();
            let (timing, events) = trigger_header(&definition);
            TriggerInfo { name, table, schema: None, timing, events, definition }
        })
        .collect();

    conn.close().await?;
    Ok(SchemaSnapshot { tables, triggers, routines: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

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

        run(
            &db,
            "CREATE UNIQUE INDEX t_name ON t (name);\
             CREATE VIEW v AS SELECT name FROM t;\
             CREATE TRIGGER t_audit AFTER UPDATE OF name ON t BEGIN SELECT 1; END;",
            10,
        )
        .await
        .unwrap();
        let snapshot = introspect(&db).await.unwrap();
        let schema = snapshot.tables;
        assert_eq!(schema.len(), 2);
        assert_eq!(schema[0].columns.len(), 2);
        assert!(schema[0].columns[0].pk);
        assert_eq!(schema[0].indexes.len(), 1);
        assert_eq!(schema[0].indexes[0].columns, vec!["name"]);
        assert!(schema[0].indexes[0].unique);
        assert_eq!(schema[1].kind, "view");
        assert!(schema[1].definition.as_deref().unwrap_or("").contains("SELECT name"));
        assert_eq!(snapshot.triggers.len(), 1);
        assert_eq!(snapshot.triggers[0].table, "t");
        assert_eq!(snapshot.triggers[0].timing, "AFTER");
        assert_eq!(snapshot.triggers[0].events, "UPDATE");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_trigger_headers() {
        assert_eq!(
            trigger_header("CREATE TRIGGER x INSTEAD OF INSERT ON v BEGIN SELECT 1; END"),
            ("INSTEAD OF".into(), "INSERT".into())
        );
        assert_eq!(
            trigger_header("create temp trigger if not exists x delete on t begin select 1; end"),
            ("BEFORE".into(), "DELETE".into())
        );
    }

    #[tokio::test]
    async fn reports_syntax_errors_with_the_offending_token() {
        let dir = std::env::temp_dir().join(format!("graft-err-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("e.db");
        let err = run(&db.to_string_lossy(), "SELECT * FORM t", 10)
            .await
            .err()
            .expect("syntax error");
        assert!(err.message.contains("near \"FORM\""), "{}", err.message);
        assert_eq!(err.position, Some(9));

        // Second statement, and the token also appears earlier: the engine's
        // offset (relative to the statement) picks the right occurrence.
        let script = "SELECT 'é' AS id;\nSELECT id, x FROM t wher id = 1";
        let err = run(&db.to_string_lossy(), script, 10)
            .await
            .err()
            .expect("syntax error");
        let expected = script.rfind("id =").unwrap();
        assert_eq!(err.position, Some(utf16_offset(script, expected)), "{}", err.message);

        // An error that depends on an earlier statement having run: preparing
        // alone fails differently, so no position is claimed.
        let script = "CREATE TABLE fresh (a INT); SELECT b FROM fresh";
        let err = run(&db.to_string_lossy(), script, 10)
            .await
            .err()
            .expect("unknown column");
        assert!(err.message.contains("no such column"), "{}", err.message);
        assert_eq!(err.position, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
