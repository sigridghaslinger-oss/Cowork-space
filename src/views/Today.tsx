import { useEffect, useState, type ReactNode } from "react";
import type { CalendarEvent } from "../google/calendar";
import type { MailSummary } from "../google/gmail";
import { getSource, isSourceReady, loadEventsForDay, loadToday, type Source } from "../sources";
import { streamDayPlan } from "../claude";
import { getApiKey } from "../settings";
import { completeMacReminder, type Reminder } from "../mac";
import Markdown from "./Markdown";
import MailBody from "./MailBody";

const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (d: Date) => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

const startOfDay = (offset = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

// Die Tage der aktuellen Woche (Montag bis Sonntag); ab Samstag schon die nächste Woche.
function weekDays(): Date[] {
  const today = startOfDay();
  const weekday = (today.getDay() + 6) % 7; // Montag = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - weekday + (weekday >= 5 ? 7 : 0));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// Fällig heute oder schon überfällig, das Älteste zuerst.
const dueToday = (reminders: Reminder[]) =>
  reminders
    .filter((r) => r.due && r.due <= endOfToday())
    .sort((a, b) => a.due!.getTime() - b.due!.getTime());

function dueLabel(due: Date): string {
  if (due < startOfDay()) return `überfällig seit ${due.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`;
  return due.getHours() || due.getMinutes() ? `heute ${time(due)}` : "heute";
}

function describe(events: CalendarEvent[], mails: MailSummary[], reminders: Reminder[]): string {
  const ev = events.length
    ? events
        .map((e) => `- ${e.allDay ? "ganztägig" : `${time(e.start)}–${time(e.end)}`}: ${e.title} [${e.calendar}]${e.location ? ` (${e.location})` : ""}`)
        .join("\n")
    : "- keine Termine";
  const ml = mails.length
    ? mails.map((m) => `- Von ${m.from}: „${m.subject}“ – ${m.snippet}`).join("\n")
    : "- keine ungelesenen Mails";
  const due = dueToday(reminders);
  const rm = due.length ? due.map((r) => `- ${r.title} (${dueLabel(r.due!)}, Liste ${r.list})`).join("\n") : "- keine";
  return `Termine:\n${ev}\n\nFällige Erinnerungen:\n${rm}\n\nUngelesene Mails:\n${ml}`;
}

function EventList({ events, empty }: { events: CalendarEvent[]; empty: string }) {
  if (events.length === 0) return <p>{empty}</p>;
  return (
    <ul className="list events">
      {events.map((e) => (
        <li key={`${e.calendar}-${e.id}`}>
          <span className="event-time">{e.allDay ? "ganztägig" : `${time(e.start)}–${time(e.end)}`}</span>
          <div>
            {e.title}
            <span className="meta">{e.calendar}{e.location ? ` · ${e.location}` : ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

type TileId = "tomorrow" | "week" | "reminders" | "mails" | "plan";
const TILE_KEY = "today-tile";

function savedTile(): TileId | null {
  try {
    return (localStorage.getItem(TILE_KEY) as TileId) || null;
  } catch {
    return null;
  }
}

export default function Today() {
  const [source, setSource] = useState<Source>("mac");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tomorrow, setTomorrow] = useState<CalendarEvent[]>([]);
  const [week, setWeek] = useState<{ day: Date; events: CalendarEvent[] }[]>([]);
  const [mails, setMails] = useState<MailSummary[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [planning, setPlanning] = useState(false);
  const [tile, setTile] = useState<TileId | null>(savedTile);

  function toggleTile(id: TileId) {
    const next = tile === id ? null : id;
    setTile(next);
    try {
      localStorage.setItem(TILE_KEY, next ?? "");
    } catch {
      // Ohne Speicher startet die Seite eben mit allen Kacheln zu.
    }
  }

  async function refresh(from: Source = source) {
    setLoading(true);
    setError(null);
    try {
      const days = weekDays();
      const [data, nextDay, weekEvents] = await Promise.all([
        loadToday(from),
        loadEventsForDay(from, startOfDay(1)).catch(() => []),
        Promise.all(days.map((d) => loadEventsForDay(from, d).catch(() => []))),
      ]);
      setEvents(data.events);
      setMails(data.mails);
      setReminders(data.reminders);
      setTomorrow(nextDay);
      setWeek(days.map((day, i) => ({ day, events: weekEvents[i] })));
      if (data.warnings.length) setError(data.warnings.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getSource().then(async (src) => {
      setSource(src);
      const ok = await isSourceReady(src);
      setConnected(ok);
      if (ok) refresh(src);
    });
  }, []);

  async function makePlan() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setPlan("");
    setPlanning(true);
    setError(null);
    try {
      await streamDayPlan(apiKey, describe(events, mails, reminders), (d) => setPlan((p) => p + d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  async function complete(r: Reminder) {
    try {
      await completeMacReminder(r.id);
      setReminders((list) => list.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const due = dueToday(reminders);
  const undated = reminders.filter((r) => !r.due).length;
  const today = startOfDay();
  const weekCount = week.reduce((n, d) => n + d.events.length, 0);

  const first = (list: CalendarEvent[]) =>
    list.length ? `${list[0].allDay ? "ganztägig" : time(list[0].start)} ${list[0].title}` : "keine Termine";
  const tiles: { id: TileId; icon: string; title: string; count?: number; preview: string }[] = [
    { id: "tomorrow", icon: "📅", title: "Termine morgen", count: tomorrow.length, preview: first(tomorrow) },
    { id: "week", icon: "🗓️", title: "Termine der Woche", count: weekCount, preview: `${weekCount} Termine bis Sonntag` },
    ...(source === "mac"
      ? [{ id: "reminders" as const, icon: "⏰", title: "Erinnerungen", count: due.length, preview: due[0]?.title ?? "nichts fällig" }]
      : []),
    { id: "mails", icon: "✉️", title: "Ungelesene Mails", count: mails.length, preview: mails[0] ? `${mails[0].from}: ${mails[0].subject}` : "keine neuen Mails" },
    { id: "plan", icon: "✨", title: "Tagesplan", preview: plan ? "fertig erstellt" : "von Claude planen lassen" },
  ];

  if (connected === false) {
    return (
      <section>
        <h2>Heute, {dayLabel(new Date())}</h2>
        <p className="hint">Verbinde unter Einstellungen dein Google-Konto oder stell die Quelle auf „Mac“ um, dann erscheinen hier deine Termine und Mails.</p>
      </section>
    );
  }

  return (
    <section className="today">
      <div className="row">
        <h2>Heute, {dayLabel(new Date())}</h2>
        <button onClick={() => refresh()} disabled={loading}>{loading ? "Lädt…" : "Aktualisieren"}</button>
      </div>
      {error && <p className="error">{error}</p>}

      <article className="card">
        <h3>Termine heute</h3>
        {!loading && <EventList events={events} empty="Heute keine Termine." />}
      </article>

      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.id} className={tile === t.id ? "tile active" : "tile"} onClick={() => toggleTile(t.id)}>
            <span className="tile-head">
              <span className="tile-icon">{t.icon}</span>
              {t.count !== undefined && <span className="tile-count">{t.count}</span>}
            </span>
            <span className="tile-title">{t.title}</span>
            <span className="tile-preview">{t.preview}</span>
          </button>
        ))}
      </div>

      {tile === "tomorrow" && (
        <article className="card tile-panel">
          <h3>Termine morgen</h3>
          <p className="hint">{dayLabel(startOfDay(1))}</p>
          <EventList events={tomorrow} empty="Morgen keine Termine." />
        </article>
      )}

      {tile === "week" && (
        <article className="card tile-panel">
          <h3>Termine der Woche</h3>
          <div className="week">
            {week.map(({ day, events: dayEvents }) => (
              <div key={day.getTime()} className={day.getTime() === today.getTime() ? "week-day today" : "week-day"}>
                <h4>
                  {day.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "numeric" })}
                  {day.getTime() === today.getTime() && " · heute"}
                </h4>
                <EventList events={dayEvents} empty="Keine Termine." />
              </div>
            ))}
          </div>
        </article>
      )}

      {tile === "reminders" && (
        <article className="card tile-panel">
          <h3>Erinnerungen</h3>
          {due.length === 0 && <p>Heute ist nichts fällig.</p>}
          <ul className="list">
            {due.map((r) => (
              <li key={r.id} className="reminder">
                <input type="checkbox" title="Als erledigt abhaken" onChange={() => complete(r)} />
                <div>
                  {r.title}
                  <span className={r.due! < today ? "meta overdue" : "meta"}>
                    {dueLabel(r.due!)} · {r.list}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {undated > 0 && <p className="hint">Dazu {undated} offene Erinnerungen ohne Datum.</p>}
        </article>
      )}

      {tile === "mails" && (
        <article className="card tile-panel">
          <h3>Ungelesene Mails</h3>
          {mails.length === 0 && <p>Keine neuen Mails.</p>}
          <ul className="list mails-today">
            {mails.map((m) => (
              <li key={m.id}>
                <div className="mail-line">
                  <strong>{m.from}</strong>
                  <span className="meta-inline">{time(m.date)}</span>
                </div>
                <div className="mail-subject">{m.subject}</div>
                <MailBody mail={m} source={source} />
              </li>
            ))}
          </ul>
        </article>
      )}

      {tile === "plan" && (
        <article className="card tile-panel">
          <h3>Tagesplan von Claude</h3>
          <div className="row">
            <p>Claude plant deinen Tag mit Terminen und fälligen Erinnerungen und erinnert dich an Zahlungen aus deinen Mails.</p>
            <button className="primary" onClick={makePlan} disabled={planning || loading}>
              {planning ? "Plant…" : plan ? "Neu planen" : "Tagesplan erstellen"}
            </button>
          </div>
          {plan && <Markdown text={plan} sectionClass="plan-section" />}
        </article>
      )}
    </section>
  );
}
