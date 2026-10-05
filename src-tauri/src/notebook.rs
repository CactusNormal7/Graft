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
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::scope::{Access, FileScope};

/// Extension of a Graft project file.
const PROJECT_EXTENSION: &str = "graft";

/// Characters rejected in a project name: path separators and the characters
/// Windows forbids in file names (the strictest of the shipping targets).
const FORBIDDEN_NAME_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Write `contents` to `path` atomically: write a sibling temp file, then
/// rename it over the target. A crash or a full disk mid-write leaves the
/// previous file intact instead of a truncated project.
fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let mut tmp_name = file_name.to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);

    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// `Ok` when `path` names a `.graft` project file.
fn require_project_file(path: &Path) -> Result<(), String> {
    let is_project = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION));
    if is_project {
        Ok(())
    } else {
        Err(format!("not a .{PROJECT_EXTENSION} project file: {}", path.display()))
    }
}

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
    let path = Path::new(&path);
    require_project_file(path)?;
    write_atomic(path, &contents).map_err(|e| e.to_string())
}

/// Read notebook JSON from a `.graft` file.
#[tauri::command]
pub fn load_notebook(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    require_project_file(path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
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

/// A project name must be usable as a file name on every target platform.
fn validate_project_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("project name cannot be \".\" or \"..\"".into());
    }
    if let Some(c) = trimmed
        .chars()
        .find(|c| FORBIDDEN_NAME_CHARS.contains(c) || c.is_control())
    {
        return Err(format!("project name cannot contain {c:?}"));
    }
    Ok(())
}

fn project_paths(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
    let name = name.trim();
    (
        dir.join(format!("{name}.graft")),
        dir.join(format!("{name}.db")),
    )
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

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("graft-nb-{tag}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_unsafe_project_names() {
        assert!(validate_project_name("analytics").is_ok());
        assert!(validate_project_name("my project 2").is_ok());
        assert!(validate_project_name("  ").is_err());
        assert!(validate_project_name("..").is_err());
        assert!(validate_project_name("../escape").is_err());
        assert!(validate_project_name("a\\b").is_err());
        assert!(validate_project_name("what?").is_err());
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

    #[test]
    fn atomic_write_replaces_contents_and_leaves_no_temp_file() {
        let dir = scratch_dir("atomic");
        let file = dir.join("n.graft");
        write_atomic(&file, "one").unwrap();
        write_atomic(&file, "two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert!(!dir.join("n.graft.tmp").exists());
        fs::remove_dir_all(&dir).ok();
    }
}
