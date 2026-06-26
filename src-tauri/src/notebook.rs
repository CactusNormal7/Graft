//! Local notebook persistence for Graft v0.1.
//!
//! Notebooks are saved as plain JSON `.graft` files — Git-diff-friendly, per the
//! persistence direction in the project's open questions. The frontend owns the
//! schema; these commands just read and write the serialized string at a path
//! the user picks via the dialog plugin.

use std::fs;

/// Write notebook JSON to `path`, overwriting any existing file.
#[tauri::command]
pub fn save_notebook(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read notebook JSON from `path`.
#[tauri::command]
pub fn load_notebook(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
