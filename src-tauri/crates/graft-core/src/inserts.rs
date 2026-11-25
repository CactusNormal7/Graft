//! INSERT statements from a query result — the `generate_inserts` MCP tool.
//!
//! A Rust port of the app's ORM bridge (`src/canvas/orm.ts` and the shape
//! detection of `src/canvas/resultShape.ts`), kept behaviourally identical:
//! - a table matches when it has at least 60 % of the columns (views
//!   excluded, the narrower table on a tie), and only its columns are written;
//! - when a JOIN result has a parent → children shape and both sides match a
//!   table, each parent is inserted followed by its children, the foreign key
//!   filled with the parent's selected key, or else with the key the database
//!   generated for it (per engine, see `last_inserted_key`);
//! - otherwise, one flat INSERT per row.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::db::schema::{ForeignKey, TableInfo};
use crate::db::{Engine, QueryResult};

/// Minimum share of result columns a table must have to be the target.
const MATCH_THRESHOLD: f64 = 0.6;

pub struct InsertScript {
    pub sql: String,
    pub warnings: Vec<String>,
}

/// Best table for a set of column names (see the module documentation).
pub fn match_table<'a>(columns: &[String], tables: &'a [TableInfo]) -> Option<&'a TableInfo> {
    if columns.is_empty() {
        return None;
    }
    let mut best: Option<(&TableInfo, f64)> = None;
    for table in tables.iter().filter(|t| t.kind == "table") {
        let hits = columns
            .iter()
            .filter(|c| table.columns.iter().any(|tc| tc.name.eq_ignore_ascii_case(c)))
            .count();
        let score = hits as f64 / columns.len() as f64;
        let is_better = match best {
            None => score > 0.0,
            Some((current, best_score)) => {
                score > best_score
                    || (score == best_score && table.columns.len() < current.columns.len())
            }
        };
        if is_better {
            best = Some((table, score));
        }
    }
    best.filter(|(_, score)| *score >= MATCH_THRESHOLD).map(|(table, _)| table)
}

/// Quote an identifier for the engine (backticks for MySQL).
pub fn quote_ident(engine: Engine, name: &str) -> String {
    match engine {
        Engine::Mysql => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

/// A JSON cell as a SQL literal.
pub fn sql_literal(engine: Engine, value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(b) if engine == Engine::Postgres => b.to_string().to_uppercase(),
        Value::Bool(b) => if *b { "1" } else { "0" }.into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

/// Parent / child column split of a JOIN result (see `resultShape.ts`).
#[derive(Debug, PartialEq)]
pub struct NestedShape {
    pub parent: Vec<usize>,
    pub child: Vec<usize>,
}

fn cell_key(value: &Value) -> String {
    // serde_json keeps 1 and "1" apart, as the app's typed keys do.
    value.to_string()
}

/// Left to right, a column stays "parent" while it is constant inside every
/// group of the parent columns already chosen; the first column that varies
/// starts the child columns. None when nothing would collapse.
pub fn detect_nested_shape(result: &QueryResult) -> Option<NestedShape> {
    let columns = result.columns.len();
    if columns < 2 || result.rows.len() < 2 {
        return None;
    }
    let cell = |row: &Vec<Value>, i: usize| row.get(i).cloned().unwrap_or(Value::Null);
    let mut keys: Vec<String> = result.rows.iter().map(|row| cell_key(&cell(row, 0))).collect();
    let mut parent = vec![0];
    for column in 1..columns {
        let mut seen: HashMap<&str, Value> = HashMap::new();
        let is_constant = result.rows.iter().zip(&keys).all(|(row, key)| {
            let value = cell(row, column);
            seen.entry(key.as_str()).or_insert_with(|| value.clone()) == &value
        });
        if !is_constant {
            break;
        }
        parent.push(column);
        for (key, row) in keys.iter_mut().zip(&result.rows) {
            key.push('\u{1f}');
            key.push_str(&cell_key(&cell(row, column)));
        }
    }
    let child: Vec<usize> = (0..columns).filter(|c| !parent.contains(c)).collect();
    let unique: HashSet<&String> = keys.iter().collect();
    (!child.is_empty() && unique.len() < keys.len()).then_some(NestedShape { parent, child })
}

/// Rows grouped by parent tuple, in order: (a representative row, its
/// distinct children). LEFT JOIN rows whose child cells are all NULL are not
/// children.
fn nested_groups<'a>(result: &'a QueryResult, shape: &NestedShape) -> Vec<(&'a Vec<Value>, Vec<&'a Vec<Value>>)> {
    let mut groups: Vec<(&Vec<Value>, Vec<&Vec<Value>>)> = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();
    let mut seen_children: Vec<HashSet<String>> = Vec::new();
    let key_of = |row: &Vec<Value>, indexes: &[usize]| {
        indexes.iter().map(|&i| cell_key(row.get(i).unwrap_or(&Value::Null))).collect::<Vec<_>>().join("\u{1f}")
    };
    for row in &result.rows {
        let key = key_of(row, &shape.parent);
        let position = *index_of.entry(key).or_insert_with(|| {
            groups.push((row, Vec::new()));
            seen_children.push(HashSet::new());
            groups.len() - 1
        });
        if shape.child.iter().all(|&i| row.get(i).is_none_or(Value::is_null)) {
            continue;
        }
        if seen_children[position].insert(key_of(row, &shape.child)) {
            groups[position].1.push(row);
        }
    }
    groups
}

fn find_foreign_key<'a>(child: &'a TableInfo, parent: &TableInfo) -> Option<&'a ForeignKey> {
    child.foreign_keys.iter().find(|fk| fk.to_table.eq_ignore_ascii_case(&parent.name))
}

