// Sponsoric desktop — Tauri command surface. Thin wrappers over `sponsoric`.
mod sponsoric;

use serde_json::Value;

#[tauri::command]
fn get_state() -> Value {
    sponsoric::state()
}

#[tauri::command]
fn get_levels() -> Value {
    sponsoric::levels_json()
}

#[tauri::command]
fn save_config(patch: Value) -> Result<Value, String> {
    sponsoric::save_config(patch)
}

#[tauri::command]
fn install_statusline(cli_path: Option<String>) -> Result<Value, String> {
    sponsoric::install(cli_path)
}

#[tauri::command]
fn uninstall_statusline() -> Result<Value, String> {
    sponsoric::uninstall()
}

#[tauri::command]
fn doctor() -> Value {
    sponsoric::doctor()
}

#[tauri::command]
async fn register() -> Result<Value, String> {
    sponsoric::register().await
}

#[tauri::command]
async fn get_earnings() -> Result<Value, String> {
    sponsoric::earnings().await
}

#[tauri::command]
async fn request_payout() -> Result<Value, String> {
    sponsoric::payout().await
}

#[tauri::command]
async fn connect_onboard() -> Result<Value, String> {
    sponsoric::connect_onboard().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_levels,
            save_config,
            install_statusline,
            uninstall_statusline,
            doctor,
            register,
            get_earnings,
            request_payout,
            connect_onboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
