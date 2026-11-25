//! "Install in Claude Desktop": register the bundled `graft-mcp` sidecar in
//! Claude Desktop's configuration (`claude_desktop_config.json`).
//!
//! Config locations: `~/Library/Application Support/Claude/` on macOS,
//! `%APPDATA%\Claude\` on Windows — both are `dirs::config_dir()/Claude`.

use std::fs;
use std::path::{Path, PathBuf};

use graft_core::files::write_atomic;
use serde_json::{json, Map, Value};

const CONFIG_FILE: &str = "claude_desktop_config.json";
/// Key of Graft's entry under `mcpServers`.
const SERVER_KEY: &str = "graft";
const MCP_EXECUTABLE: &str = if cfg!(windows) { "graft-mcp.exe" } else { "graft-mcp" };

/// Add (or replace) Graft's entry in a Claude Desktop config, keeping every
/// other setting and server. Refuses to touch a file that is not a JSON
/// object rather than overwrite something it does not understand.
pub fn merge_config(existing: Option<&str>, command: &str) -> Result<String, String> {
    let mut root = match existing.map(str::trim).filter(|text| !text.is_empty()) {
        None => Map::new(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(root)) => root,
            Ok(_) => return Err(format!("{CONFIG_FILE} is not a JSON object; fix it by hand first")),
            Err(e) => return Err(format!("{CONFIG_FILE} is not valid JSON ({e}); fix it by hand first")),
        },
    };
    let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| format!("\"mcpServers\" in {CONFIG_FILE} is not an object"))?;
    servers.insert(SERVER_KEY.into(), json!({ "command": command, "args": [] }));
    serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())
}

fn config_path() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("could not resolve the configuration directory")?
        .join("Claude")
        .join(CONFIG_FILE))
}

/// The sidecar sits next to the app executable (Tauri's `externalBin`
/// layout; in development, `target/<profile>/` holds both).
fn mcp_executable() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let candidate = exe.parent().ok_or("app executable has no directory")?.join(MCP_EXECUTABLE);
    if candidate.is_file() {
        Ok(candidate)
    } else {
        Err(format!(
            "{} was not found next to Graft. In development, build it with \
             `cargo build -p graft-mcp` (in src-tauri/).",
            candidate.display()
        ))
    }
}

fn install(config: &Path, command: &Path) -> Result<(), String> {
    let existing = match fs::read_to_string(config) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", config.display())),
    };
    let merged = merge_config(existing.as_deref(), &command.to_string_lossy())?;
    if let Some(dir) = config.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if let Some(previous) = &existing {
        // Keep the user's previous file next to it, in case of a surprise.
        fs::write(config.with_extension("json.bak"), previous).map_err(|e| e.to_string())?;
    }
    write_atomic(config, &merged).map_err(|e| e.to_string())
}

/// Register `graft-mcp` in Claude Desktop; returns the config file path.
#[tauri::command]
pub fn install_claude_desktop() -> Result<String, String> {
    let config = config_path()?;
    install(&config, &mcp_executable()?)?;
    Ok(config.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_graft_and_keeps_everything_else() {
        let existing = r#"{"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}"#;
        let merged: Value = serde_json::from_str(&merge_config(Some(existing), "/apps/graft-mcp").unwrap()).unwrap();
        assert_eq!(merged["mcpServers"]["graft"]["command"], json!("/apps/graft-mcp"));
        assert_eq!(merged["mcpServers"]["other"]["command"], json!("x"));
        assert_eq!(merged["theme"], json!("dark"));

        let fresh: Value = serde_json::from_str(&merge_config(None, "C:\\Graft\\graft-mcp.exe").unwrap()).unwrap();
        assert_eq!(fresh["mcpServers"]["graft"]["command"], json!("C:\\Graft\\graft-mcp.exe"));
        assert!(merge_config(Some("  "), "x").is_ok());
    }

    #[test]
    fn refuses_files_it_does_not_understand() {
        assert!(merge_config(Some("[1, 2]"), "x").is_err());
        assert!(merge_config(Some("{ not json"), "x").is_err());
        assert!(merge_config(Some(r#"{"mcpServers": []}"#), "x").is_err());
    }

    #[test]
    fn installs_with_a_backup_of_the_previous_file() {
        let dir = std::env::temp_dir().join(format!("graft-claude-{}", std::process::id()));
        let config = dir.join("Claude").join(CONFIG_FILE);
        install(&config, Path::new("/apps/graft-mcp")).unwrap();
        assert!(!config.with_extension("json.bak").exists(), "nothing to back up the first time");
        install(&config, Path::new("/apps/v2/graft-mcp")).unwrap();
        let backup = fs::read_to_string(config.with_extension("json.bak")).unwrap();
        assert!(backup.contains("/apps/graft-mcp"));
        assert!(fs::read_to_string(&config).unwrap().contains("/apps/v2/graft-mcp"));
        fs::remove_dir_all(&dir).ok();
    }
}
