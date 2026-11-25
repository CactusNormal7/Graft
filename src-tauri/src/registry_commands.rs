//! Commands over `graft_core::registry`: the projects the MCP server may
//! reach, and the per-project switch that lets it modify the database.

use std::path::PathBuf;

use graft_core::registry::{default_path, Registry};

fn registry_file() -> Result<PathBuf, String> {
    default_path().ok_or_else(|| "could not resolve the user data directory".into())
}

/// Record a project the user created, opened or saved.
#[tauri::command]
pub fn register_project(path: String, name: String) -> Result<(), String> {
    let file = registry_file()?;
    let mut registry = Registry::load(&file)?;
    registry.register(&path, &name);
    registry.save(&file)
}

/// Whether Claude (MCP) may run DML/DDL on this project's database.
#[tauri::command]
pub fn get_mcp_writes(path: String) -> Result<bool, String> {
    let registry = Registry::load(&registry_file()?)?;
    Ok(registry.find(&path).map(|p| p.allow_mcp_writes).unwrap_or(false))
}

#[tauri::command]
pub fn set_mcp_writes(path: String, allow: bool) -> Result<(), String> {
    let file = registry_file()?;
    let mut registry = Registry::load(&file)?;
    registry.set_mcp_writes(&path, allow)?;
    registry.save(&file)
}
