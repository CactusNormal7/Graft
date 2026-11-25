//! Database engines behind one API: SQLite, Postgres, MySQL (all through
//! sqlx). Nothing here depends on Tauri, so the same code can serve the app
//! and other front ends.
//!
//! - SQLite: a connection per call (see `sqlite.rs`).
//! - Postgres / MySQL: one pooled connection per configured connection, kept
//!   open between runs. A single connection means a single *session*: `SET`,
//!   temporary tables and transactions behave like in a SQL console.

pub mod config;
#[cfg(test)]
mod integration_tests;
mod mysql;
mod postgres;
pub mod schema;
mod server;
mod sqlite;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Connection;

pub use config::{ConnectionConfig, Engine};
pub use schema::SchemaSnapshot;

/// Default cap on how many rows are converted to JSON and returned. The UI
/// paginates anyway, and serializing a very large result is what makes a big
/// query feel slow.
pub const DEFAULT_MAX_ROWS: usize = 5_000;

/// How long to wait for a server connection before giving up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Result of running SQL.
#[derive(Serialize, Debug, Clone)]
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

/// An execution error, structured so the editor can underline it.
#[derive(Serialize, Debug)]
pub struct SqlError {
    /// Human-readable message, as reported by the engine.
    pub message: String,
    /// Offset of the error in the executed SQL, in UTF-16 code units (a
    /// JavaScript string index), when the engine reports one. Otherwise the
    /// frontend locates the token quoted in the message.
    pub position: Option<usize>,
}

impl SqlError {
    pub fn new(message: impl Into<String>) -> Self {
        SqlError { message: message.into(), position: None }
    }
}

impl From<sqlx::Error> for SqlError {
    fn from(err: sqlx::Error) -> Self {
        SqlError::new(err.to_string())
    }
}

impl From<String> for SqlError {
    fn from(message: String) -> Self {
        SqlError::new(message)
    }
}

