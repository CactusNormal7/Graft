//! Commands over `graft_core::connections`: the named-connection library.

use std::path::PathBuf;

use graft_core::connections::{default_path, ConnectionLibrary, SavedConnection};
use graft_core::db::ConnectionConfig;

fn library_file() -> Result<PathBuf, String> {
    default_path().ok_or_else(|| "could not resolve the user data directory".into())
}

#[tauri::command]
pub fn list_saved_connections() -> Result<Vec<SavedConnection>, String> {
    Ok(ConnectionLibrary::load(&library_file()?)?.connections)
}

/// Add or update (same id) a named connection; returns the new list.
#[tauri::command]
pub fn save_connection(name: String, connection: ConnectionConfig) -> Result<Vec<SavedConnection>, String> {
    connection.validate()?;
    let file = library_file()?;
    let mut library = ConnectionLibrary::load(&file)?;
    library.upsert(&name, connection)?;
    library.save(&file)?;
    Ok(library.connections)
}

/// Remove a named connection; returns the new list. Its keychain password
/// is kept: projects may still use the connection.
#[tauri::command]
pub fn delete_saved_connection(id: String) -> Result<Vec<SavedConnection>, String> {
    let file = library_file()?;
    let mut library = ConnectionLibrary::load(&file)?;
    library.remove(&id);
    library.save(&file)?;
    Ok(library.connections)
}
