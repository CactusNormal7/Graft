//! Watch the open project's `.graft` file for changes made outside the app —
//! typically Claude editing blocks through `graft-mcp` — so the app can reload
//! instead of silently overwriting them on its next save.
//!
//! The *parent directory* is watched, not the file: saves are atomic (temp
//! file + rename), which replaces the file and would end a watch held on it.
//! Events are debounced, then the file is re-read and compared with the last
//! contents the app itself loaded or saved (`remember`): the app's own writes
//! never trigger a reload. A real change emits `project-file-changed`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

/// Event sent to the webview when the watched project changed on disk.
pub const PROJECT_FILE_CHANGED: &str = "project-file-changed";

/// Quiet period before a burst of file events is reported.
const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Clone, Serialize)]
struct ProjectFileChanged {
    path: String,
}

/// The project contents the app last read or wrote, per path.
type LastKnown = Arc<Mutex<Option<(PathBuf, String)>>>;

#[derive(Default)]
pub struct ProjectWatch {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    last_known: LastKnown,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A poisoned lock only means a panic elsewhere; the data is still usable.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl ProjectWatch {
    /// Record contents the app itself just loaded or saved at `path`.
    pub fn remember(&self, path: &Path, contents: &str) {
        *lock(&self.last_known) = Some((path.to_path_buf(), contents.to_string()));
    }
}

/// True when `contents` differ from what the app last saw at `path`; records
/// them so a burst of events for one change is reported once.
fn is_external_change(last_known: &LastKnown, path: &Path, contents: &str) -> bool {
    let mut last = lock(last_known);
    if last.as_ref().is_some_and(|(p, c)| p == path && c == contents) {
        return false;
    }
    *last = Some((path.to_path_buf(), contents.to_string()));
    true
}

/// Start watching the project at `path`, replacing any previous watch.
#[tauri::command]
pub fn watch_project<R: Runtime>(
    app: AppHandle<R>,
    watch: State<'_, ProjectWatch>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or("project path has no parent directory")?
        .to_path_buf();
    let file_name = target.file_name().ok_or("project path has no file name")?.to_owned();

    let last_known = Arc::clone(&watch.last_known);
    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        if !events.iter().any(|e| e.path.file_name() == Some(file_name.as_os_str())) {
            return;
        }
        // Deleted or mid-replace: nothing to reload (yet).
        let Ok(contents) = fs::read_to_string(&target) else { return };
        if is_external_change(&last_known, &target, &contents) {
            let _ = app.emit(PROJECT_FILE_CHANGED, ProjectFileChanged { path: path.clone() });
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // Dropping the previous debouncer stops its watch.
    *lock(&watch.debouncer) = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_writes_are_not_external_changes() {
        let watch = ProjectWatch::default();
        let path = Path::new("/p/a.graft");
        watch.remember(path, "saved by the app");
        assert!(!is_external_change(&watch.last_known, path, "saved by the app"));
        assert!(is_external_change(&watch.last_known, path, "edited by Claude"));
        assert!(
            !is_external_change(&watch.last_known, path, "edited by Claude"),
            "one change is reported once"
        );
        assert!(is_external_change(&watch.last_known, Path::new("/p/b.graft"), "edited by Claude"));
    }
}