pub(crate) fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// `byte_offset` (into `sql`) as a JavaScript string index.
pub(crate) fn utf16_offset(sql: &str, byte_offset: usize) -> usize {
    sql[..byte_offset].encode_utf16().count()
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

/// True for SQLite statements that yield a result set to fetch and display.
pub(crate) fn returns_rows(sql: &str) -> bool {
    const ROW_KEYWORDS: [&str; 5] = ["select", "with", "pragma", "explain", "values"];
    let head = strip_leading_comments(sql).to_ascii_lowercase();
    ROW_KEYWORDS.iter().any(|k| head.starts_with(k)) || contains_keyword(&head, "returning")
}

#[derive(Clone)]
enum ServerPool {
    Postgres(PgPool),
    Mysql(MySqlPool),
}

/// Open server connections, keyed by connection id. An entry is reused only
/// while its configuration is unchanged.
#[derive(Default)]
pub struct Databases {
    pools: Mutex<HashMap<String, (ConnectionConfig, ServerPool)>>,
}

impl Databases {
    fn cached(&self, config: &ConnectionConfig) -> Option<ServerPool> {
        let pools = self.pools.lock().unwrap_or_else(|e| e.into_inner());
        pools
            .get(&config.id)
            .filter(|(cached, _)| cached == config)
            .map(|(_, pool)| pool.clone())
    }

    async fn pool(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<ServerPool, SqlError> {
        if let Some(pool) = self.cached(config) {
            return Ok(pool);
        }
        config.validate()?;
        let pool = match config.engine {
            Engine::Postgres => ServerPool::Postgres(
                PgPoolOptions::new()
                    .max_connections(1)
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect_with(postgres::connect_options(config, password)?)
                    .await?,
            ),
            Engine::Mysql => ServerPool::Mysql(
                MySqlPoolOptions::new()
                    .max_connections(1)
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect_with(mysql::connect_options(config, password)?)
                    .await?,
            ),
            Engine::Sqlite => return Err(SqlError::new("SQLite connections are not pooled")),
        };
        let mut pools = self.pools.lock().unwrap_or_else(|e| e.into_inner());
        pools.insert(config.id.clone(), (config.clone(), pool.clone()));
        Ok(pool)
    }

    /// Drop the open connection of `connection_id` (after its password or
    /// settings changed), so the next call reconnects.
    pub fn forget(&self, connection_id: &str) {
        let mut pools = self.pools.lock().unwrap_or_else(|e| e.into_inner());
        pools.remove(connection_id);
    }

    /// Run `sql` (possibly several statements) on the connection.
    pub async fn execute(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
        sql: &str,
        max_rows: usize,
    ) -> Result<QueryResult, SqlError> {
        let max_rows = max_rows.max(1);
        match config.engine {
            Engine::Sqlite => sqlite::run(config.sqlite_path()?, sql, max_rows).await,
            Engine::Postgres | Engine::Mysql => match self.pool(config, password).await? {
                ServerPool::Postgres(pool) => server::run_script(&pool, sql, max_rows)
                    .await
                    .map_err(|err| SqlError {
                        position: postgres::error_position(&err, sql),
                        message: err.to_string(),
                    }),
                ServerPool::Mysql(pool) => {
                    Ok(server::run_script(&pool, sql, max_rows).await?)
                }
            },
        }
    }

    /// Structure of the database behind the connection.
    pub async fn introspect(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<SchemaSnapshot, SqlError> {
        match config.engine {
            Engine::Sqlite => Ok(sqlite::introspect(config.sqlite_path()?).await?),
            Engine::Postgres | Engine::Mysql => match self.pool(config, password).await? {
                ServerPool::Postgres(pool) => Ok(postgres::introspect(&mut *pool.acquire().await?).await?),
                ServerPool::Mysql(pool) => Ok(mysql::introspect(&mut *pool.acquire().await?).await?),
            },
        }
    }
}

/// Connect once with a fresh connection (nothing cached) and report the
/// server version — the "Test connection" button.
pub async fn test_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<String, SqlError> {
    config.validate()?;
    let version: String = match config.engine {
        Engine::Sqlite => {
            let result = sqlite::run(config.sqlite_path()?, "SELECT 'SQLite ' || sqlite_version()", 1).await?;
            result.rows.first().and_then(|row| row.first()).and_then(|v| v.as_str()).unwrap_or("SQLite").to_string()
        }
        Engine::Postgres => {
            let mut conn = sqlx::PgConnection::connect_with(&postgres::connect_options(config, password)?).await?;
            let version = sqlx::query_scalar("SELECT version()").fetch_one(&mut conn).await?;
            conn.close().await?;
            version
        }
        Engine::Mysql => {
            let mut conn = sqlx::MySqlConnection::connect_with(&mysql::connect_options(config, password)?).await?;
            let version: String = sqlx::query_scalar("SELECT CAST(VERSION() AS CHAR)").fetch_one(&mut conn).await?;
            conn.close().await?;
            format!("MySQL {version}")
        }
    };
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::SslMode;

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

    #[test]
    fn converts_byte_offsets_to_javascript_indices() {
        assert_eq!(utf16_offset("é😀x", "é😀".len()), 3);
    }

    #[tokio::test]
    async fn sqlite_runs_through_the_shared_api() {
        let dir = std::env::temp_dir().join(format!("graft-api-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let config = ConnectionConfig {
            id: "local".into(),
            engine: Engine::Sqlite,
            path: Some(dir.join("api.db").to_string_lossy().into_owned()),
            host: None,
            port: None,
            database: None,
            user: None,
            ssl_mode: SslMode::Prefer,
        };
        let databases = Databases::default();
        databases.execute(&config, None, "CREATE TABLE t (id INTEGER PRIMARY KEY)", 10).await.unwrap();
        assert_eq!(databases.introspect(&config, None).await.unwrap().tables.len(), 1);
        assert!(test_connection(&config, None).await.unwrap().starts_with("SQLite 3."));
        std::fs::remove_dir_all(&dir).ok();
    }
}
