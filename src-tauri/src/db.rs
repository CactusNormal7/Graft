//! Tauri commands for SQL execution and schema introspection. The engine lives
//! in `graft_core::db`; these only adapt it to the IPC signatures.

use graft_core::db::{self, OpenOptions, QueryResult, TableInfo};

/// Execute SQL against the SQLite database at `db_path` (created if missing).
/// `max_rows` caps how many rows are returned (defaults to `DEFAULT_MAX_ROWS`).
#[tauri::command]
pub async fn execute_sql(
    db_path: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    db::execute_sql(&db_path, &sql, max_rows, OpenOptions::default()).await
}

/// Introspect the SQLite database at `db_path`: tables/views with their
/// columns and foreign keys.
#[tauri::command]
pub async fn introspect_schema(db_path: String) -> Result<Vec<TableInfo>, String> {
    db::introspect_schema(&db_path, OpenOptions::default()).await
}
