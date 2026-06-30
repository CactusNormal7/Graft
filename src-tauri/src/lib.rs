mod db;
mod notebook;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db::execute_sql,
            db::introspect_schema,
            notebook::save_notebook,
            notebook::load_notebook,
            notebook::path_exists,
            notebook::default_project_dir,
            notebook::create_project_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
