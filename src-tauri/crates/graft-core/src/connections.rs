//! Named connections, reusable across projects (`<user data
//! dir>/Graft/connections.json`).
//!
//! A project still embeds its own copy of the connection, so a `.graft` file
//! stays self-contained when shared. Picking a saved connection copies it —
//! id included — so projects using it share the password stored in the OS
//! keychain under that id. Like the project files, this file never holds a
//! password.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::ConnectionConfig;
use crate::files::write_atomic;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SavedConnection {
    pub name: String,
    pub connection: ConnectionConfig,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct ConnectionLibrary {
    #[serde(default)]
    pub connections: Vec<SavedConnection>,
}

pub fn default_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("Graft").join("connections.json"))
}

impl ConnectionLibrary {
    pub fn load(file: &Path) -> Result<ConnectionLibrary, String> {
        match fs::read_to_string(file) {
            Ok(json) => serde_json::from_str(&json).map_err(|e| format!("{}: {e}", file.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConnectionLibrary::default()),
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

    /// Add a connection, or update the one with the same id. Names are
    /// trimmed and must be non-empty and unique among other connections.
    pub fn upsert(&mut self, name: &str, connection: ConnectionConfig) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("a saved connection needs a name".into());
        }
        let taken = self
            .connections
            .iter()
            .any(|saved| saved.name.eq_ignore_ascii_case(name) && saved.connection.id != connection.id);
        if taken {
            return Err(format!("a saved connection is already named {name:?}"));
        }
        let entry = SavedConnection { name: name.to_string(), connection };
        match self.connections.iter_mut().find(|saved| saved.connection.id == entry.connection.id) {
            Some(existing) => *existing = entry,
            None => self.connections.push(entry),
        }
        self.connections.sort_by_key(|saved| saved.name.to_lowercase());
        Ok(())
    }

    /// Remove a saved connection; false when there was none with that id.
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.connections.len();
        self.connections.retain(|saved| saved.connection.id != id);
        self.connections.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::config::SslMode;
    use crate::db::Engine;

    fn connection(id: &str, host: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.into(),
            engine: Engine::Postgres,
            path: None,
            host: Some(host.into()),
            port: None,
            database: Some("app".into()),
            user: Some("ada".into()),
            ssl_mode: SslMode::Require,
        }
    }

    #[test]
    fn saves_updates_and_removes_named_connections() {
        let dir = std::env::temp_dir().join(format!("graft-conns-{}", std::process::id()));
        let file = dir.join("connections.json");
        let mut library = ConnectionLibrary::load(&file).unwrap();
        library.upsert("Prod", connection("c1", "prod.db")).unwrap();
        library.upsert("  analytics ", connection("c2", "olap.db")).unwrap();
        library.upsert("Production", connection("c1", "prod2.db")).unwrap();
        assert!(library.upsert("PRODUCTION", connection("c3", "x")).is_err(), "names are unique");
        assert!(library.upsert("  ", connection("c4", "x")).is_err());
        library.save(&file).unwrap();

        let mut reloaded = ConnectionLibrary::load(&file).unwrap();
        let names: Vec<&str> = reloaded.connections.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["analytics", "Production"]);
        assert_eq!(reloaded.connections[1].connection.host.as_deref(), Some("prod2.db"));
        assert!(!fs::read_to_string(&file).unwrap().contains("password"));
        assert!(reloaded.remove("c2"));
        assert!(!reloaded.remove("c2"));
        fs::remove_dir_all(&dir).ok();
    }
}
