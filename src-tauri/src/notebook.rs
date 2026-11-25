//! Local notebook persistence for Graft v0.1.
//!
//! Notebooks are saved as plain JSON `.graft` files — Git-diff-friendly, per the
//! persistence direction in the project's open questions. The frontend owns the
//! schema; these commands just read and write the serialized string at a path,
//! plus a couple of helpers to resolve a default project directory and to derive
//! the `.graft` / `.db` paths for a new project (cross-platform path joining).
//!
//! Access rules (the webview is not trusted with the whole disk):
//! - notebook commands only touch files with the `.graft` extension;
//! - `read_text_file` / `write_text_file` only touch paths the user picked in a
//!   native dialog this session (see `scope.rs` and `dialogs.rs`).

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use graft_core::files::{
    project_paths, read_project, validate_project_name, write_atomic, write_project,
};

use crate::scope::{Access, FileScope};

fn write_granted(scope: &FileScope, path: &Path, contents: &str) -> Result<(), String> {
    scope.check(Access::Write, path)?;
    write_atomic(path, contents).map_err(|e| e.to_string())
}

fn read_granted(scope: &FileScope, path: &Path) -> Result<String, String> {
    scope.check(Access::Read, path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write UTF-8 text (atomically) to a path chosen in the export dialog.
#[tauri::command]
pub fn write_text_file(
    scope: State<'_, FileScope>,
    path: String,
    contents: String,
) -> Result<(), String> {
    write_granted(&scope, Path::new(&path), &contents)
}

/// Read UTF-8 text from a path chosen in the import dialog.
#[tauri::command]
pub fn read_text_file(scope: State<'_, FileScope>, path: String) -> Result<String, String> {
    read_granted(&scope, Path::new(&path))
}

/// Write notebook JSON (atomically) to a `.graft` file.
#[tauri::command]
pub fn save_notebook(path: String, contents: String) -> Result<(), String> {
    write_project(Path::new(&path), &contents)
}

/// Read notebook JSON from a `.graft` file.
#[tauri::command]
pub fn load_notebook(path: String) -> Result<String, String> {
    read_project(Path::new(&path))
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
/// Refuses to reuse the path of an existing project, which would otherwise be
/// silently overwritten by the first save.
#[tauri::command]
pub fn create_project_paths(dir: String, name: String) -> Result<ProjectPaths, String> {
    validate_project_name(&name)?;
    let dir = Path::new(&dir);
    let (project_path, db_path) = project_paths(dir, &name);
    if project_path.exists() {
        return Err(format!(
            "a project already exists at {} — open it or choose another name",
            project_path.display()
        ));
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(ProjectPaths {
        project_path: project_path.to_string_lossy().into_owned(),
        db_path: db_path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("graft-nb-{tag}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }


    #[test]
    fn refuses_to_overwrite_an_existing_project() {
        let dir = scratch_dir("exists");
        let dir_str = dir.to_string_lossy().into_owned();
        let paths = create_project_paths(dir_str.clone(), "p".into()).unwrap();
        save_notebook(paths.project_path, "{}".into()).unwrap();
        assert!(create_project_paths(dir_str, "p".into()).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn notebook_commands_only_touch_project_files() {
        let dir = scratch_dir("ext");
        let graft = dir.join("a.GRAFT").to_string_lossy().into_owned();
        let other = dir.join("a.txt").to_string_lossy().into_owned();
        assert!(save_notebook(graft.clone(), "{}".into()).is_ok());
        assert_eq!(load_notebook(graft).unwrap(), "{}");
        assert!(save_notebook(other.clone(), "x".into()).is_err());
        assert!(load_notebook(other).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn text_files_require_a_dialog_grant() {
        let dir = scratch_dir("grant");
        let file = dir.join("out.sql");
        let scope = FileScope::default();
        assert!(write_granted(&scope, &file, "SELECT 1;").is_err());
        assert!(!file.exists());

        scope.grant(Access::Write, &file);
        write_granted(&scope, &file, "SELECT 1;").unwrap();
        assert!(read_granted(&scope, &file).is_err(), "write grant is not a read grant");

        scope.grant(Access::Read, &file);
        assert_eq!(read_granted(&scope, &file).unwrap(), "SELECT 1;");
        fs::remove_dir_all(&dir).ok();
    }

}
