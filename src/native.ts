/**
 * Native dialogs, served by the backend (`src-tauri/src/dialogs.rs`).
 *
 * The webview has no direct access to the dialog plugin: going through these
 * commands lets the backend fix the filters and grant file access only to the
 * paths the user actually picked (import/export files). Every picker resolves
 * to `null` when the user cancels.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const pickProjectFile = () => invoke<string | null>("pick_project_file");

export const pickSqliteFile = () => invoke<string | null>("pick_sqlite_file");

export const pickDirectory = () => invoke<string | null>("pick_directory");

/** `.json` / `.sql` to import — the backend grants read access to it. */
export const pickImportFile = () => invoke<string | null>("pick_import_file");

/** Destination of a `.sql` export — the backend grants write access to it. */
export const pickExportFile = (defaultName: string) =>
  invoke<string | null>("pick_export_file", { defaultName });

/** Native OK/Cancel confirmation; resolves to true when confirmed. */
export const confirmDialog = (title: string, message: string, okLabel: string) =>
  invoke<boolean>("confirm_dialog", { title, message, okLabel });

/** Mirror the "unsaved changes" state so the backend can guard window
 *  close / app quit. */
export const setUnsavedChanges = (dirty: boolean) =>
  invoke<void>("set_unsaved_changes", { dirty });

/** Watch the open project's `.graft` file for changes made outside the app
 *  (e.g. by Claude through `graft-mcp`). Replaces any previous watch. */
export const watchProject = (path: string) => invoke<void>("watch_project", { path });

/** Called with the project path whenever the watched file changed on disk.
 *  The app's own saves never trigger it. */
export const onProjectFileChanged = (
  cb: (path: string) => void,
): Promise<UnlistenFn> =>
  listen<{ path: string }>("project-file-changed", (e) => cb(e.payload.path));
