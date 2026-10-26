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
