//! Bridge to `sql-language-server` (joe-re), the SQL LSP chosen in CLAUDE.md.
//!
//! The server is a Node program, so it runs as a child process speaking LSP
//! over stdio. The webview cannot spawn processes: it sends JSON-RPC bodies
//! through `lsp_send`, and receives the server's messages as `lsp-message`
//! events. This module only frames/unframes messages (`Content-Length`
//! headers) — the protocol itself is handled by `@codemirror/lsp-client`.
//!
//! The server is optional. It is resolved at runtime (see `resolve_command`);
//! when it is not installed, `lsp_start` returns `false` and the editor keeps
//! its built-in completion. Credentials are never sent to it: the server logs
//! everything it receives to a file in the temp directory.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Runtime, State};

/// Event carrying one JSON-RPC message from the server to the webview.
const MESSAGE_EVENT: &str = "lsp-message";
/// Environment variable overriding the server command (path to an executable).
const COMMAND_ENV: &str = "GRAFT_SQL_LANGUAGE_SERVER";
/// Executable name, on PATH or next to the Graft binary.
const EXECUTABLE: &str = if cfg!(windows) {
    "sql-language-server.cmd"
} else {
    "sql-language-server"
};
const CONTENT_LENGTH: &str = "content-length:";

/// Frame a JSON-RPC body for the LSP base protocol.
pub fn encode_message(body: &str) -> Vec<u8> {
    let mut framed = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    framed.extend_from_slice(body.as_bytes());
    framed
}

/// Read one framed message; `Ok(None)` at end of stream.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix(CONTENT_LENGTH) {
            let parsed = value.trim().parse().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid Content-Length header")
            })?;
            length = Some(parsed);
        }
    }
    let length = length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Per-user install made by `pnpm lsp:install`
/// (`scripts/install-sql-language-server.mjs`).
fn user_install() -> Option<PathBuf> {
    let bin = dirs::data_dir()?
        .join("Graft")
        .join("sql-language-server")
        .join("node_modules")
        .join(".bin")
        .join(EXECUTABLE);
    bin.is_file().then_some(bin)
}

/// Where the server executable is, in order: `$GRAFT_SQL_LANGUAGE_SERVER`,
/// next to the Graft executable (where a bundled copy would live), the
/// per-user install, then PATH.
fn resolve_command() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os(COMMAND_ENV) {
        return Some(PathBuf::from(explicit));
    }
    let beside_app = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(EXECUTABLE)))
        .filter(|candidate| candidate.is_file());
    beside_app
        .or_else(user_install)
        .or_else(|| find_on_path(EXECUTABLE))
}

/// The running server, if started.
#[derive(Default)]
pub struct LanguageServer(Mutex<Option<RunningServer>>);

pub struct RunningServer {
    child: Child,
    stdin: ChildStdin,
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        // Best effort: the process may already have exited.
        let _ = self.child.kill();
    }
}

fn spawn(command: &Path) -> io::Result<Child> {
    Command::new(command)
        .args(["up", "--method", "stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
}

/// Forward every message the server writes to the webview, until it exits.
fn pump_stdout<R: Runtime>(app: AppHandle<R>, stdout: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(message)) = read_message(&mut reader) {
            if app.emit(MESSAGE_EVENT, message).is_err() {
                break;
            }
        }
    });
}

/// Start the server if it is installed. Resolves to whether it is running;
/// idempotent (a second call reuses the running process).
#[tauri::command]
pub fn lsp_start<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, LanguageServer>,
) -> Result<bool, String> {
    let mut slot = server.0.lock().map_err(|_| "language server state poisoned")?;
    if let Some(running) = slot.as_mut() {
        if matches!(running.child.try_wait(), Ok(None)) {
            return Ok(true);
        }
    }
    let Some(command) = resolve_command() else {
        *slot = None;
        return Ok(false);
    };
    let mut child = spawn(&command).map_err(|e| format!("{}: {e}", command.display()))?;
    let stdin = child.stdin.take().ok_or("language server has no stdin")?;
    let stdout = child.stdout.take().ok_or("language server has no stdout")?;
    pump_stdout(app, stdout);
    *slot = Some(RunningServer { child, stdin });
    Ok(true)
}

/// Send one JSON-RPC message (unframed body) to the server.
#[tauri::command]
pub fn lsp_send(server: State<'_, LanguageServer>, message: String) -> Result<(), String> {
    let mut slot = server.0.lock().map_err(|_| "language server state poisoned")?;
    let running = slot.as_mut().ok_or("language server is not running")?;
    running
        .stdin
        .write_all(&encode_message(&message))
        .and_then(|()| running.stdin.flush())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let mut stream = encode_message(r#"{"id":1}"#);
        stream.extend(encode_message(r#"{"é":"ü"}"#));
        let mut reader = io::Cursor::new(stream);
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some(r#"{"id":1}"#));
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some(r#"{"é":"ü"}"#));
        assert_eq!(read_message(&mut reader).unwrap(), None);
    }

    #[test]
    fn length_counts_bytes_and_headers_are_case_insensitive() {
        let raw = "content-length: 4\r\nContent-Type: x\r\n\r\n\"é\"";
        let mut reader = io::Cursor::new(raw.as_bytes().to_vec());
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some("\"é\""));
    }

    /// Talks to a real server; runs only when `GRAFT_SQL_LANGUAGE_SERVER`
    /// points at one (see docs/technique.md § LSP).
    #[test]
    fn initializes_a_real_server_when_installed() {
        let Some(command) = std::env::var_os(COMMAND_ENV).map(PathBuf::from) else {
            return;
        };
        let mut child = spawn(&command).expect("spawn sql-language-server");
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}"#;
        stdin.write_all(&encode_message(init)).unwrap();
        stdin.flush().unwrap();
        let reply = read_message(&mut stdout).unwrap().expect("initialize reply");
        assert!(reply.contains("completionProvider"), "{reply}");
        let _ = child.kill();
    }

    #[test]
    fn rejects_a_message_without_length() {
        let mut reader = io::Cursor::new(b"X-Other: 1\r\n\r\n{}".to_vec());
        assert!(read_message(&mut reader).is_err());
    }
}