fn has_column(table: &TableInfo, name: &str) -> bool {
    table.columns.iter().any(|c| c.name.eq_ignore_ascii_case(name))
}

fn qualified(engine: Engine, table: &TableInfo) -> String {
    match &table.schema {
        Some(schema) => format!("{}.{}", quote_ident(engine, schema), quote_ident(engine, &table.name)),
        None => quote_ident(engine, &table.name),
    }
}

/// MySQL session variable holding the key generated for `table`'s last row.
fn key_variable(table: &str) -> String {
    let safe: String = table.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    format!("@graft_key_{safe}")
}

/// Key generated for the row last inserted into `table` (see `orm.ts`
/// `lastInsertedKey`: "last insert id" functions would point at the first
/// child as soon as it is inserted).
fn last_inserted_key(engine: Engine, table: &TableInfo, column: Option<&str>) -> String {
    match engine {
        Engine::Postgres => format!(
            "currval(pg_get_serial_sequence({}, {}))",
            sql_literal(engine, &Value::String(qualified(engine, table))),
            sql_literal(engine, &Value::String(column.unwrap_or("id").to_string()))
        ),
        Engine::Mysql => key_variable(&table.name),
        Engine::Sqlite => format!(
            "(SELECT {} FROM {} ORDER BY rowid DESC LIMIT 1)",
            column.map_or_else(|| "rowid".to_string(), |c| quote_ident(engine, c)),
            qualified(engine, table)
        ),
    }
}

fn insert_statement(engine: Engine, table: &TableInfo, columns: &[String], values: &[String]) -> String {
    let target = qualified(engine, table);
    if columns.is_empty() {
        return match engine {
            Engine::Mysql => format!("INSERT INTO {target} () VALUES ();"),
            _ => format!("INSERT INTO {target} DEFAULT VALUES;"),
        };
    }
    let columns = columns.iter().map(|c| quote_ident(engine, c)).collect::<Vec<_>>().join(", ");
    format!("INSERT INTO {target} ({columns}) VALUES ({});", values.join(", "))
}

