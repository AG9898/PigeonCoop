mod commands;
mod bridge;

use std::sync::Mutex;

use commands::AppState;
use persistence::sqlite::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("agent-arcade.db");
            let db = Db::open(db_path)?;
            app.manage(AppState { db: Mutex::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_workflow,
            commands::get_workflow,
            commands::list_workflows,
            commands::update_workflow,
            commands::delete_workflow,
            commands::import_workflow,
            commands::export_workflow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running agent arcade");
}
