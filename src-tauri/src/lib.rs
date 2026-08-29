mod commands;
mod db;
mod models;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
    pub db_path: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data directory");
            std::fs::create_dir_all(&dir).expect("failed to create app data directory");
            let db_path = dir.join("godown.db");
            let conn = db::open(&db_path).expect("failed to open database");
            app.manage(AppState {
                conn: Mutex::new(conn),
                db_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_data,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::create_item,
            commands::update_item,
            commands::set_item_archived,
            commands::delete_item,
            commands::add_movements,
            commands::delete_movement,
            commands::backup_database,
            commands::restore_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
