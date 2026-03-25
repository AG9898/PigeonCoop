mod commands;
mod bridge;

use commands::AppState;
use persistence::sqlite::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("agent-arcade.db");
            let db = Db::open(db_path)?;
            app.manage(AppState::new(db));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Workflow CRUD (TAURI-001)
            commands::create_workflow,
            commands::get_workflow,
            commands::list_workflows,
            commands::update_workflow,
            commands::delete_workflow,
            commands::import_workflow,
            commands::export_workflow,
            // Run lifecycle (TAURI-002)
            commands::create_run,
            commands::start_run,
            commands::cancel_run,
            commands::get_run,
            commands::list_runs_for_workflow,
            // Human review (TAURI-003)
            commands::submit_human_review_decision,
            // Event log / replay (UI-RPL-001)
            commands::list_events_for_run,
            // Workflow validation (UI-BLD-005)
            commands::validate_workflow,
            // Settings and workspace (TAURI-005)
            commands::get_settings,
            commands::set_setting,
            commands::open_workspace_picker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running agent arcade");
}
