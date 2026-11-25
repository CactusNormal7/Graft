//! Graft's engine, shared by the Tauri app and the `graft-mcp` server:
//! database engines (`db`), `.graft` project files (`files`, `notebook`),
//! known projects (`registry`) and connection passwords (`secrets`).
//! Nothing here depends on Tauri.

pub mod db;
pub mod files;
pub mod inserts;
pub mod notebook;
pub mod registry;
pub mod secrets;
