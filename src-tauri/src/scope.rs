//! Session file-access scope.
//!
//! The webview must not be able to read or write arbitrary files: a script
//! injected through rendered data (a crafted cell value, an imported file)
//! would otherwise get the whole disk through `read_text_file` /
//! `write_text_file`. Paths are therefore *granted* by the backend only when
//! the user picks them in a native dialog (see `dialogs.rs`), and the file
//! commands refuse anything that was not granted during this session.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// What a grant allows on a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Access {
    Read,
    Write,
}

/// Paths the user explicitly chose this session, per access kind.
#[derive(Default)]
pub struct FileScope {
    granted: Mutex<HashSet<(Access, PathBuf)>>,
}

impl FileScope {
    /// Allow `access` on `path` for the rest of the session.
    pub fn grant(&self, access: Access, path: &Path) {
        self.lock().insert((access, path.to_path_buf()));
    }

    /// `Ok` when `access` on `path` was granted, an error message otherwise.
    pub fn check(&self, access: Access, path: &Path) -> Result<(), String> {
        if self.lock().contains(&(access, path.to_path_buf())) {
            Ok(())
        } else {
            Err(format!(
                "access denied: {} was not chosen through a file dialog",
                path.display()
            ))
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<(Access, PathBuf)>> {
        // A poisoned lock only means another thread panicked mid-insert; the
        // set itself is still consistent.
        self.granted.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_are_per_path_and_per_access() {
        let scope = FileScope::default();
        let file = Path::new("/tmp/export.sql");
        assert!(scope.check(Access::Write, file).is_err());

        scope.grant(Access::Write, file);
        assert!(scope.check(Access::Write, file).is_ok());
        assert!(scope.check(Access::Read, file).is_err());
        assert!(scope.check(Access::Write, Path::new("/tmp/other.sql")).is_err());
    }
}
