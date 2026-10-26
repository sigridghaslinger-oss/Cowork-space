// Liest ungelesene Mails aus der Mail-App (alle dort eingerichteten Konten)
// per JavaScript for Automation. macOS fragt beim ersten Mal nach Erlaubnis.
use std::process::Command;

use serde::{Deserialize, Serialize};

const UNREAD_SCRIPT: &str = r#"
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

const CONTENT_SCRIPT: &str = r#"
const Mail = Application('Mail');
const m = Mail.inbox.messages.whose({ id: MAIL_ID })()[0];
JSON.stringify(m ? (m.content() || '').slice(0, 8000) : '');
"#;

// Öffnet ein Antwortfenster in Mail und setzt den Entwurf ein. Verschickt wird nichts.
const REPLY_SCRIPT: &str = r#"
const Mail = Application('Mail');
const m = Mail.inbox.messages.whose({ id: MAIL_ID })()[0];
if (!m) throw new Error('Mail nicht gefunden');
const reply = m.reply({ openingWindow: true });
let inserted = true;
try { reply.content = REPLY_TEXT; } catch (e) { inserted = false; }
Mail.activate();
JSON.stringify(inserted);
"#;

#[derive(Serialize, Deserialize)]
pub struct MacMail {
    id: String,
    from: String,
    subject: String,
    date: f64,
    snippet: String,
}

fn run_jxa<T: for<'de> Deserialize<'de>>(script: &str) -> Result<T, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .map_err(|e| format!("Mail-App konnte nicht abgefragt werden: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        // -1743: Der Nutzer hat die Steuerung der Mail-App nicht erlaubt.
        if err.contains("-1743") {
            return Err("Cowork Space darf die Mail-App nicht lesen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Automation → Cowork Space → Mail.".into());
        }
        return Err(format!("Fehler in der Mail-App: {}", err.trim()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| format!("Unerwartete Antwort der Mail-App: {e}"))
}

fn parse_id(id: &str) -> Result<u64, String> {
    id.parse().map_err(|_| "Ungültige Mail-ID".to_string())
}

pub fn recent_unread(max: u32) -> Result<Vec<MacMail>, String> {
    run_jxa(&UNREAD_SCRIPT.replace("MAX_MAILS", &max.to_string()))
}

pub fn content(id: &str) -> Result<String, String> {
    run_jxa(&CONTENT_SCRIPT.replace("MAIL_ID", &parse_id(id)?.to_string()))
}

/// Gibt zurück, ob der Text in das Antwortfenster eingesetzt werden konnte.
pub fn open_reply(id: &str, text: &str) -> Result<bool, String> {
    // Als JSON-String eingesetzt ist der Text ein gültiges, sicher maskiertes JS-Literal.
    let literal = serde_json::to_string(text).map_err(|e| e.to_string())?;
    run_jxa(
        &REPLY_SCRIPT
            .replace("MAIL_ID", &parse_id(id)?.to_string())
            .replace("REPLY_TEXT", &literal),
    )
}
