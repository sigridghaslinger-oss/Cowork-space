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

// Aufklappbarer Kasten; ob er offen ist, merkt sich die App pro Kasten.
function Fold({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  const key = `fold-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return (
    <details
      className="card fold"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        try {
          localStorage.setItem(key, next ? "1" : "0");
        } catch {
          // Ohne Speicher bleibt es eben beim nächsten Start zu.
        }
      }}
    >
      <summary>
        <h3>{title}</h3>
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
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

      <Fold id="tomorrow" title="Termine morgen" count={tomorrow.length}>
        <p className="hint">{dayLabel(startOfDay(1))}</p>
        <EventList events={tomorrow} empty="Morgen keine Termine." />
      </Fold>

      <Fold id="week" title="Termine der Woche" count={weekCount}>
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
      </Fold>

      {source === "mac" && (
        <Fold id="reminders" title="Erinnerungen" count={due.length}>
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
        </Fold>
      )}

      <Fold id="mails" title="Ungelesene Mails" count={mails.length}>
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
      </Fold>

      <Fold id="plan" title="Tagesplan von Claude">
        <div className="row">
          <p>Claude plant deinen Tag mit Terminen und fälligen Erinnerungen und erinnert dich an Zahlungen aus deinen Mails.</p>
          <button className="primary" onClick={makePlan} disabled={planning || loading}>
            {planning ? "Plant…" : plan ? "Neu planen" : "Tagesplan erstellen"}
          </button>
        </div>
        {plan && <Markdown text={plan} sectionClass="plan-section" />}
      </Fold>
    </section>
  );
}
