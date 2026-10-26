#[cfg(target_os = "macos")]
mod mac_calendar;
#[cfg(target_os = "macos")]
mod mac_mail;

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_events_for_day(day_start_ms: f64) -> Result<Vec<mac_calendar::MacEvent>, String> {
    // EventKit blockiert, deshalb nicht auf dem Haupt-Thread ausführen.
    tauri::async_runtime::spawn_blocking(move || mac_calendar::events_for_day(day_start_ms))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_unread_mails(max: u32) -> Result<Vec<mac_mail::MacMail>, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::recent_unread(max))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_oauth::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![mac_events_for_day, mac_unread_mails]);

    builder
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Cowork Space");
}
