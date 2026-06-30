//! Local notebook persistence for Graft v0.1.
//!
//! Notebooks are saved as plain JSON `.graft` files — Git-diff-friendly, per the
//! persistence direction in the project's open questions. The frontend owns the
//! schema; these commands just read and write the serialized string at a path,
//! plus a couple of helpers to resolve a default project directory and to derive
//! the `.graft` / `.db` paths for a new project (cross-platform path joining).

use std::fs;
use std::path::Path;

use serde::Serialize;

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

/// True if a file exists at `path` (used to prune stale recent-project entries).
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Default directory for new projects: `<Documents|Home>/Graft`, created if missing.
#[tauri::command]
pub fn default_project_dir() -> Result<String, String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or("could not resolve a home directory")?;
    let dir = base.join("Graft");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPaths {
    pub project_path: String,
    pub db_path: String,
}

/// Derive the `.graft` and `.db` paths for a project named `name` in `dir`
/// (creating `dir`). Path joining is done natively so it works on macOS/Windows.
#[tauri::command]
pub fn create_project_paths(dir: String, name: String) -> Result<ProjectPaths, String> {
    let d = Path::new(&dir);
    fs::create_dir_all(d).map_err(|e| e.to_string())?;
    Ok(ProjectPaths {
        project_path: d.join(format!("{name}.graft")).to_string_lossy().into_owned(),
        db_path: d.join(format!("{name}.db")).to_string_lossy().into_owned(),
    })
}
