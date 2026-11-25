//! MySQL / MariaDB specifics: connection options and introspection. MySQL
//! reports no error position (only `near '…' at line N`, located by the
//! frontend).

use std::collections::HashMap;

use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::MySqlConnection;

use super::config::{ConnectionConfig, SslMode};
use super::schema::{
    ColumnInfo, ForeignKey, IndexInfo, RoutineInfo, SchemaSnapshot, TableInfo, TriggerInfo,
};

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
    let mut tables = introspect_tables(conn).await?;
    attach_indexes(conn, &mut tables).await?;
    let triggers = introspect_triggers(conn).await?;
    let routines = introspect_routines(conn).await?;
    Ok(SchemaSnapshot { tables, triggers, routines })
}

async fn attach_indexes(conn: &mut MySqlConnection, tables: &mut [TableInfo]) -> Result<(), sqlx::Error> {
    // One row per indexed column, in index order.
    let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(INDEX_NAME AS CHAR), NON_UNIQUE = 0, \
                CAST(COALESCE(COLUMN_NAME, '<expression>') AS CHAR) \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = DATABASE() \
         ORDER BY TABLE_NAME, INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX",
    )
    .fetch_all(&mut *conn)
    .await?;
    for (table, name, unique, column) in rows {
        let Some(info) = tables.iter_mut().find(|t| t.name == table) else {
            continue;
        };
        match info.indexes.iter_mut().find(|index| index.name == name) {
            Some(index) => index.columns.push(column),
            None => info.indexes.push(IndexInfo {
                primary: name == "PRIMARY",
                name,
                columns: vec![column],
                unique: unique != 0,
            }),
        }
    }
    Ok(())
}

async fn introspect_triggers(conn: &mut MySqlConnection) -> Result<Vec<TriggerInfo>, sqlx::Error> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT CAST(TRIGGER_NAME AS CHAR), CAST(EVENT_OBJECT_TABLE AS CHAR), \
                CAST(ACTION_TIMING AS CHAR), CAST(EVENT_MANIPULATION AS CHAR), \
                CAST(ACTION_STATEMENT AS CHAR) \
         FROM information_schema.TRIGGERS \
         WHERE TRIGGER_SCHEMA = DATABASE() \
         ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME",
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(name, table, timing, events, body)| TriggerInfo {
            definition: format!("CREATE TRIGGER {name} {timing} {events} ON {table} FOR EACH ROW {body}"),
            name,
            table,
            schema: None,
            timing,
            events,
        })
        .collect())
}

async fn introspect_routines(conn: &mut MySqlConnection) -> Result<Vec<RoutineInfo>, sqlx::Error> {
    let rows: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT CAST(r.ROUTINE_NAME AS CHAR), CAST(r.ROUTINE_TYPE AS CHAR), \
                CAST(COALESCE(( \
                    SELECT GROUP_CONCAT(CONCAT_WS(' ', p.PARAMETER_MODE, p.PARAMETER_NAME, p.DTD_IDENTIFIER) \
                                        ORDER BY p.ORDINAL_POSITION SEPARATOR ', ') \
                    FROM information_schema.PARAMETERS p \
                    WHERE p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME \
                      AND p.ORDINAL_POSITION > 0), '') AS CHAR), \
                CAST(CASE WHEN r.ROUTINE_TYPE = 'FUNCTION' THEN r.DTD_IDENTIFIER END AS CHAR), \
                CAST(COALESCE(r.ROUTINE_DEFINITION, '') AS CHAR) \
         FROM information_schema.ROUTINES r \
         WHERE r.ROUTINE_SCHEMA = DATABASE() \
         ORDER BY r.ROUTINE_NAME",
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(name, kind, arguments, returns, definition)| RoutineInfo {
            name,
            schema: None,
            kind: kind.to_ascii_lowercase(),
            arguments,
            returns,
            definition,
        })
        .collect())
}

async fn introspect_tables(conn: &mut MySqlConnection) -> Result<Vec<TableInfo>, sqlx::Error> {
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

    let definitions: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(VIEW_DEFINITION AS CHAR) \
         FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()",
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();

    let mut tables: Vec<TableInfo> = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();
    for (table, table_type, column, data_type, notnull, pk) in columns {
        let position = *index_of.entry(table.clone()).or_insert_with(|| {
            tables.push(TableInfo {
                definition: definitions.get(&table).cloned(),
                name: table,
                schema: None,
                kind: if table_type == "VIEW" { "view" } else { "table" }.into(),
                columns: Vec::new(),
                foreign_keys: Vec::new(),
                indexes: Vec::new(),
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
    Ok(tables)
}
