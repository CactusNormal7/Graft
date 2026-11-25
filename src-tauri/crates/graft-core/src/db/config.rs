//! What a connection is: engine + where to reach it. Persisted in the `.graft`
//! file — which is why there is deliberately no password field: passwords live
//! in the OS keychain (`secrets.rs`), keyed by the connection `id`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Sqlite,
    Postgres,
    Mysql,
}

/// TLS policy, mapped onto each driver's own modes.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    /// TLS when the server offers it (driver default).
    #[default]
    Prefer,
    Require,
    /// TLS with certificate and host name verification.
    VerifyFull,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// Stable identifier, also the keychain account of the password.
    pub id: String,
    pub engine: Engine,
    /// SQLite database file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default)]
    pub ssl_mode: SslMode,
}

pub const POSTGRES_DEFAULT_PORT: u16 = 5432;
pub const MYSQL_DEFAULT_PORT: u16 = 3306;

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

impl ConnectionConfig {
    /// SQLite database file, or an error for a server engine / a missing path.
    pub fn sqlite_path(&self) -> Result<&str, String> {
        non_empty(&self.path).ok_or_else(|| "no SQLite database file configured".into())
    }

    pub fn host(&self) -> Result<&str, String> {
        non_empty(&self.host).ok_or_else(|| "no host configured".into())
    }

    pub fn user(&self) -> Result<&str, String> {
        non_empty(&self.user).ok_or_else(|| "no user configured".into())
    }

    pub fn database(&self) -> Option<&str> {
        non_empty(&self.database)
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(match self.engine {
            Engine::Mysql => MYSQL_DEFAULT_PORT,
            _ => POSTGRES_DEFAULT_PORT,
        })
    }

    /// Check the fields the engine needs, before trying to connect.
    pub fn validate(&self) -> Result<(), String> {
        match self.engine {
            Engine::Sqlite => self.sqlite_path().map(|_| ()),
            Engine::Postgres | Engine::Mysql => {
                self.host()?;
                self.user()?;
                if self.engine == Engine::Mysql && self.database().is_none() {
                    return Err("MySQL connections need a database".into());
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(engine: Engine) -> ConnectionConfig {
        ConnectionConfig {
            id: "c1".into(),
            engine,
            path: None,
            host: Some("db.local".into()),
            port: None,
            database: Some("app".into()),
            user: Some("alice".into()),
            ssl_mode: SslMode::Prefer,
        }
    }

    #[test]
    fn deserializes_the_frontend_shape() {
        let json = r#"{"id":"x","engine":"postgres","host":"h","user":"u","sslMode":"verify-full"}"#;
        let config: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.engine, Engine::Postgres);
        assert_eq!(config.ssl_mode, SslMode::VerifyFull);
        assert_eq!(config.port(), POSTGRES_DEFAULT_PORT);
    }

    #[test]
    fn validates_required_fields_per_engine() {
        assert!(server(Engine::Postgres).validate().is_ok());
        let mut no_db = server(Engine::Mysql);
        no_db.database = None;
        assert!(no_db.validate().is_err());
        let mut no_host = server(Engine::Postgres);
        no_host.host = Some("  ".into());
        assert!(no_host.validate().is_err());
        let sqlite = ConnectionConfig { engine: Engine::Sqlite, path: Some("/a.db".into()), ..server(Engine::Sqlite) };
        assert!(sqlite.validate().is_ok());
    }
}
