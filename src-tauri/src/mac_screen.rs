// Fotografiert das Fenster einer anderen App (z. B. die Web-App „Mein Schulplan“)
// mit dem Bildschirmfoto-Werkzeug von macOS. Gelesen wird nur, gesteuert nichts.
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

// Sucht das größte sichtbare Fenster, dessen App-Name APP_NAME enthält.
// Ist keines sichtbar, wird die App einmal nach vorne geholt.
const FIND_SCRIPT: &str = r#"
ObjC.import('CoreGraphics');
function find() {
  // 1 = nur sichtbare Fenster, 16 = ohne Schreibtisch; 0 = alle Fenster
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  const wins = list.filter((w) =>
    w.kCGWindowLayer === 0 &&
    String(w.kCGWindowOwnerName || '').toLowerCase().includes(APP_NAME.toLowerCase()) &&
    w.kCGWindowBounds && w.kCGWindowBounds.Width > 200 && w.kCGWindowBounds.Height > 200);
  wins.sort((a, b) => b.kCGWindowBounds.Width * b.kCGWindowBounds.Height - a.kCGWindowBounds.Width * a.kCGWindowBounds.Height);
  return wins.length ? wins[0].kCGWindowNumber : 0;
}
let id = find();
if (!id) {
  try {
    const se = Application('System Events');
    const procs = se.processes.whose({ name: { _contains: APP_NAME } })();
    if (procs.length) { procs[0].frontmost = true; delay(1); id = find(); }
  } catch (e) {}
}
JSON.stringify(id);
"#;

fn find_window(app_name: &str) -> Result<u64, String> {
    let literal = serde_json::to_string(app_name).map_err(|e| e.to_string())?;
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", &FIND_SCRIPT.replace("APP_NAME", &literal)])
        .output()
        .map_err(|e| format!("Fenster konnte nicht gesucht werden: {e}"))?;
    if !output.status.success() {
        return Err(format!("Fenster konnte nicht gesucht werden: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Unerwartete Antwort bei der Fenstersuche: {e}"))
}

/// Gibt das Bildschirmfoto des Fensters als PNG in Base64 zurück.
pub fn capture_app_window(app_name: &str) -> Result<String, String> {
    let id = find_window(app_name)?;
    if id == 0 {
        return Err(format!(
            "Kein Fenster von „{app_name}“ gefunden. Öffne die App, lass das Fenster sichtbar (nicht im Dock) und versuch es nochmal."
        ));
    }

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = std::env::temp_dir().join(format!("cowork-fenster-{stamp}.png"));
    // -x ohne Ton, -o ohne Schatten, -l nur dieses Fenster
    let output = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", "-l", &id.to_string()])
        .arg(&path)
        .output()
        .map_err(|e| format!("Bildschirmfoto fehlgeschlagen: {e}"))?;
    let bytes = std::fs::read(&path);
    let _ = std::fs::remove_file(&path);
    let bytes = match bytes {
        Ok(b) if output.status.success() && !b.is_empty() => b,
        _ => {
            return Err("Bildschirmfoto fehlgeschlagen. Erlaube Cowork Space die Bildschirmaufnahme unter Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme und starte die App neu.".into())
        }
    };
    Ok(base64(&bytes))
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
