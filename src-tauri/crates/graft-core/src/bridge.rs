//! Live bridge between `graft-mcp` and the running app.
//!
//! When the app is open it listens on 127.0.0.1 (random port) and writes
//! `<user data dir>/Graft/bridge.json` = { port, token, pid }, readable by the
//! user only. After writing a project file, `graft-mcp` sends one JSON line
//! `{ token, event }`; the app answers `ok` and checks the file at once, so
//! blocks created by Claude appear without waiting for the poll. The token
//! keeps other local programs from poking the app; nothing but "this project
//! file changed" travels on the socket — the app re-reads the file itself.
//! No app running → nothing listens, and `notify` quietly returns false.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::files::write_atomic;

/// A client that can't connect or answer this fast means no app is running.
const NOTIFY_TIMEOUT: Duration = Duration::from_millis(500);
/// Longest message accepted by the app: a path plus a token.
const MAX_MESSAGE_BYTES: u64 = 64 * 1024;
const TOKEN_BYTES: usize = 32;
const ACCEPTED: &str = "ok";
const REFUSED: &str = "denied";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BridgeEvent {
    /// A project file was rewritten (blocks created or edited).
    ProjectChanged { path: String },
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    token: String,
    event: BridgeEvent,
}

pub fn default_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("Graft").join("bridge.json"))
}

/// A fresh random token (hex), from the OS random source.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("no random source: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Write the bridge file, readable only by the current user on Unix (the
/// user profile directory already restricts it on Windows).
pub fn write_info(file: &Path, info: &BridgeInfo) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(info).map_err(|e| e.to_string())?;
    write_atomic(file, &json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(file, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Remove the bridge file if it is still ours (another app instance may have
/// replaced it).
pub fn remove_info(file: &Path, token: &str) {
    if read_info(file).is_some_and(|info| info.token == token) {
        let _ = fs::remove_file(file);
    }
}

pub fn read_info(file: &Path) -> Option<BridgeInfo> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

/// Compare without stopping at the first difference.
fn tokens_match(given: &str, expected: &str) -> bool {
    given.len() == expected.len()
        && given.bytes().zip(expected.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

pub fn encode(token: &str, event: &BridgeEvent) -> String {
    let envelope = Envelope { token: token.to_string(), event: event.clone() };
    serde_json::to_string(&envelope).unwrap_or_default() + "\n"
}

pub fn decode(line: &str, expected_token: &str) -> Result<BridgeEvent, String> {
    let envelope: Envelope = serde_json::from_str(line.trim()).map_err(|e| format!("malformed message: {e}"))?;
    if tokens_match(&envelope.token, expected_token) {
        Ok(envelope.event)
    } else {
        Err("wrong token".into())
    }
}

/// Tell the running app about `event`; false when no app is listening (or it
/// refused). Never blocks longer than `NOTIFY_TIMEOUT` per step.
pub async fn notify(info_file: &Path, event: &BridgeEvent) -> bool {
    let Some(info) = read_info(info_file) else {
        return false;
    };
    let exchange = async {
        let mut stream = TcpStream::connect(("127.0.0.1", info.port)).await.ok()?;
        stream.write_all(encode(&info.token, event).as_bytes()).await.ok()?;
        let mut reply = String::new();
        BufReader::new(stream).read_line(&mut reply).await.ok()?;
        Some(reply.trim() == ACCEPTED)
    };
    tokio::time::timeout(NOTIFY_TIMEOUT, exchange).await.ok().flatten().unwrap_or(false)
}

async fn handle(stream: TcpStream, token: &str, on_event: &(dyn Fn(BridgeEvent) + Send + Sync)) {
    let (reader, mut writer) = stream.into_split();
    let mut line = String::new();
    let mut limited = BufReader::new(reader.take(MAX_MESSAGE_BYTES));
    let read = limited.read_line(&mut line);
    let reply = match tokio::time::timeout(NOTIFY_TIMEOUT, read).await {
        Ok(Ok(_)) => match decode(&line, token) {
            Ok(event) => {
                on_event(event);
                ACCEPTED
            }
            Err(_) => REFUSED,
        },
        _ => REFUSED,
    };
    let _ = writer.write_all(format!("{reply}\n").as_bytes()).await;
}

/// Accept messages forever on `listener`, calling `on_event` for each one
/// carrying `token`.
pub async fn serve<F>(listener: TcpListener, token: String, on_event: F)
where
    F: Fn(BridgeEvent) + Send + Sync + 'static,
{
    let on_event = std::sync::Arc::new(on_event);
    let token = std::sync::Arc::new(token);
    while let Ok((stream, _)) = listener.accept().await {
        let (token, on_event) = (token.clone(), on_event.clone());
        tokio::spawn(async move { handle(stream, &token, &*on_event).await });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn changed(path: &str) -> BridgeEvent {
        BridgeEvent::ProjectChanged { path: path.into() }
    }

    #[test]
    fn decodes_only_messages_with_the_right_token() {
        let line = encode("secret", &changed("/p/a.graft"));
        assert_eq!(decode(&line, "secret").unwrap(), changed("/p/a.graft"));
        assert!(decode(&line, "other!").is_err());
        assert!(decode("not json", "secret").is_err());
        assert_eq!(new_token().unwrap().len(), TOKEN_BYTES * 2);
        assert_ne!(new_token().unwrap(), new_token().unwrap());
    }

    #[tokio::test]
    async fn delivers_events_to_a_running_app() {
        let dir = std::env::temp_dir().join(format!("graft-bridge-{}", std::process::id()));
        let file = dir.join("bridge.json");
        assert!(!notify(&file, &changed("/x")).await, "no app running");

        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = new_token().unwrap();
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        tokio::spawn(serve(listener, token.clone(), move |event| sink.lock().unwrap().push(event)));
        write_info(&file, &BridgeInfo { port, token: token.clone(), pid: std::process::id() }).unwrap();

        assert!(notify(&file, &changed("/p/a.graft")).await);
        assert_eq!(*received.lock().unwrap(), vec![changed("/p/a.graft")]);

        write_info(&file, &BridgeInfo { port, token: "forged".into(), pid: 0 }).unwrap();
        assert!(!notify(&file, &changed("/p/b.graft")).await, "a wrong token is refused");
        assert_eq!(received.lock().unwrap().len(), 1);

        remove_info(&file, &token);
        assert!(file.exists(), "not ours any more: left alone");
        remove_info(&file, "forged");
        assert!(!file.exists());
        fs::remove_dir_all(&dir).ok();
    }
}