/// Parent → children INSERTs, or None when the result has no such shape or
/// a side matches no table.
fn relational_inserts(
    result: &QueryResult,
    tables: &[TableInfo],
    engine: Engine,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let shape = detect_nested_shape(result)?;
    let names = |indexes: &[usize]| indexes.iter().map(|&i| result.columns[i].clone()).collect::<Vec<_>>();
    let parent_table = match_table(&names(&shape.parent), tables)?;
    let child_table = match_table(&names(&shape.child), tables)?;
    let fk = find_foreign_key(child_table, parent_table);
    if fk.is_none() {
        warnings.push(format!(
            "no foreign key from {} to {}: children are inserted without linking",
            child_table.name, parent_table.name
        ));
    }
    warnings.push(format!("parent rows -> {}, children -> {}", parent_table.name, child_table.name));
    let parent_kept: Vec<usize> = shape.parent.iter().copied().filter(|&i| has_column(parent_table, &result.columns[i])).collect();
    let child_kept: Vec<usize> = shape.child.iter().copied().filter(|&i| has_column(child_table, &result.columns[i])).collect();
    let key_column = fk.and_then(|fk| {
        let explicit = (!fk.to_column.is_empty()).then(|| fk.to_column.clone());
        explicit.or_else(|| parent_table.columns.iter().find(|c| c.pk).map(|c| c.name.clone()))
    });
    let selected_key = key_column
        .as_deref()
        .and_then(|key| parent_kept.iter().copied().find(|&i| result.columns[i].eq_ignore_ascii_case(key)));

    let mut out = Vec::new();
    for (parent_row, children) in nested_groups(result, &shape) {
        let cell = |row: &Vec<Value>, i: usize| sql_literal(engine, row.get(i).unwrap_or(&Value::Null));
        let parent_columns: Vec<String> = parent_kept.iter().map(|&i| result.columns[i].clone()).collect();
        let parent_values: Vec<String> = parent_kept.iter().map(|&i| cell(parent_row, i)).collect();
        out.push(insert_statement(engine, parent_table, &parent_columns, &parent_values));
        let link = fk.map(|_| match selected_key {
            Some(i) => cell(parent_row, i),
            None => {
                if engine == Engine::Mysql {
                    out.push(format!("SET {} = LAST_INSERT_ID();", key_variable(&parent_table.name)));
                }
                last_inserted_key(engine, parent_table, key_column.as_deref())
            }
        });
        for child in children {
            let mut columns: Vec<String> = child_kept.iter().map(|&i| result.columns[i].clone()).collect();
            let mut values: Vec<String> = child_kept.iter().map(|&i| cell(child, i)).collect();
            if let (Some(fk), Some(link)) = (fk, &link) {
                if !columns.iter().any(|c| c.eq_ignore_ascii_case(&fk.column)) {
                    columns.push(fk.column.clone());
                    values.push(link.clone());
                }
            }
            out.push(insert_statement(engine, child_table, &columns, &values));
        }
    }
    Some(out.join("\n"))
}

