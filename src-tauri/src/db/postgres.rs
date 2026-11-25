//! Postgres specifics: connection options, error positions, introspection.

use std::collections::HashMap;

use sqlx::postgres::{PgConnectOptions, PgDatabaseError, PgErrorPosition, PgSslMode};
use sqlx::PgConnection;

use super::config::{ConnectionConfig, SslMode};
use super::schema::{
    ColumnInfo, ForeignKey, IndexInfo, RoutineInfo, SchemaSnapshot, TableInfo, TriggerInfo,
};
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

// `pg_trigger.tgtype` bits (see src/include/catalog/pg_trigger.h).
const TRIGGER_TYPE_BEFORE: i16 = 1 << 1;
const TRIGGER_TYPE_INSERT: i16 = 1 << 2;
const TRIGGER_TYPE_DELETE: i16 = 1 << 3;
const TRIGGER_TYPE_UPDATE: i16 = 1 << 4;
const TRIGGER_TYPE_TRUNCATE: i16 = 1 << 5;
const TRIGGER_TYPE_INSTEAD: i16 = 1 << 6;

/// Timing and events encoded in `pg_trigger.tgtype`.
pub fn trigger_type(tgtype: i16) -> (String, String) {
    let timing = if tgtype & TRIGGER_TYPE_INSTEAD != 0 {
        "INSTEAD OF"
    } else if tgtype & TRIGGER_TYPE_BEFORE != 0 {
        "BEFORE"
    } else {
        "AFTER"
    };
    let events: Vec<&str> = [
        (TRIGGER_TYPE_INSERT, "INSERT"),
        (TRIGGER_TYPE_UPDATE, "UPDATE"),
        (TRIGGER_TYPE_DELETE, "DELETE"),
        (TRIGGER_TYPE_TRUNCATE, "TRUNCATE"),
    ]
    .into_iter()
    .filter(|(bit, _)| tgtype & bit != 0)
    .map(|(_, event)| event)
    .collect();
    (timing.to_string(), events.join(", "))
}

pub async fn introspect(conn: &mut PgConnection) -> Result<SchemaSnapshot, sqlx::Error> {
    let mut tables = introspect_tables(conn).await?;
    attach_indexes(conn, &mut tables).await?;
    let triggers = introspect_triggers(conn).await?;
    let routines = introspect_routines(conn).await?;
    Ok(SchemaSnapshot { tables, triggers, routines })
}

/// Position of each table in `tables`, by (schema as stored, name).
fn table_positions(tables: &[TableInfo]) -> HashMap<(Option<String>, String), usize> {
    tables
        .iter()
        .enumerate()
        .map(|(position, t)| ((t.schema.clone(), t.name.clone()), position))
        .collect()
}

async fn attach_indexes(conn: &mut PgConnection, tables: &mut [TableInfo]) -> Result<(), sqlx::Error> {
    let rows: Vec<(String, String, String, bool, bool, Vec<String>)> = sqlx::query_as(&format!(
        "SELECT n.nspname::text, t.relname::text, i.relname::text, ix.indisunique, ix.indisprimary, \
                ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true) \
                      FROM generate_subscripts(ix.indkey, 1) AS k ORDER BY k) \
         FROM pg_index ix \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_class t ON t.oid = ix.indrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         WHERE {SYSTEM_SCHEMA_FILTER} \
         ORDER BY n.nspname, t.relname, ix.indisprimary DESC, i.relname"
    ))
    .fetch_all(&mut *conn)
    .await?;
    let positions = table_positions(tables);
    for (schema, table, name, unique, primary, columns) in rows {
        if let Some(&position) = positions.get(&(display_schema(schema), table)) {
            tables[position].indexes.push(IndexInfo { name, columns, unique, primary });
        }
    }
    Ok(())
}

async fn introspect_triggers(conn: &mut PgConnection) -> Result<Vec<TriggerInfo>, sqlx::Error> {
    let rows: Vec<(String, String, String, i16, String)> = sqlx::query_as(&format!(
        "SELECT n.nspname::text, c.relname::text, t.tgname::text, t.tgtype, \
                pg_get_triggerdef(t.oid, true) \
         FROM pg_trigger t \
         JOIN pg_class c ON c.oid = t.tgrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE NOT t.tgisinternal AND {SYSTEM_SCHEMA_FILTER} \
         ORDER BY n.nspname, c.relname, t.tgname"
    ))
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(schema, table, name, tgtype, definition)| {
            let (timing, events) = trigger_type(tgtype);
            TriggerInfo { name, table, schema: display_schema(schema), timing, events, definition }
        })
        .collect())
}

/// User functions and procedures; objects owned by extensions are skipped
/// (they would drown the user's own code).
async fn introspect_routines(conn: &mut PgConnection) -> Result<Vec<RoutineInfo>, sqlx::Error> {
    let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(&format!(
        "SELECT n.nspname::text, p.proname::text, p.prokind::text, \
                pg_get_function_identity_arguments(p.oid), \
                CASE WHEN p.prokind = 'f' THEN pg_get_function_result(p.oid) END, \
                pg_get_functiondef(p.oid) \
         FROM pg_proc p \
         JOIN pg_namespace n ON n.oid = p.pronamespace \
         WHERE p.prokind IN ('f', 'p') AND {SYSTEM_SCHEMA_FILTER} \
           AND NOT EXISTS (SELECT 1 FROM pg_depend d \
                           WHERE d.objid = p.oid AND d.deptype = 'e') \
         ORDER BY n.nspname, p.proname"
    ))
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(schema, name, prokind, arguments, returns, definition)| RoutineInfo {
            name,
            schema: display_schema(schema),
            kind: if prokind == "p" { "procedure" } else { "function" }.into(),
            arguments,
            returns,
            definition,
        })
        .collect())
}

async fn introspect_tables(conn: &mut PgConnection) -> Result<Vec<TableInfo>, sqlx::Error> {
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

    let definitions: HashMap<(String, String), String> = sqlx::query_as::<_, (String, String, String)>(&format!(
        "SELECT n.nspname::text, c.relname::text, pg_get_viewdef(c.oid, true) \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relkind IN ('v', 'm') AND {SYSTEM_SCHEMA_FILTER}"
    ))
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|(schema, name, definition)| ((schema, name), definition))
    .collect();

    let mut tables: Vec<TableInfo> = Vec::new();
    let mut index_of: HashMap<(String, String), usize> = HashMap::new();
    for (schema, table, relkind, column, data_type, notnull, pk) in columns {
        let key = (schema.clone(), table.clone());
        let definition = definitions.get(&key).cloned();
        let position = *index_of.entry(key).or_insert_with(|| {
            tables.push(TableInfo {
                name: table,
                schema: display_schema(schema),
                kind: if relkind == "v" || relkind == "m" { "view" } else { "table" }.into(),
                columns: Vec::new(),
                foreign_keys: Vec::new(),
                indexes: Vec::new(),
                definition,
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
    Ok(tables)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_trigger_types() {
        // BEFORE INSERT OR UPDATE (row-level bit 1 set).
        assert_eq!(trigger_type(1 | 2 | 4 | 16), ("BEFORE".into(), "INSERT, UPDATE".into()));
        assert_eq!(trigger_type(8), ("AFTER".into(), "DELETE".into()));
        assert_eq!(trigger_type(64 | 4), ("INSTEAD OF".into(), "INSERT".into()));
    }
}
