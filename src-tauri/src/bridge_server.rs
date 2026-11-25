//! The app's end of the live bridge (`graft_core::bridge`): listen on
//! 127.0.0.1 while the app runs and turn each "project changed" message from
//! graft-mcp into a `bridge-project-changed` event for the webview, which
//! merges the new blocks at once (`checkProjectFile`).

use std::path::PathBuf;

use graft_core::bridge::{self, BridgeEvent, BridgeInfo};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::net::TcpListener;

const PROJECT_CHANGED_EVENT: &str = "bridge-project-changed";

/// What `stop` needs to remove the bridge file.
struct BridgeState {
    file: PathBuf,
    token: String,
}

/// Start listening; failures only disable live updates (the app still polls
/// the project file), so they are reported and swallowed.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let Some(file) = bridge::default_path() else {
        eprintln!("live bridge disabled: no user data directory");
        return;
    };
    let token = match bridge::new_token() {
        Ok(token) => token,
        Err(e) => {
            eprintln!("live bridge disabled: {e}");
            return;
        }
    };
    app.manage(BridgeState { file: file.clone(), token: token.clone() });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", 0)).await {
            Ok(listener) => listener,
            Err(e) => return eprintln!("live bridge disabled: {e}"),
        };
        let port = match listener.local_addr() {
            Ok(address) => address.port(),
            Err(e) => return eprintln!("live bridge disabled: {e}"),
        };
        let info = BridgeInfo { port, token: token.clone(), pid: std::process::id() };
        if let Err(e) = bridge::write_info(&file, &info) {
            return eprintln!("live bridge disabled: {e}");
        }
        bridge::serve(listener, token, move |event| match event {
            BridgeEvent::ProjectChanged { path } => {
                if let Err(e) = handle.emit(PROJECT_CHANGED_EVENT, path) {
                    eprintln!("live bridge: {e}");
                }
            }
        })
        .await;
    });
}

/// Remove the bridge file when the app exits.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<BridgeState>() {
        bridge::remove_info(&state.file, &state.token);
    }
}
