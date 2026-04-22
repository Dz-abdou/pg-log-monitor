mod capture;
mod commands;
mod models;

use commands::{
    clear_captured_queries, fetch_captured_queries, get_capture_status, inspect_capture_source,
    start_capture, stop_capture, AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_capture,
            stop_capture,
            get_capture_status,
            inspect_capture_source,
            fetch_captured_queries,
            clear_captured_queries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
