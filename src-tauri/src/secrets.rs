//! Connection passwords in the OS credential store (macOS Keychain, Windows
//! Credential Manager), one entry per connection id. They never touch the
//! `.graft` file, the webview (no command returns them) or the logs.

use keyring::{Entry, Error};

/// Keychain service name: the app identifier from `tauri.conf.json`.
const SERVICE: &str = "com.cactus.graft";

fn entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, connection_id).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Call once at startup, on the main thread, before any other thread exists.
///
/// Linux only (a development platform, not a shipping target): the keyutils
/// backend joins a *session* keyring, and without a login session (WSL, a bare
/// X server) each thread would join its own — a password stored from one
/// thread is then invisible from another. Joining here first makes every
/// thread created afterwards inherit the same keyring.
pub fn prepare() {
    #[cfg(target_os = "linux")]
    if let Err(e) = Entry::new(SERVICE, "session") {
        eprintln!("keychain unavailable: {e}");
    }
}

/// The stored password, or `None` when the connection has none.
pub fn password(connection_id: &str) -> Result<Option<String>, String> {
    match entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("could not read the password from the keychain: {e}")),
    }
}

pub fn set_password(connection_id: &str, password: &str) -> Result<(), String> {
    entry(connection_id)?
        .set_password(password)
        .map_err(|e| format!("could not store the password in the keychain: {e}"))
}

/// Remove the stored password; a connection without one is not an error.
pub fn delete_password(connection_id: &str) -> Result<(), String> {
    match entry(connection_id)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not delete the password from the keychain: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_connection_without_password_reads_as_none() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        assert_eq!(password("never-stored").unwrap(), None);
        assert!(delete_password("never-stored").is_ok());
    }
}
