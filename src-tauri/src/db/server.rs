//! Execution shared by the server engines (Postgres, MySQL).
//!
//! SQL runs through `sqlx::raw_sql` — the simple/text query protocol — because
//! it is the only path that accepts **multi-statement scripts** (migrations,
//! procedure bodies…) on both engines. Every value then arrives as text, and
//! is turned back into a JSON number/boolean from its column type
//! (`typed_text_value`) so charts and sorting keep working.

use std::time::Instant;

use futures_util::TryStreamExt;
use sqlx::{Column, Database, Decode, Either, Executor, Row, Type, TypeInfo};

use super::{elapsed_ms, QueryResult};

/// Above this many significant digits a decimal no longer survives a round
/// trip through an f64: it is kept as a string so no digit is silently lost.
const MAX_EXACT_DECIMAL_DIGITS: usize = 15;

const INTEGER_TYPES: &[&str] = &[
    "INT2", "INT4", "INT8", "SMALLINT", "INT", "INTEGER", "BIGINT", "TINYINT", "MEDIUMINT", "YEAR",
];
const FLOAT_TYPES: &[&str] = &["FLOAT4", "FLOAT8", "REAL", "FLOAT", "DOUBLE"];
const DECIMAL_TYPES: &[&str] = &["NUMERIC", "DECIMAL"];
const BOOLEAN_TYPES: &[&str] = &["BOOL", "BOOLEAN"];

/// `rows_affected` of a driver's query result (an inherent method per driver,
/// not part of a sqlx trait).
pub trait RowsAffected {
    fn rows_affected(&self) -> u64;
}

impl RowsAffected for sqlx::postgres::PgQueryResult {
    fn rows_affected(&self) -> u64 {
        sqlx::postgres::PgQueryResult::rows_affected(self)
    }
}

impl RowsAffected for sqlx::mysql::MySqlQueryResult {
    fn rows_affected(&self) -> u64 {
        sqlx::mysql::MySqlQueryResult::rows_affected(self)
    }
}

/// Base type name: `INT UNSIGNED` → `INT`, `_INT4` arrays are left alone.
fn base_type(type_name: &str) -> String {
    type_name
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

fn significant_digits(text: &str) -> usize {
    let digits: String = text
        .trim_start_matches(['-', '+'])
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let trimmed = digits.trim_start_matches('0');
    // Trailing zeros after the decimal point carry no information.
    let trimmed = if text.contains('.') { trimmed.trim_end_matches('0') } else { trimmed };
    trimmed.len()
}

/// A text-protocol cell as JSON, typed from its column type.
pub fn typed_text_value(type_name: &str, text: String) -> serde_json::Value {
    use serde_json::Value;

    let base = base_type(type_name);
    let is = |types: &[&str]| types.contains(&base.as_str());
    if is(INTEGER_TYPES) {
        if let Ok(n) = text.parse::<i64>() {
            return Value::from(n);
        }
        if let Ok(n) = text.parse::<u64>() {
            return Value::from(n);
        }
    } else if is(FLOAT_TYPES) {
        if let Some(n) = text.parse::<f64>().ok().filter(|n| n.is_finite()) {
            return Value::from(n);
        }
    } else if is(DECIMAL_TYPES) {
        let exact = significant_digits(&text) <= MAX_EXACT_DECIMAL_DIGITS;
        if let Some(n) = text.parse::<f64>().ok().filter(|n| exact && n.is_finite()) {
            return Value::from(n);
        }
    } else if is(BOOLEAN_TYPES) {
        match text.as_str() {
            "t" | "true" | "1" => return Value::Bool(true),
            "f" | "false" | "0" => return Value::Bool(false),
            _ => {}
        }
    }
    Value::String(text)
}

fn cell_to_json<DB>(row: &DB::Row, index: usize) -> serde_json::Value
where
    DB: Database,
    usize: sqlx::ColumnIndex<DB::Row>,
    for<'r> String: Decode<'r, DB> + Type<DB>,
    for<'r> Vec<u8>: Decode<'r, DB> + Type<DB>,
{
    // Unchecked: every value is text here, whatever the declared column type.
    match row.try_get_unchecked::<Option<String>, _>(index) {
        Ok(Some(text)) => typed_text_value(row.column(index).type_info().name(), text),
        Ok(None) => serde_json::Value::Null,
        Err(_) => match row.try_get_unchecked::<Option<Vec<u8>>, _>(index) {
            Ok(Some(bytes)) => serde_json::Value::from(format!("<{} bytes>", bytes.len())),
            _ => serde_json::Value::Null,
        },
    }
}

/// Rows of the statement being read; becomes the displayed result set when
/// it produced rows (the last such statement of a script wins).
#[derive(Default)]
struct ResultSet {
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    total_rows: usize,
}

/// Run `sql` (one or several statements) and keep the last result set.
pub async fn run_script<'e, DB, E>(
    executor: E,
    sql: &'e str,
    max_rows: usize,
) -> Result<QueryResult, sqlx::Error>
where
    DB: Database,
    DB::QueryResult: RowsAffected,
    E: Executor<'e, Database = DB>,
    usize: sqlx::ColumnIndex<DB::Row>,
    for<'r> String: Decode<'r, DB> + Type<DB>,
    for<'r> Vec<u8>: Decode<'r, DB> + Type<DB>,
{
    let started = Instant::now();
    let mut stream = sqlx::raw_sql(sql).fetch_many(executor);
    let mut current = ResultSet::default();
    let mut shown: Option<ResultSet> = None;
    let mut rows_affected = 0u64;

    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Left(done) => {
                rows_affected += done.rows_affected();
                let finished = std::mem::take(&mut current);
                if finished.total_rows > 0 {
                    shown = Some(finished);
                }
            }
            Either::Right(row) => {
                if current.total_rows == 0 {
                    current.columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if current.total_rows < max_rows {
                    current.rows.push((0..row.len()).map(|i| cell_to_json::<DB>(&row, i)).collect());
                }
                current.total_rows += 1;
            }
        }
    }
    if current.total_rows > 0 {
        shown = Some(current);
    }

    let shown = shown.unwrap_or_default();
    Ok(QueryResult {
        truncated: shown.total_rows > shown.rows.len(),
        columns: shown.columns,
        rows: shown.rows,
        rows_affected,
        elapsed_ms: elapsed_ms(started),
        total_rows: shown.total_rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn types_text_cells_from_their_column_type() {
        assert_eq!(typed_text_value("INT4", "42".into()), json!(42));
        assert_eq!(typed_text_value("BIGINT UNSIGNED", "18446744073709551615".into()), json!(18446744073709551615u64));
        assert_eq!(typed_text_value("FLOAT8", "1.5".into()), json!(1.5));
        assert_eq!(typed_text_value("FLOAT8", "NaN".into()), json!("NaN"));
        assert_eq!(typed_text_value("BOOL", "t".into()), json!(true));
        assert_eq!(typed_text_value("BOOLEAN", "0".into()), json!(false));
        assert_eq!(typed_text_value("TEXT", "42".into()), json!("42"));
        assert_eq!(typed_text_value("JSONB", "{\"a\":1}".into()), json!("{\"a\":1}"));
    }

    #[test]
    fn keeps_decimals_that_an_f64_would_round_as_text() {
        assert_eq!(typed_text_value("NUMERIC", "12.50".into()), json!(12.5));
        assert_eq!(typed_text_value("DECIMAL", "-0.000123".into()), json!(-0.000123));
        let precise = "12345678901234567890.12";
        assert_eq!(typed_text_value("NUMERIC", precise.into()), json!(precise));
    }
}
