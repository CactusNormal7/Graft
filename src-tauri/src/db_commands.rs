//! Tauri commands over `db`: they resolve the password from the keychain
//! (the webview never holds one after the connection form is submitted) and
//! map errors to what the frontend displays.

use tauri::State;

use crate::db::{self, ConnectionConfig, Databases, QueryResult, SchemaSnapshot, SqlError};
use crate::secrets;

fn stored_password(config: &ConnectionConfig) -> Result<Option<String>, SqlError> {
    match config.engine {
        db::Engine::Sqlite => Ok(None),
        db::Engine::Postgres | db::Engine::Mysql => Ok(secrets::password(&config.id)?),
    }
}

/// Run SQL on the project's connection. `max_rows` caps the returned rows
/// (defaults to `DEFAULT_MAX_ROWS`).
#[tauri::command]
pub async fn execute_sql(
    databases: State<'_, Databases>,
    connection: ConnectionConfig,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, SqlError> {
    let password = stored_password(&connection)?;
    let max_rows = max_rows.unwrap_or(db::DEFAULT_MAX_ROWS);
    databases
        .execute(&connection, password.as_deref(), &sql, max_rows)
        .await
}

/// Introspect the connection's database: tables/views, columns, keys…
#[tauri::command]
pub async fn introspect_schema(
    databases: State<'_, Databases>,
    connection: ConnectionConfig,
) -> Result<SchemaSnapshot, SqlError> {
    let password = stored_password(&connection)?;
    databases.introspect(&connection, password.as_deref()).await
}

/// Try the connection without keeping it. `password` is the one typed in the
/// form (not stored yet); without it the stored one is used.
#[tauri::command]
pub async fn test_connection(
    connection: ConnectionConfig,
    password: Option<String>,
) -> Result<String, SqlError> {
    let password = match password {
        Some(typed) => Some(typed),
        None => stored_password(&connection)?,
    };
    db::test_connection(&connection, password.as_deref()).await
}

/// Store (or, with an empty password, remove) a connection's password, and
/// drop its open connection so the next run uses the new credentials.
#[tauri::command]
pub fn set_connection_password(
    databases: State<'_, Databases>,
    connection_id: String,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        secrets::delete_password(&connection_id)?;
    } else {
        secrets::set_password(&connection_id, &password)?;
    }
    databases.forget(&connection_id);
    Ok(())
}

/// Whether a password is stored for the connection (the value is never sent).
#[tauri::command]
pub fn has_connection_password(connection_id: String) -> Result<bool, String> {
    Ok(secrets::password(&connection_id)?.is_some())
}
