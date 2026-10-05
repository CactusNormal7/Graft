//! Native dialogs, run from the backend.
//!
//! The frontend has no direct access to the dialog plugin (its permission is
//! not granted in `capabilities/default.json`): it calls these commands, which
//! fix the filters and, for import/export, register the chosen path in the
//! session `FileScope` so the file commands will accept it.

use std::path::PathBuf;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::{
    DialogExt, FileDialogBuilder, FilePath, MessageDialogButtons, MessageDialogKind,
};
use tokio::sync::oneshot;

use crate::scope::{Access, FileScope};

enum Pick {
    File,
    Folder,
    Save,
}

/// Show a file dialog and wait for the user's choice (None when cancelled).
async fn pick<R: Runtime>(
    builder: FileDialogBuilder<R>,
    kind: Pick,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = oneshot::channel();
    let done = move |picked: Option<FilePath>| {
        let _ = tx.send(picked);
    };
    match kind {
        Pick::File => builder.pick_file(done),
        Pick::Folder => builder.pick_folder(done),
        Pick::Save => builder.save_file(done),
    }
    let picked = rx.await.map_err(|_| "the dialog closed unexpectedly")?;
    picked
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}

fn to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// Choose an existing `.graft` project to open.
#[tauri::command]
pub async fn pick_project_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let builder = app
        .dialog()
        .file()
        .set_title("Open project")
        .add_filter("Graft project", &["graft"]);
    Ok(pick(builder, Pick::File).await?.map(to_string))
}

/// Choose an existing SQLite database file for a new project.
#[tauri::command]
pub async fn pick_sqlite_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let builder = app
        .dialog()
        .file()
        .set_title("Select SQLite database")
        .add_filter("SQLite", &["db", "sqlite", "sqlite3"]);
    Ok(pick(builder, Pick::File).await?.map(to_string))
}

/// Choose the directory a new project is created in.
#[tauri::command]
pub async fn pick_directory<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let builder = app.dialog().file().set_title("Choose a location");
    Ok(pick(builder, Pick::Folder).await?.map(to_string))
}

/// Choose a `.json` / `.sql` file to import; grants read access to it.
#[tauri::command]
pub async fn pick_import_file<R: Runtime>(
    app: AppHandle<R>,
    scope: State<'_, FileScope>,
) -> Result<Option<String>, String> {
    let builder = app
        .dialog()
        .file()
        .set_title("Import data")
        .add_filter("Data", &["json", "sql"]);
    let picked = pick(builder, Pick::File).await?;
    if let Some(path) = &picked {
        scope.grant(Access::Read, path);
    }
    Ok(picked.map(to_string))
}

/// Choose where to export a generated `.sql` script; grants write access to it.
#[tauri::command]
pub async fn pick_export_file<R: Runtime>(
    app: AppHandle<R>,
    scope: State<'_, FileScope>,
    default_name: String,
) -> Result<Option<String>, String> {
    let builder = app
        .dialog()
        .file()
        .set_title("Export INSERTs")
        .set_file_name(default_name)
        .add_filter("SQL", &["sql"]);
    let picked = pick(builder, Pick::Save).await?;
    if let Some(path) = &picked {
        scope.grant(Access::Write, path);
    }
    Ok(picked.map(to_string))
}

/// Native OK/Cancel confirmation. Resolves to true when the user confirmed.
#[tauri::command]
pub async fn confirm_dialog<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    message: String,
    ok_label: String,
) -> Result<bool, String> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(ok_label, "Cancel".into()))
        .show(move |ok| {
            let _ = tx.send(ok);
        });
    rx.await.map_err(|_| "the dialog closed unexpectedly".to_string())
}
