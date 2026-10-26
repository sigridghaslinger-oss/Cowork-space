import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent } from "./google/calendar";
import type { MailSummary } from "./google/gmail";

type RawEvent = Omit<CalendarEvent, "start" | "end"> & { start: number; end: number };
type RawMail = Omit<MailSummary, "date"> & { date: number };

// Termine aus der Kalender-App des Macs (alle dort eingerichteten Konten).
export async function getMacEventsForDay(day: Date): Promise<CalendarEvent[]> {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const raw = await invoke<RawEvent[]>("mac_events_for_day", { dayStartMs: dayStart.getTime() });
  return raw.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
}

// Ungelesene Mails aus der Mail-App des Macs.
export async function getMacUnreadMails(max = 15): Promise<MailSummary[]> {
  const raw = await invoke<RawMail[]>("mac_unread_mails", { max });
  return raw.map((m) => ({ ...m, from: m.from.replace(/\s*<.*>$/, "").replace(/"/g, ""), date: new Date(m.date) }));
}

export async function getMacMailContent(id: string): Promise<string> {
  return invoke<string>("mac_mail_content", { id });
}

// Öffnet ein Antwortfenster in Apple Mail. Gibt false zurück, wenn der Text nicht eingesetzt werden konnte.
export async function openMacReply(id: string, text: string): Promise<boolean> {
  return invoke<boolean>("mac_open_reply", { id, text });
}

// Bildschirmfoto vom Fenster einer anderen App (PNG, Base64), z. B. „Mein Schulplan“.
export async function captureMacWindow(appName: string): Promise<string> {
  return invoke<string>("mac_capture_window", { appName });
}

// Posteingang fürs Aufräumen: neueste Mails mit Status (gelesen, beantwortet, Fähnchen), ohne Inhalt.
export type InboxMail = {
  id: string;
  from: string;
  address: string;
  subject: string;
  date: Date;
  read: boolean;
  replied: boolean;
  flagged: boolean;
};
export type InboxOverview = { total: number; unread: number; mails: InboxMail[] };

type RawInboxMail = Omit<InboxMail, "from" | "address" | "date"> & { sender: string; date: number };

export async function getMacInbox(max = 1500): Promise<InboxOverview> {
  const raw = await invoke<{ total: number; unread: number; mails: RawInboxMail[] }>("mac_inbox_overview", { max });
  return {
    ...raw,
    mails: raw.mails.map(({ sender, date, ...m }) => {
      const address = (sender.match(/<([^>]+)>/)?.[1] ?? sender).trim().toLowerCase();
      const from = sender.replace(/\s*<.*>$/, "").replace(/"/g, "").trim() || address;
      return { ...m, from, address, date: new Date(date) };
    }),
  };
}

// Die folgenden Aktionen ändern Mails in Apple Mail. Sie werden nur nach Sigrids Bestätigung aufgerufen.
export async function markMacRead(ids: string[]): Promise<number> {
  return invoke<number>("mac_mark_read", { ids });
}

export async function setMacFlag(ids: string[], flagged: boolean): Promise<number> {
  return invoke<number>("mac_set_flag", { ids, flagged });
}

// Verschiebt ins Archiv des jeweiligen Kontos; skipped = Konten ohne Archiv-Ordner.
export async function archiveMac(ids: string[]): Promise<{ moved: number; skipped: number }> {
  return invoke("mac_archive", { ids });
}

// Verschiebt in den Papierkorb des Kontos (wie die Löschen-Taste in Apple Mail).
export async function deleteMac(ids: string[]): Promise<number> {
  return invoke<number>("mac_delete", { ids });
}

export async function getMacUnsubscribeLink(id: string): Promise<string | null> {
  return invoke<string | null>("mac_unsubscribe_link", { id });
}
