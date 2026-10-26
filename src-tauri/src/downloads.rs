// Speichert Dateien aus dem Planbuch (Ausdrucke, CSV, Sicherungen) im Ordner „Downloads“.
use std::path::PathBuf;

use tauri::Manager;

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    if trimmed.is_empty() { "Datei".into() } else { trimmed.into() }
}

fn free_path(dir: PathBuf, name: &str) -> PathBuf {
    let path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Gibt den Pfad der gespeicherten Datei zurück. Ausdrucke (.html) werden gleich geöffnet,
/// alle anderen Dateien im Finder gezeigt.
pub fn save(app: &tauri::AppHandle, filename: &str, data: &str) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| format!("Ordner „Downloads“ nicht gefunden: {e}"))?;
    let path = free_path(dir, &safe_name(filename));
    std::fs::write(&path, data).map_err(|e| format!("Datei konnte nicht gespeichert werden: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("/usr/bin/open");
        if path.extension().is_some_and(|e| e == "html") {
            cmd.arg(&path);
        } else {
            cmd.arg("-R").arg(&path);
        }
        let _ = cmd.spawn();
    }
    Ok(path.to_string_lossy().into_owned())
}
