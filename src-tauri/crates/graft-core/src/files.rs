//! `.graft` project files on disk: atomic writes, the `.graft`-only rule,
//! project naming and paths. Shared by the app's commands and the MCP server.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Extension of a Graft project file.
pub const PROJECT_EXTENSION: &str = "graft";

/// Characters rejected in a project name: path separators and the characters
/// Windows forbids in file names (the strictest of the shipping targets).
pub const FORBIDDEN_NAME_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Write `contents` to `path` atomically: write a sibling temp file, then
/// rename it over the target. A crash or a full disk mid-write leaves the
/// previous file intact instead of a truncated project.
pub fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
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
pub fn require_project_file(path: &Path) -> Result<(), String> {
    let is_project = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION));
    if is_project {
        Ok(())
    } else {
        Err(format!("not a .{PROJECT_EXTENSION} project file: {}", path.display()))
    }
}

/// A project name must be usable as a file name on every target platform.
pub fn validate_project_name(name: &str) -> Result<(), String> {
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

pub fn project_paths(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
    let name = name.trim();
    (
        dir.join(format!("{name}.graft")),
        dir.join(format!("{name}.db")),
    )
}

/// Read a project file (`.graft` only).
pub fn read_project(path: &Path) -> Result<String, String> {
    require_project_file(path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a project file atomically (`.graft` only).
pub fn write_project(path: &Path, contents: &str) -> Result<(), String> {
    require_project_file(path)?;
    write_atomic(path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("graft-files-{tag}-{}", std::process::id()));
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
    fn project_io_only_touches_project_files() {
        let dir = scratch_dir("ext");
        let graft = dir.join("a.GRAFT");
        assert!(write_project(&graft, "{}").is_ok());
        assert_eq!(read_project(&graft).unwrap(), "{}");
        assert!(write_project(&dir.join("a.txt"), "x").is_err());
        assert!(read_project(&dir.join("a.txt")).is_err());
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
