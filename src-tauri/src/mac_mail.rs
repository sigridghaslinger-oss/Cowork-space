// Liest ungelesene Mails aus der Mail-App (alle dort eingerichteten Konten)
// per JavaScript for Automation. macOS fragt beim ersten Mal nach Erlaubnis.
use std::process::Command;

use serde::{Deserialize, Serialize};

const SCRIPT: &str = r#"
const Mail = Application('Mail');
const msgs = Mail.inbox.messages.whose({ readStatus: false })();
const dated = msgs.map((m) => ({ m, d: m.dateReceived() }));
dated.sort((a, b) => b.d - a.d);
JSON.stringify(dated.slice(0, MAX_MAILS).map(({ m, d }) => ({
  id: String(m.id()),
  from: m.sender(),
  subject: m.subject() || '',
  date: d.getTime(),
  snippet: (m.content() || '').replace(/\s+/g, ' ').trim().slice(0, 300),
})));
"#;

#[derive(Serialize, Deserialize)]
pub struct MacMail {
    id: String,
    from: String,
    subject: String,
    date: f64,
    snippet: String,
}

pub fn recent_unread(max: u32) -> Result<Vec<MacMail>, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", &SCRIPT.replace("MAX_MAILS", &max.to_string())])
        .output()
        .map_err(|e| format!("Mail-App konnte nicht abgefragt werden: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        // -1743: Der Nutzer hat die Steuerung der Mail-App nicht erlaubt.
        if err.contains("-1743") {
            return Err("Cowork Space darf die Mail-App nicht lesen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Automation → Cowork Space → Mail.".into());
        }
        return Err(format!("Fehler beim Lesen der Mails: {}", err.trim()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| format!("Unerwartete Antwort der Mail-App: {e}"))
}
