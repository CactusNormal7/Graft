mod db;
mod dialogs;
mod notebook;
mod scope;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, RunEvent, Runtime, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use scope::FileScope;

/// Whether the open project has unsaved changes, mirrored from the frontend
/// store so closing the window / quitting can be intercepted natively.
#[derive(Default)]
struct UnsavedChanges(AtomicBool);

/// Called by the frontend whenever its "unsaved changes" state flips.
#[tauri::command]
fn set_unsaved_changes(state: State<'_, UnsavedChanges>, dirty: bool) {
    state.0.store(dirty, Ordering::SeqCst);
}

fn has_unsaved_changes<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<UnsavedChanges>().0.load(Ordering::SeqCst)
}

/// Ask before discarding unsaved changes; runs `proceed` only if confirmed.
/// The flag is cleared first so the follow-up close/exit is not intercepted
/// a second time.
fn confirm_discard<R: Runtime>(app: &AppHandle<R>, proceed: impl FnOnce() + Send + 'static) {
    let handle = app.clone();
    app.dialog()
        .message("The project has unsaved changes. Quit without saving?")
        .title("Unsaved changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit without saving".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            if confirmed {
                handle.state::<UnsavedChanges>().0.store(false, Ordering::SeqCst);
                proceed();
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(FileScope::default())
        .manage(UnsavedChanges::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if has_unsaved_changes(window.app_handle()) {
                    api.prevent_close();
                    let target = window.clone();
                    confirm_discard(window.app_handle(), move || {
                        let _ = target.destroy();
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            db::execute_sql,
            db::introspect_schema,
            notebook::save_notebook,
            notebook::load_notebook,
            notebook::write_text_file,
            notebook::read_text_file,
            notebook::default_project_dir,
            notebook::create_project_paths,
            dialogs::pick_project_file,
            dialogs::pick_sqlite_file,
            dialogs::pick_directory,
            dialogs::pick_import_file,
            dialogs::pick_export_file,
            dialogs::confirm_dialog,
            set_unsaved_changes,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // App-level quit (e.g. Cmd+Q on macOS) bypasses the window close event.
        // `code: None` means a user/OS-initiated exit, not `app.exit(code)`.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            if has_unsaved_changes(app) {
                api.prevent_exit();
                let handle = app.clone();
                confirm_discard(app, move || handle.exit(0));
            }
        }
    });
}
