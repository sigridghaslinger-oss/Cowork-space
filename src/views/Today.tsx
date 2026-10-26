import { useEffect, useState } from "react";
import type { CalendarEvent } from "../google/calendar";
import type { MailSummary } from "../google/gmail";
import { getSource, isSourceReady, loadToday, type Source } from "../sources";
import { streamDayPlan } from "../claude";
import { getApiKey } from "../settings";
import { completeMacReminder, type Reminder } from "../mac";

const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

// Fällig heute oder schon überfällig, das Älteste zuerst.
const dueToday = (reminders: Reminder[]) =>
  reminders
    .filter((r) => r.due && r.due <= endOfToday())
    .sort((a, b) => a.due!.getTime() - b.due!.getTime());

function dueLabel(due: Date): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (due < start) return `überfällig seit ${due.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`;
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

export default function Today() {
  const [source, setSource] = useState<Source>("mac");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [mails, setMails] = useState<MailSummary[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [planning, setPlanning] = useState(false);

  const date = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

  async function refresh(from: Source = source) {
    setLoading(true);
    setError(null);
    try {
      const data = await loadToday(from);
      setEvents(data.events);
      setMails(data.mails);
      setReminders(data.reminders);
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

  if (connected === false) {
    return (
      <section>
        <h2>Heute, {date}</h2>
        <p className="hint">Verbinde unter Einstellungen dein Google-Konto oder stell die Quelle auf „Mac“ um, dann erscheinen hier deine Termine und Mails.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="row">
        <h2>Heute, {date}</h2>
        <button onClick={() => refresh()} disabled={loading}>{loading ? "Lädt…" : "Aktualisieren"}</button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="cards">
        <article className="card">
          <h3>Termine</h3>
          {events.length === 0 && !loading && <p>Heute keine Termine.</p>}
          <ul className="list">
            {events.map((e) => (
              <li key={`${e.calendar}-${e.id}`}>
                <strong>{e.allDay ? "Ganztägig" : `${time(e.start)}–${time(e.end)}`}</strong> {e.title}
                <span className="meta">{e.calendar}{e.location ? ` · ${e.location}` : ""}</span>
              </li>
            ))}
          </ul>
        </article>

        {source === "mac" && (
          <article className="card">
            <h3>Erinnerungen</h3>
            {due.length === 0 && !loading && <p>Heute ist nichts fällig.</p>}
            <ul className="list">
              {due.map((r) => (
                <li key={r.id} className="reminder">
                  <input type="checkbox" title="Als erledigt abhaken" onChange={() => complete(r)} />
                  <div>
                    {r.title}
                    <span className={r.due! < new Date(new Date().setHours(0, 0, 0, 0)) ? "meta overdue" : "meta"}>
                      {dueLabel(r.due!)} · {r.list}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {undated > 0 && <p className="hint">Dazu {undated} offene Erinnerungen ohne Datum.</p>}
          </article>
        )}

        <article className="card">
          <h3>Ungelesene Mails</h3>
          {mails.length === 0 && !loading && <p>Keine neuen Mails.</p>}
          <ul className="list">
            {mails.map((m) => (
              <li key={m.id}>
                <strong>{m.from}</strong> {m.subject}
                <span className="meta">{m.snippet}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="card plan">
        <div className="row">
          <h3>Tagesplan von Claude</h3>
          <button className="primary" onClick={makePlan} disabled={planning || loading}>
            {planning ? "Plant…" : "Tagesplan erstellen"}
          </button>
        </div>
        {plan ? <div className="plan-text">{plan}</div> : <p>Claude plant deinen Tag mit Terminen und fälligen Erinnerungen und erinnert dich an Zahlungen aus deinen Mails.</p>}
      </article>
    </section>
  );
}
