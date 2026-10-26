// Liest und schreibt Erinnerungen der Erinnerungen-App (alle Listen, auch iCloud)
// per JavaScript for Automation. macOS fragt beim ersten Mal nach Erlaubnis.
use std::process::Command;

use serde::{Deserialize, Serialize};

// Offene Erinnerungen aller Listen; Eigenschaften gesammelt pro Liste abgefragt, damit es schnell geht.
const OPEN_SCRIPT: &str = r#"
const R = Application('Reminders');
const out = [];
for (const list of R.lists()) {
  const items = list.reminders.whose({ completed: false });
  const ids = items.id();
  if (!ids.length) continue;
  const names = items.name(), due = items.dueDate(), notes = items.body();
  const listName = list.name();
  ids.forEach((id, i) => out.push({
    id: String(id),
    title: names[i] || '',
    list: listName,
    due: due[i] ? due[i].getTime() : null,
    notes: notes[i] || '',
  }));
}
JSON.stringify(out);
"#;

const COMPLETE_SCRIPT: &str = r#"
const R = Application('Reminders');
R.reminders.byId(REMINDER_ID).completed = true;
JSON.stringify(true);
"#;

// Legt eine Erinnerung in der Standardliste an. Bei einer Mail kommt ein Link dazu,
// der die Mail in Apple Mail öffnet.
const CREATE_SCRIPT: &str = r#"
const A = ARGS;
const R = Application('Reminders');
let body = A.notes;
if (A.mailId) {
  try {
    const m = Application('Mail').inbox.messages.whose({ id: A.mailId })()[0];
    if (m) body += (body ? '\n' : '') + 'message://%3C' + encodeURIComponent(m.messageId()) + '%3E';
  } catch (e) {}
}
const props = { name: A.title, body };
if (A.due) props.dueDate = new Date(A.due);
R.defaultList().reminders.push(R.Reminder(props));
JSON.stringify(true);
"#;

#[derive(Serialize, Deserialize)]
pub struct MacReminder {
    id: String,
    title: String,
    list: String,
    due: Option<f64>,
    notes: String,
}

fn run_jxa<T: for<'de> Deserialize<'de>>(script: &str) -> Result<T, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .map_err(|e| format!("Erinnerungen-App konnte nicht abgefragt werden: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        // -1743: Der Nutzer hat die Steuerung der App nicht erlaubt.
        if err.contains("-1743") {
            return Err("Cowork Space darf die Erinnerungen-App nicht verwenden. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Automation → Cowork Space → Erinnerungen.".into());
        }
        return Err(format!("Fehler in der Erinnerungen-App: {}", err.trim()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| format!("Unerwartete Antwort der Erinnerungen-App: {e}"))
}

// Als JSON eingesetzt sind Texte gültige, sicher maskierte JS-Literale.
fn literal(text: &str) -> Result<String, String> {
    serde_json::to_string(text).map_err(|e| e.to_string())
}

pub fn open_reminders() -> Result<Vec<MacReminder>, String> {
    run_jxa(OPEN_SCRIPT)
}

pub fn complete(id: &str) -> Result<bool, String> {
    run_jxa(&COMPLETE_SCRIPT.replace("REMINDER_ID", &literal(id)?))
}

pub fn create(title: &str, notes: &str, due_ms: Option<f64>, mail_id: Option<&str>) -> Result<bool, String> {
    let mail_id = mail_id
        .map(|id| id.parse::<u64>().map_err(|_| "Ungültige Mail-ID".to_string()))
        .transpose()?;
    // Alles in einem JSON-Objekt, damit kein Text einen Platzhalter eines anderen trifft.
    let args = serde_json::json!({ "title": title, "notes": notes, "due": due_ms, "mailId": mail_id });
    run_jxa(&CREATE_SCRIPT.replace("ARGS", &args.to_string()))
}
