//! MySQL / MariaDB specifics: connection options and introspection. MySQL
//! reports no error position (only `near '…' at line N`, located by the
//! frontend).

use std::collections::HashMap;

use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::MySqlConnection;

use super::config::{ConnectionConfig, SslMode};
use super::schema::{ColumnInfo, ForeignKey, SchemaSnapshot, TableInfo};

pub fn connect_options(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<MySqlConnectOptions, String> {
    let database = config
        .database()
        .ok_or("MySQL connections need a database")?;
    let mut options = MySqlConnectOptions::new()
        .host(config.host()?)
        .port(config.port())
        .username(config.user()?)
        .database(database)
        .ssl_mode(match config.ssl_mode {
            SslMode::Disable => MySqlSslMode::Disabled,
            SslMode::Prefer => MySqlSslMode::Preferred,
            SslMode::Require => MySqlSslMode::Required,
            SslMode::VerifyFull => MySqlSslMode::VerifyIdentity,
        });
    if let Some(password) = password {
        options = options.password(password);
    }
    Ok(options)
}

// information_schema columns are utf8/binary depending on the server version:
// everything is CAST to CHAR so it always decodes as a string.
pub async fn introspect(conn: &mut MySqlConnection) -> Result<SchemaSnapshot, sqlx::Error> {
    let columns: Vec<(String, String, String, String, i64, i64)> = sqlx::query_as(
        "SELECT CAST(c.TABLE_NAME AS CHAR), CAST(t.TABLE_TYPE AS CHAR), \
                CAST(c.COLUMN_NAME AS CHAR), CAST(c.COLUMN_TYPE AS CHAR), \
                c.IS_NULLABLE = 'NO', c.COLUMN_KEY = 'PRI' \
         FROM information_schema.COLUMNS c \
         JOIN information_schema.TABLES t \
           ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME \
         WHERE c.TABLE_SCHEMA = DATABASE() \
         ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
    )
    .fetch_all(&mut *conn)
    .await?;

    let foreign_keys: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), \
                CAST(REFERENCED_TABLE_NAME AS CHAR), CAST(REFERENCED_COLUMN_NAME AS CHAR) \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut tables: Vec<TableInfo> = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();
    for (table, table_type, column, data_type, notnull, pk) in columns {
        let position = *index_of.entry(table.clone()).or_insert_with(|| {
            tables.push(TableInfo {
                name: table,
                schema: None,
                kind: if table_type == "VIEW" { "view" } else { "table" }.into(),
                columns: Vec::new(),
                foreign_keys: Vec::new(),
            });
            tables.len() - 1
        });
        tables[position].columns.push(ColumnInfo {
            name: column,
            data_type,
            notnull: notnull != 0,
            pk: pk != 0,
        });
    }
    for (table, column, to_table, to_column) in foreign_keys {
        if let Some(&position) = index_of.get(&table) {
            tables[position].foreign_keys.push(ForeignKey { column, to_table, to_column });
        }
    }
    Ok(SchemaSnapshot { tables })
}
