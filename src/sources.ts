import { getSetting, setSetting } from "./settings";
import { isGoogleConnected } from "./google/auth";
import { getEventsForDay, type CalendarEvent } from "./google/calendar";
import { getRecentUnread, type MailSummary } from "./google/gmail";
import { getMacEventsForDay, getMacMailContent, getMacUnreadMails } from "./mac";

// Woher Termine und Mails kommen: direkt vom Mac (Standard) oder über Google.
export type Source = "mac" | "google";

export async function getSource(): Promise<Source> {
  return (await getSetting<Source>("source")) ?? "mac";
}

export async function setSource(source: Source): Promise<void> {
  await setSetting("source", source);
}

export async function isSourceReady(source: Source): Promise<boolean> {
  return source === "mac" || (await isGoogleConnected());
}

export type TodayData = { events: CalendarEvent[]; mails: MailSummary[]; warnings: string[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadToday(source: Source): Promise<TodayData> {
  const today = new Date();
  // Kalender und Mail getrennt laden, damit ein fehlender Zugriff nicht beides blockiert.
  const [events, mails] = await Promise.allSettled([
    source === "mac" ? getMacEventsForDay(today) : getEventsForDay(today),
    source === "mac" ? getMacUnreadMails() : getRecentUnread(),
  ]);
  const warnings: string[] = [];
  if (events.status === "rejected") warnings.push(message(events.reason));
  if (mails.status === "rejected") warnings.push(message(mails.reason));
  return {
    events: events.status === "fulfilled" ? events.value : [],
    mails: mails.status === "fulfilled" ? mails.value : [],
    warnings,
  };
}

export async function loadMails(source: Source, max = 25): Promise<MailSummary[]> {
  return source === "mac" ? getMacUnreadMails(max) : getRecentUnread(max);
}

// Voller Text für Antwortentwürfe; über Google reicht vorerst der Textauszug.
export async function loadMailContent(source: Source, mail: MailSummary): Promise<string> {
  if (source === "google") return mail.snippet;
  return (await getMacMailContent(mail.id)) || mail.snippet;
}
