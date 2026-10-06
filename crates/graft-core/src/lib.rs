//! Graft engine, shared by the desktop app (`src-tauri`) and the MCP server
//! (`crates/graft-mcp`). No Tauri dependency: callers wrap these functions in
//! their own transport (Tauri commands, MCP tools).

pub mod db;
pub mod files;
pub mod notebook;
pub mod scope;
pub mod snippets;
