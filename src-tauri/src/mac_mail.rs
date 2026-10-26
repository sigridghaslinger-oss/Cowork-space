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

// Überblick über den Posteingang fürs Aufräumen: die neuesten Mails mit Status, ohne Inhalt.
// Eigenschaften werden gesammelt abgefragt (eine Anfrage pro Eigenschaft statt pro Mail),
// sonst dauert ein volles Postfach Minuten.
const OVERVIEW_SCRIPT: &str = r#"
const Mail = Application('Mail');
function collect(coll) {
  const ids = coll.id();
  const senders = coll.sender(), subjects = coll.subject(), dates = coll.dateReceived();
  const read = coll.readStatus(), replied = coll.wasRepliedTo(), flagged = coll.flaggedStatus();
  return ids.map((id, i) => ({
    id: String(id),
    sender: senders[i] || '',
    subject: subjects[i] || '',
    date: dates[i] ? dates[i].getTime() : 0,
    read: !!read[i],
    replied: !!replied[i],
    flagged: !!flagged[i],
  }));
}
let all;
try {
  all = collect(Mail.inbox.messages);
} catch (e) {
  // Manche Mail-Versionen erlauben das nur pro Konto-Posteingang.
  all = [];
  for (const box of Mail.inbox.mailboxes()) all = all.concat(collect(box.messages));
}
all.sort((a, b) => b.date - a.date);
JSON.stringify({ total: all.length, unread: all.filter((m) => !m.read).length, mails: all.slice(0, MAX_MAILS) });
"#;

// Gemeinsamer Anfang für Aktionen auf mehreren Mails: findet jede Mail im Posteingang.
// Von hinten nach vorne, damit sich die Positionen der noch offenen Mails nicht verschieben.
const FIND_MAILS: &str = r#"
const Mail = Application('Mail');
const wanted = new Set(MAIL_IDS.map(String));
const box = Mail.inbox.messages;
let found = [];
try {
  const ids = box.id();
  for (let i = ids.length - 1; i >= 0; i--) if (wanted.has(String(ids[i]))) found.push({ m: box[i], id: ids[i] });
} catch (e) {
  found = MAIL_IDS.map((id) => ({ m: box.whose({ id })()[0], id })).filter((f) => f.m);
}
// Sicherheitsprüfung: falls sich der Posteingang inzwischen geändert hat, nach ID suchen.
found = found.map((f) => {
  try { if (f.m.id() === f.id) return f.m; } catch (e) {}
  return box.whose({ id: f.id })()[0];
}).filter(Boolean);
"#;

const MARK_READ_SCRIPT: &str = r#"
for (const m of found) m.readStatus = true;
JSON.stringify(found.length);
"#;

const FLAG_SCRIPT: &str = r#"
for (const m of found) m.flaggedStatus = FLAGGED;
JSON.stringify(found.length);
"#;

// Verschiebt in den Archiv-Ordner des jeweiligen Kontos. Gelöscht wird nichts.
// Hat ein Konto keinen Archiv-Ordner, bleibt die Mail liegen und wird mitgezählt.
const ARCHIVE_SCRIPT: &str = r#"
const ARCHIVE_NAMES = ['archive', 'archiv', 'archives', 'alle nachrichten', 'all mail'];
const targets = {};
function archiveOf(account) {
  const key = account.name();
  if (!(key in targets)) {
    targets[key] = account.mailboxes().find((b) => {
      const name = b.name().split('/').pop().toLowerCase();
      return ARCHIVE_NAMES.includes(name);
    }) || null;
  }
  return targets[key];
}
let moved = 0, skipped = 0;
for (const m of found) {
  const target = archiveOf(m.mailbox().account());
  if (!target) { skipped++; continue; }
  try { Mail.move(m, { to: target }); moved++; }
  catch (e) {
    try { m.mailbox = target; moved++; } catch (e2) { skipped++; }
  }
}
JSON.stringify({ moved, skipped });
"#;

// Sucht in den Kopfzeilen nach dem Abmelde-Link, den seriöse Newsletter mitschicken.
const UNSUBSCRIBE_SCRIPT: &str = r#"
const Mail = Application('Mail');
const m = Mail.inbox.messages.whose({ id: MAIL_ID })()[0];
let link = null;
if (m) {
  const headers = (m.allHeaders() || '').replace(/\r?\n[ \t]+/g, ' ');
  const line = headers.split(/\r?\n/).find((l) => /^list-unsubscribe:/i.test(l));
  if (line) {
    const links = [...line.matchAll(/<([^>]+)>/g)].map((x) => x[1]);
    link = links.find((l) => l.startsWith('https://')) || links.find((l) => l.startsWith('mailto:')) || null;
  }
}
JSON.stringify(link);
"#;

#[derive(Serialize, Deserialize)]
pub struct InboxMail {
    id: String,
    sender: String,
    subject: String,
    date: f64,
    read: bool,
    replied: bool,
    flagged: bool,
}

#[derive(Serialize, Deserialize)]
pub struct InboxOverview {
    total: u32,
    unread: u32,
    mails: Vec<InboxMail>,
}

#[derive(Serialize, Deserialize)]
pub struct ArchiveResult {
    moved: u32,
    skipped: u32,
}

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

pub fn inbox_overview(max: u32) -> Result<InboxOverview, String> {
    run_jxa(&OVERVIEW_SCRIPT.replace("MAX_MAILS", &max.to_string()))
}

fn with_mails(ids: &[String], action: &str) -> Result<String, String> {
    let ids = ids.iter().map(|id| parse_id(id)).collect::<Result<Vec<_>, _>>()?;
    let list = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    Ok(format!("{}{}", FIND_MAILS.replace("MAIL_IDS", &list), action))
}

pub fn mark_read(ids: &[String]) -> Result<u32, String> {
    run_jxa(&with_mails(ids, MARK_READ_SCRIPT)?)
}

pub fn set_flag(ids: &[String], flagged: bool) -> Result<u32, String> {
    run_jxa(&with_mails(ids, &FLAG_SCRIPT.replace("FLAGGED", &flagged.to_string()))?)
}

pub fn archive(ids: &[String]) -> Result<ArchiveResult, String> {
    run_jxa(&with_mails(ids, ARCHIVE_SCRIPT)?)
}

pub fn unsubscribe_link(id: &str) -> Result<Option<String>, String> {
    run_jxa(&UNSUBSCRIBE_SCRIPT.replace("MAIL_ID", &parse_id(id)?.to_string()))
}
