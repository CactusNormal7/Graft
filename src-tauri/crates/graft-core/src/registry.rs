//! Projects known on this machine, and which ones let Claude write.
//!
//! The app registers every project it creates, opens or saves; the MCP
//! server only ever touches projects listed here — never arbitrary paths a
//! client sends. The per-project "allow writes" switch lives here, in the
//! user's data directory, rather than in the `.graft` file: a project shared
//! through Git must not be able to grant itself write access.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::files::write_atomic;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownProject {
    pub path: String,
    pub name: String,
    /// Whether MCP clients may run DML/DDL on this project's database.
    #[serde(default)]
    pub allow_mcp_writes: bool,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct Registry {
    #[serde(default)]
    pub projects: Vec<KnownProject>,
}

/// `<user data dir>/Graft/projects.json`.
pub fn default_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("Graft").join("projects.json"))
}

impl Registry {
    /// The registry at `file`; empty when it does not exist yet.
    pub fn load(file: &Path) -> Result<Registry, String> {
        match fs::read_to_string(file) {
            Ok(json) => serde_json::from_str(&json).map_err(|e| format!("{}: {e}", file.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry::default()),
            Err(e) => Err(format!("{}: {e}", file.display())),
        }
    }

    pub fn save(&self, file: &Path) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(file, &json).map_err(|e| e.to_string())
    }

    /// Add or rename a project; its write permission is kept.
    pub fn register(&mut self, path: &str, name: &str) {
        match self.projects.iter_mut().find(|p| p.path == path) {
            Some(project) => project.name = name.to_string(),
            None => self.projects.push(KnownProject {
                path: path.to_string(),
                name: name.to_string(),
                allow_mcp_writes: false,
            }),
        }
    }

    pub fn set_mcp_writes(&mut self, path: &str, allow: bool) -> Result<(), String> {
        let project = self
            .projects
            .iter_mut()
            .find(|p| p.path == path)
            .ok_or_else(|| format!("unknown project {path}"))?;
        project.allow_mcp_writes = allow;
        Ok(())
    }

    /// A project by exact path, or by name when that name is unambiguous.
    pub fn find(&self, reference: &str) -> Result<&KnownProject, String> {
        if let Some(project) = self.projects.iter().find(|p| p.path == reference) {
            return Ok(project);
        }
        let mut by_name = self.projects.iter().filter(|p| p.name.eq_ignore_ascii_case(reference));
        match (by_name.next(), by_name.next()) {
            (Some(project), None) => Ok(project),
            (Some(_), Some(_)) => Err(format!(
                "several projects are named {reference:?}: pass the project path instead"
            )),
            _ => Err(format!(
                "unknown project {reference:?}: only projects opened in Graft are available (see list_projects)"
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_finds_and_persists_projects() {
        let dir = std::env::temp_dir().join(format!("graft-registry-{}", std::process::id()));
        let file = dir.join("projects.json");
        let mut registry = Registry::load(&file).unwrap();
        assert!(registry.projects.is_empty());

        registry.register("/p/shop.graft", "shop");
        registry.register("/q/shop.graft", "shop");
        registry.register("/p/crm.graft", "crm");
        registry.set_mcp_writes("/p/crm.graft", true).unwrap();
        registry.register("/p/crm.graft", "crm2");
        registry.save(&file).unwrap();

        let reloaded = Registry::load(&file).unwrap();
        let crm = reloaded.find("CRM2").unwrap();
        assert!(crm.allow_mcp_writes, "renaming keeps the permission");
        assert!(reloaded.find("shop").is_err(), "ambiguous name");
        assert_eq!(reloaded.find("/q/shop.graft").unwrap().name, "shop");
        assert!(reloaded.find("/etc/passwd").is_err());
        assert!(registry.set_mcp_writes("/nope.graft", true).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