/// INSERTs reproducing `result`: parent → children when the JOIN shape maps
/// to two tables, else one INSERT per row into the best-matching table.
pub fn generate_inserts(result: &QueryResult, tables: &[TableInfo], engine: Engine) -> InsertScript {
    let mut warnings = Vec::new();
    if result.truncated {
        warnings.push(format!(
            "only the first {} of {} rows were fetched",
            result.rows.len(),
            result.total_rows
        ));
    }
    if let Some(sql) = relational_inserts(result, tables, engine, &mut warnings) {
        return InsertScript { sql, warnings };
    }
    let Some(table) = match_table(&result.columns, tables) else {
        warnings.push(format!(
            "no table has at least {:.0}% of the result's columns",
            MATCH_THRESHOLD * 100.0
        ));
        return InsertScript { sql: String::new(), warnings };
    };
    let kept: Vec<usize> = (0..result.columns.len())
        .filter(|&i| table.columns.iter().any(|c| c.name.eq_ignore_ascii_case(&result.columns[i])))
        .collect();
    let skipped: Vec<&str> = (0..result.columns.len())
        .filter(|i| !kept.contains(i))
        .map(|i| result.columns[i].as_str())
        .collect();
    if !skipped.is_empty() {
        warnings.push(format!("columns not in {}: {}", table.name, skipped.join(", ")));
    }

    let columns: Vec<String> = kept.iter().map(|&i| result.columns[i].clone()).collect();
    let sql = result
        .rows
        .iter()
        .map(|row| {
            let values: Vec<String> = kept
                .iter()
                .map(|&i| sql_literal(engine, row.get(i).unwrap_or(&Value::Null)))
                .collect();
            insert_statement(engine, table, &columns, &values)
        })
        .collect::<Vec<_>>()
        .join("\n");
    InsertScript { sql, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::ColumnInfo;
    use serde_json::json;

    fn users_reviews() -> Vec<TableInfo> {
        let mut users = table("users", "table", &["id", "name"]);
        users.columns[0].pk = true;
        let mut reviews = table("reviews", "table", &["id", "body", "user_id"]);
        reviews.columns[0].pk = true;
        reviews.foreign_keys.push(ForeignKey { column: "user_id".into(), to_table: "users".into(), to_column: "id".into() });
        vec![users, reviews]
    }

    fn joined() -> QueryResult {
        result(
            &["name", "body"],
            vec![
                vec![json!("ann"), json!("r1")],
                vec![json!("ann"), json!("r2")],
                vec![json!("bob"), Value::Null],
            ],
        )
    }

    #[test]
    fn detects_parent_and_child_columns_like_the_app() {
        assert_eq!(detect_nested_shape(&joined()), Some(NestedShape { parent: vec![0], child: vec![1] }));
        let unique = result(&["a", "b"], vec![vec![json!(1), json!(2)], vec![json!(3), json!(4)]]);
        assert_eq!(detect_nested_shape(&unique), None, "nothing to collapse");
    }

    #[test]
    fn links_children_to_the_generated_parent_key_per_engine() {
        let tables = users_reviews();
        let sqlite = generate_inserts(&joined(), &tables, Engine::Sqlite).sql;
        assert_eq!(
            sqlite.lines().collect::<Vec<_>>(),
            vec![
                "INSERT INTO \"users\" (\"name\") VALUES ('ann');",
                "INSERT INTO \"reviews\" (\"body\", \"user_id\") VALUES ('r1', (SELECT \"id\" FROM \"users\" ORDER BY rowid DESC LIMIT 1));",
                "INSERT INTO \"reviews\" (\"body\", \"user_id\") VALUES ('r2', (SELECT \"id\" FROM \"users\" ORDER BY rowid DESC LIMIT 1));",
                "INSERT INTO \"users\" (\"name\") VALUES ('bob');",
            ],
            "the all-NULL LEFT JOIN row adds no child"
        );
        let pg = generate_inserts(&joined(), &tables, Engine::Postgres).sql;
        assert!(pg.contains("VALUES ('r1', currval(pg_get_serial_sequence('\"users\"', 'id')));"), "{pg}");
        let mysql = generate_inserts(&joined(), &tables, Engine::Mysql).sql;
        assert_eq!(
            mysql.lines().take(3).collect::<Vec<_>>(),
            vec![
                "INSERT INTO `users` (`name`) VALUES ('ann');",
                "SET @graft_key_users = LAST_INSERT_ID();",
                "INSERT INTO `reviews` (`body`, `user_id`) VALUES ('r1', @graft_key_users);",
            ]
        );
    }

    #[test]
    fn uses_the_selected_parent_key() {
        let data = result(
            &["id", "name", "body"],
            vec![vec![json!(7), json!("ann"), json!("r1")], vec![json!(7), json!("ann"), json!("r2")]],
        );
        let sql = generate_inserts(&data, &users_reviews(), Engine::Postgres).sql;
        assert!(sql.contains("VALUES ('r2', 7);"), "{sql}");
    }

    fn table(name: &str, kind: &str, columns: &[&str]) -> TableInfo {
        TableInfo {
            name: name.into(),
            schema: None,
            kind: kind.into(),
            columns: columns
                .iter()
                .map(|c| ColumnInfo { name: (*c).into(), data_type: String::new(), notnull: false, pk: false })
                .collect(),
            foreign_keys: vec![],
            indexes: vec![],
            definition: None,
        }
    }

    fn result(columns: &[&str], rows: Vec<Vec<Value>>) -> QueryResult {
        QueryResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            total_rows: rows.len(),
            rows,
            rows_affected: 0,
            elapsed_ms: 0,
            truncated: false,
        }
    }

    #[test]
    fn matches_the_best_table_excluding_views() {
        let tables = [
            table("users_view", "view", &["id", "name"]),
            table("users", "table", &["id", "name", "email", "created_at"]),
            table("people", "table", &["id", "name", "email"]),
        ];
        let columns = vec!["id".to_string(), "NAME".to_string(), "email".to_string()];
        assert_eq!(match_table(&columns, &tables).unwrap().name, "people", "narrower wins a tie");
        assert!(match_table(&["x".to_string(), "y".to_string()], &tables).is_none());
    }

    #[test]
    fn writes_one_insert_per_row_with_engine_quoting() {
        let tables = [table("users", "table", &["id", "name", "active"])];
        let rows = vec![vec![json!(1), json!("O'Hara"), json!(true), json!(9)], vec![json!(2), Value::Null, json!(false), json!(9)]];
        let data = result(&["id", "name", "active", "total"], rows);

        let pg = generate_inserts(&data, &tables, Engine::Postgres);
        assert_eq!(
            pg.sql,
            "INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (1, 'O''Hara', TRUE);\n\
             INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (2, NULL, FALSE);"
        );
        assert_eq!(pg.warnings, vec!["columns not in users: total"]);

        let mysql = generate_inserts(&data, &tables, Engine::Mysql);
        assert!(mysql.sql.starts_with("INSERT INTO `users` (`id`, `name`, `active`) VALUES (1, 'O''Hara', 1);"));
    }
}
