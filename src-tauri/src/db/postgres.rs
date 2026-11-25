//! Postgres specifics: connection options, error positions, introspection.

use std::collections::HashMap;

use sqlx::postgres::{PgConnectOptions, PgDatabaseError, PgErrorPosition, PgSslMode};
use sqlx::PgConnection;

use super::config::{ConnectionConfig, SslMode};
use super::schema::{ColumnInfo, ForeignKey, SchemaSnapshot, TableInfo};
use super::utf16_offset;

/// Schema whose tables are shown unqualified (Postgres' default search path).
const DEFAULT_SCHEMA: &str = "public";
/// System schemas never shown in the explorer.
const SYSTEM_SCHEMA_FILTER: &str = "n.nspname NOT IN ('pg_catalog', 'information_schema') \
     AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'";

pub fn connect_options(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<PgConnectOptions, String> {
    let mut options = PgConnectOptions::new()
        .host(config.host()?)
        .port(config.port())
        .username(config.user()?)
        .ssl_mode(match config.ssl_mode {
            SslMode::Disable => PgSslMode::Disable,
            SslMode::Prefer => PgSslMode::Prefer,
            SslMode::Require => PgSslMode::Require,
            SslMode::VerifyFull => PgSslMode::VerifyFull,
        })
        .application_name("Graft");
    if let Some(database) = config.database() {
        options = options.database(database);
    }
    if let Some(password) = password {
        options = options.password(password);
    }
    Ok(options)
}

/// Error position as a JavaScript string index into `sql`. Postgres reports a
/// 1-based character position in the query string it received.
pub fn error_position(err: &sqlx::Error, sql: &str) -> Option<usize> {
    let pg = err.as_database_error()?.try_downcast_ref::<PgDatabaseError>()?;
    let PgErrorPosition::Original(position) = pg.position()? else {
        return None;
    };
    let (byte, _) = sql.char_indices().nth(position.checked_sub(1)?)?;
    Some(utf16_offset(sql, byte))
}

fn display_schema(schema: String) -> Option<String> {
    (schema != DEFAULT_SCHEMA).then_some(schema)
}

pub async fn introspect(conn: &mut PgConnection) -> Result<SchemaSnapshot, sqlx::Error> {
    let columns: Vec<(String, String, String, String, String, bool, bool)> = sqlx::query_as(&format!(
        "SELECT n.nspname::text, c.relname::text, c.relkind::text, a.attname::text, \
                format_type(a.atttypid, a.atttypmod), a.attnotnull, \
                COALESCE(a.attnum = ANY(pk.indkey), false) \
         FROM pg_class c \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped \
         LEFT JOIN pg_index pk ON pk.indrelid = c.oid AND pk.indisprimary \
         WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND {SYSTEM_SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname, a.attnum"
    ))
    .fetch_all(&mut *conn)
    .await?;

    let foreign_keys: Vec<(String, String, String, String, String)> = sqlx::query_as(&format!(
        "SELECT n.nspname::text, cl.relname::text, a.attname::text, fcl.relname::text, fa.attname::text \
         FROM pg_constraint co \
         JOIN pg_class cl ON cl.oid = co.conrelid \
         JOIN pg_namespace n ON n.oid = cl.relnamespace \
         JOIN pg_class fcl ON fcl.oid = co.confrelid \
         CROSS JOIN LATERAL unnest(co.conkey, co.confkey) AS k(col, fcol) \
         JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.col \
         JOIN pg_attribute fa ON fa.attrelid = co.confrelid AND fa.attnum = k.fcol \
         WHERE co.contype = 'f' AND {SYSTEM_SCHEMA_FILTER} \
         ORDER BY n.nspname, cl.relname, co.conname"
    ))
    .fetch_all(&mut *conn)
    .await?;

    let mut tables: Vec<TableInfo> = Vec::new();
    let mut index_of: HashMap<(String, String), usize> = HashMap::new();
    for (schema, table, relkind, column, data_type, notnull, pk) in columns {
        let key = (schema.clone(), table.clone());
        let position = *index_of.entry(key).or_insert_with(|| {
            tables.push(TableInfo {
                name: table,
                schema: display_schema(schema),
                kind: if relkind == "v" || relkind == "m" { "view" } else { "table" }.into(),
                columns: Vec::new(),
                foreign_keys: Vec::new(),
            });
            tables.len() - 1
        });
        tables[position].columns.push(ColumnInfo { name: column, data_type, notnull, pk });
    }
    for (schema, table, column, to_table, to_column) in foreign_keys {
        if let Some(&position) = index_of.get(&(schema, table)) {
            tables[position].foreign_keys.push(ForeignKey { column, to_table, to_column });
        }
    }
    Ok(SchemaSnapshot { tables })
}
