//! Introspected database structure, shared by every engine. Serialized as-is
//! to the frontend (and cached in the `.graft` file for the `tables` part).

use serde::{Deserialize, Serialize};

/// One column of a table/view.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ColumnInfo {
    pub name: String,
    /// Declared type (may be empty for SQLite views / untyped columns).
    pub data_type: String,
    pub notnull: bool,
    /// True when the column is part of the primary key.
    pub pk: bool,
}

/// A foreign key: `column` in this table references `to_table(to_column)`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ForeignKey {
    pub column: String,
    pub to_table: String,
    /// Empty when the FK implicitly targets the parent's primary key.
    pub to_column: String,
}

/// A table or view, with everything the ORM/nested features need to rebuild
/// relations without re-deriving them from query results.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TableInfo {
    pub name: String,
    /// Schema (namespace) the table lives in; `None` for SQLite, and for the
    /// default schema of Postgres (`public`) / the connected MySQL database.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// "table" or "view".
    pub kind: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKey>,
    /// Absent from schemas cached by older versions.
    #[serde(default)]
    pub indexes: Vec<IndexInfo>,
    /// `SELECT` behind a view (None for tables).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

/// An index of a table. Primary keys are listed too (`primary: true`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IndexInfo {
    pub name: String,
    /// Indexed columns, or expressions for expression indexes.
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TriggerInfo {
    pub name: String,
    pub table: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// BEFORE, AFTER or INSTEAD OF (empty when unknown).
    pub timing: String,
    /// INSERT / UPDATE / DELETE / TRUNCATE, comma-separated.
    pub events: String,
    pub definition: String,
}

/// A stored procedure or function.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RoutineInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// "function" or "procedure".
    pub kind: String,
    /// Parameter list, e.g. `customer_id integer, OUT total numeric`.
    pub arguments: String,
    /// Return type (functions only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<String>,
    pub definition: String,
}

/// Everything `introspect_schema` returns.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SchemaSnapshot {
    pub tables: Vec<TableInfo>,
    pub triggers: Vec<TriggerInfo>,
    pub routines: Vec<RoutineInfo>,
}
