//! Which projects the MCP server may touch.
//!
//! Only `.graft` files found under the configured roots are reachable — never
//! an arbitrary path an agent passes in. Same principle as the webview
//! protection in the app (`graft_core::scope`): access is granted by
//! configuration, not by the caller.

use std::fs;
use std::path::{Path, PathBuf};

use graft_core::files::is_project_file;
use graft_core::notebook::{load_project, Project};

/// How deep under a root to look for `.graft` files.
const MAX_DEPTH: usize = 4;

/// Directories never worth descending into.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "graphify-out"];

/// The set of directories projects are discovered in.
#[derive(Clone, Debug)]
pub struct Roots(Vec<PathBuf>);

impl Roots {
    pub fn new(dirs: Vec<PathBuf>) -> Self {
        let mut canonical: Vec<PathBuf> = dirs
            .into_iter()
            .filter_map(|d| fs::canonicalize(d).ok())
            .collect();
        canonical.sort();
        canonical.dedup();
        Self(canonical)
    }

    pub fn dirs(&self) -> &[PathBuf] {
        &self.0
    }

    /// Every `.graft` file under the roots, sorted by path.
    pub fn project_files(&self) -> Vec<PathBuf> {
        let mut found = Vec::new();
        for root in &self.0 {
            walk(root, 0, &mut found);
        }
        found.sort();
        found.dedup();
        found
    }

    /// Load every discoverable project; unreadable files are skipped.
    pub fn projects(&self) -> Vec<Project> {
        self.project_files()
            .iter()
            .filter_map(|p| load_project(p).ok())
            .collect()
    }

    /// Resolve `query` — a project name, or the path of a discovered `.graft`
    /// file — to a loaded project. A name shared by several projects is
    /// ambiguous and must be given as a path.
    pub fn resolve(&self, query: &str) -> Result<Project, String> {
        let files = self.project_files();

        if let Ok(path) = fs::canonicalize(query) {
            return if files.contains(&path) {
                load_project(&path)
            } else {
                Err(format!(
                    "{} is not a project under the configured roots",
                    path.display()
                ))
            };
        }

        let matches: Vec<Project> = files
            .iter()
            .filter_map(|p| load_project(p).ok())
            .filter(|p| p.name() == query)
            .collect();
        match matches.len() {
            0 => Err(format!(
                "no project named {query:?} — call list_projects to see what is available"
            )),
            1 => Ok(matches.into_iter().next().unwrap()),
            _ => Err(format!(
                "{} projects are named {query:?}; pass the project path instead",
                matches.len()
            )),
        }
    }
}

fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if depth < MAX_DEPTH && !name.starts_with('.') && !SKIPPED_DIRS.contains(&name.as_ref())
            {
                walk(&path, depth + 1, found);
            }
        } else if kind.is_file() && is_project_file(&path) {
            if let Ok(canonical) = fs::canonicalize(&path) {
                found.push(canonical);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("graft-mcp-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project_json(name: &str) -> String {
        format!(r#"{{"version":5,"name":"{name}","dbType":"sqlite","dbPath":null,"pages":[]}}"#)
    }

    #[test]
    fn discovers_and_resolves_projects_only_under_roots() {
        let root = scratch("roots");
        let outside = scratch("outside");
        fs::create_dir_all(root.join("nested/deeper")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("a.graft"), project_json("alpha")).unwrap();
        fs::write(root.join("nested/deeper/b.graft"), project_json("beta")).unwrap();
        fs::write(root.join("node_modules/skip.graft"), project_json("skip")).unwrap();
        fs::write(root.join("notes.txt"), "x").unwrap();
        fs::write(outside.join("c.graft"), project_json("gamma")).unwrap();

        let roots = Roots::new(vec![root.clone()]);
        assert_eq!(roots.project_files().len(), 2);
        assert_eq!(roots.resolve("beta").unwrap().name(), "beta");
        let by_path = root.join("a.graft");
        assert_eq!(roots.resolve(&by_path.to_string_lossy()).unwrap().name(), "alpha");
        assert!(roots.resolve("gamma").is_err());
        assert!(roots.resolve(&outside.join("c.graft").to_string_lossy()).is_err());
        assert!(roots.resolve("skip").is_err());

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn a_shared_name_is_ambiguous() {
        let root = scratch("dupe");
        fs::create_dir_all(root.join("x")).unwrap();
        fs::write(root.join("a.graft"), project_json("same")).unwrap();
        fs::write(root.join("x/b.graft"), project_json("same")).unwrap();
        let err = Roots::new(vec![root.clone()]).resolve("same").unwrap_err();
        assert!(err.contains("pass the project path"));
        fs::remove_dir_all(&root).ok();
    }
}
