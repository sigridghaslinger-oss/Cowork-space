mod downloads;
#[cfg(target_os = "macos")]
mod mac_calendar;
#[cfg(target_os = "macos")]
mod mac_mail;
#[cfg(target_os = "macos")]
mod mac_screen;

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

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_mail_content(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::content(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_open_reply(id: String, text: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::open_reply(&id, &text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_inbox_overview(max: u32) -> Result<mac_mail::InboxOverview, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::inbox_overview(max))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_mark_read(ids: Vec<String>) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::mark_read(&ids))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_set_flag(ids: Vec<String>, flagged: bool) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::set_flag(&ids, flagged))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_archive(ids: Vec<String>) -> Result<mac_mail::ArchiveResult, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::archive(&ids))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_delete(ids: Vec<String>) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::delete(&ids))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_unsubscribe_link(id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || mac_mail::unsubscribe_link(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn mac_capture_window(app_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mac_screen::capture_app_window(&app_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_download(app: tauri::AppHandle, filename: String, data: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || downloads::save(&app, &filename, &data))
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
    let builder = builder.invoke_handler(tauri::generate_handler![
        save_download,
        mac_events_for_day,
        mac_unread_mails,
        mac_mail_content,
        mac_open_reply,
        mac_inbox_overview,
        mac_mark_read,
        mac_set_flag,
        mac_archive,
        mac_delete,
        mac_unsubscribe_link,
        mac_capture_window
    ]);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![save_download]);

    builder
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Cowork Space");
}
