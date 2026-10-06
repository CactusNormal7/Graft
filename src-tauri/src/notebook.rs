//! Tauri commands for project and text-file I/O. The logic (atomic writes,
//! `.graft`-only access, granted paths, project paths) lives in
//! `graft_core::files`; these only adapt it to the IPC signatures.
//!
//! Access rules (the webview is not trusted with the whole disk):
//! - notebook commands only touch files with the `.graft` extension;
//! - `read_text_file` / `write_text_file` only touch paths the user picked in a
//!   native dialog this session (see `graft_core::scope` and `dialogs.rs`).

use std::path::Path;

use graft_core::files::{self, ProjectPaths};
use graft_core::scope::FileScope;
use tauri::State;

use crate::watch::ProjectWatch;

/// Write UTF-8 text (atomically) to a path chosen in the export dialog.
#[tauri::command]
pub fn write_text_file(
    scope: State<'_, FileScope>,
    path: String,
    contents: String,
) -> Result<(), String> {
    files::write_granted(&scope, Path::new(&path), &contents)
}

/// Read UTF-8 text from a path chosen in the import dialog.
#[tauri::command]
pub fn read_text_file(scope: State<'_, FileScope>, path: String) -> Result<String, String> {
    files::read_granted(&scope, Path::new(&path))
}

/// Write notebook JSON (atomically) to a `.graft` file. The contents are
/// remembered so the project watcher does not mistake this save for an
/// external change.
#[tauri::command]
pub fn save_notebook(
    watch: State<'_, ProjectWatch>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let path = Path::new(&path);
    files::save_project_file(path, &contents)?;
    watch.remember(path, &contents);
    Ok(())
}

/// Read notebook JSON from a `.graft` file (remembered, like a save).
#[tauri::command]
pub fn load_notebook(watch: State<'_, ProjectWatch>, path: String) -> Result<String, String> {
    let path = Path::new(&path);
    let contents = files::load_project_file(path)?;
    watch.remember(path, &contents);
    Ok(contents)
}

/// Default directory for new projects: `<Documents|Home>/Graft`, created if missing.
#[tauri::command]
pub fn default_project_dir() -> Result<String, String> {
    files::default_project_dir()
}

/// Derive the `.graft` and `.db` paths for a new project (see
/// `graft_core::files::create_project_paths`).
#[tauri::command]
pub fn create_project_paths(dir: String, name: String) -> Result<ProjectPaths, String> {
    files::create_project_paths(Path::new(&dir), &name)
}
