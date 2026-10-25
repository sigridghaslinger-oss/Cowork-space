import { googleGet } from "./auth";

export type CalendarEvent = {
  id: string;
  calendar: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
};

type CalendarList = { items: { id: string; summary: string; selected?: boolean }[] };
type EventTime = { dateTime?: string; date?: string };
type EventList = {
  items: { id: string; summary?: string; location?: string; start: EventTime; end: EventTime; status?: string }[];
};

function parseTime(t: EventTime): Date {
  // Ganztägige Termine haben nur ein Datum ohne Uhrzeit; als lokale Mitternacht lesen.
  return t.dateTime ? new Date(t.dateTime) : new Date(`${t.date}T00:00:00`);
}

// Termine aller eingeblendeten Kalender (z. B. auch ein eigener Stundenplan-Kalender) für einen Tag.
export async function getEventsForDay(day: Date): Promise<CalendarEvent[]> {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const calendars = await googleGet<CalendarList>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
  );
  const visible = calendars.items.filter((c) => c.selected !== false);

  const perCalendar = await Promise.all(
    visible.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
      });
      const events = await googleGet<EventList>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      );
      return events.items
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({
          id: e.id,
          calendar: cal.summary,
          title: e.summary ?? "(ohne Titel)",
          start: parseTime(e.start),
          end: parseTime(e.end),
          allDay: !e.start.dateTime,
          location: e.location,
        }));
    }),
  );

  return perCalendar.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
}
