// Cogwait desktop — Tauri command surface. Thin wrappers over `cogwait`.
mod cogwait;

use serde_json::Value;

#[tauri::command]
fn get_state() -> Value {
    cogwait::state()
}

#[tauri::command]
fn get_levels() -> Value {
    cogwait::levels_json()
}

#[tauri::command]
fn save_config(patch: Value) -> Result<Value, String> {
    cogwait::save_config(patch)
}

#[tauri::command]
fn install_statusline(cli_path: Option<String>) -> Result<Value, String> {
    cogwait::install(cli_path)
}

#[tauri::command]
fn uninstall_statusline() -> Result<Value, String> {
    cogwait::uninstall()
}

#[tauri::command]
fn doctor() -> Value {
    cogwait::doctor()
}

#[tauri::command]
async fn register() -> Result<Value, String> {
    cogwait::register().await
}

#[tauri::command]
async fn get_earnings() -> Result<Value, String> {
    cogwait::earnings().await
}

#[tauri::command]
async fn request_payout() -> Result<Value, String> {
    cogwait::payout().await
}

#[tauri::command]
async fn connect_onboard() -> Result<Value, String> {
    cogwait::connect_onboard().await
}

#[tauri::command]
async fn ad_preview() -> Result<Value, String> {
    cogwait::ad_preview().await
}

#[tauri::command]
async fn get_oss_config() -> Result<Value, String> {
    cogwait::oss_config().await
}

#[tauri::command]
async fn set_donate_pct(pct: f64) -> Result<Value, String> {
    cogwait::set_donate_pct(pct).await
}

#[tauri::command]
async fn run_oss_scan() -> Result<Value, String> {
    cogwait::run_oss_scan().await
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
            connect_onboard,
            ad_preview,
            get_oss_config,
            set_donate_pct,
            run_oss_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
