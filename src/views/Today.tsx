import { useEffect, useState } from "react";
import type { CalendarEvent } from "../google/calendar";
import type { MailSummary } from "../google/gmail";
import { getSource, isSourceReady, loadToday, type Source } from "../sources";
import { streamDayPlan } from "../claude";
import { getApiKey } from "../settings";

const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function describe(events: CalendarEvent[], mails: MailSummary[]): string {
  const ev = events.length
    ? events
        .map((e) => `- ${e.allDay ? "ganztägig" : `${time(e.start)}–${time(e.end)}`}: ${e.title} [${e.calendar}]${e.location ? ` (${e.location})` : ""}`)
        .join("\n")
    : "- keine Termine";
  const ml = mails.length
    ? mails.map((m) => `- Von ${m.from}: „${m.subject}“ – ${m.snippet}`).join("\n")
    : "- keine ungelesenen Mails";
  return `Termine:\n${ev}\n\nUngelesene Mails:\n${ml}`;
}

export default function Today() {
  const [source, setSource] = useState<Source>("mac");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [mails, setMails] = useState<MailSummary[]>([]);
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
      await streamDayPlan(apiKey, describe(events, mails), (d) => setPlan((p) => p + d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

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
        {plan ? <div className="plan-text">{plan}</div> : <p>Claude plant deinen Tag und erinnert dich an fällige Zahlungen aus deinen Mails.</p>}
      </article>
    </section>
  );
}
