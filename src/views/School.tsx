import { useEffect, useState, type ReactNode } from "react";
import Chat, { type ChatState } from "./Chat";
import Rubric from "./Rubric";
import Week from "./Week";
import type { Area, AreaId } from "../areas";
import type { CalendarEvent } from "../google/calendar";
import type { MailSummary } from "../google/gmail";
import type { MailSort } from "../claude";
import { streamClassbook, streamCorrectionPlan } from "../claude";
import { getSource, loadEventsForDay, loadMails } from "../sources";
import { getApiKey, getSetting } from "../settings";
import {
  DEFAULT_THRESHOLDS,
  formatDay,
  gradeRanges,
  isoDay,
  loadExams,
  newExamId,
  parseDay,
  perDay,
  saveExams,
  workdaysUntil,
  type Exam,
} from "../school/exams";

type Tab = "overview" | "exams" | "rubric" | "classbook" | "chat";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Überblick" },
  { id: "exams", label: "Schularbeiten" },
  { id: "rubric", label: "Bewerten" },
  { id: "classbook", label: "Klassenbuch & Planung" },
  { id: "chat", label: "Chat" },
];

const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

type Props = {
  area: Area;
  chat: ChatState;
  setChat: (area: AreaId, update: (c: ChatState) => ChatState) => void;
};

export default function School({ area, chat, setChat }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [exams, setExams] = useState<Exam[]>([]);

  useEffect(() => {
    loadExams().then(setExams);
  }, []);

  async function updateExams(next: Exam[]) {
    setExams(next);
    await saveExams(next);
  }

  return (
    <section className={tab === "chat" ? "chat" : ""}>
      <div className="row">
        <h2>
          {area.icon} {area.label}
        </h2>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview exams={exams} onOpenExams={() => setTab("exams")} />}
      {tab === "exams" && <Exams exams={exams} onChange={updateExams} />}
      {tab === "rubric" && <Rubric />}
      {tab === "classbook" && (
        <>
          <Week />
          <Classbook />
        </>
      )}
      {tab === "chat" && <Chat area={area} chat={chat} setChat={setChat} hideTitle />}
    </section>
  );
}

function Progress({ exam }: { exam: Exam }) {
  const pct = exam.anzahl ? Math.round((exam.korrigiert / exam.anzahl) * 100) : 0;
  return (
    <div className="progress" title={`${pct} %`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

function deadlineText(exam: Exam): string {
  const left = exam.anzahl - exam.korrigiert;
  if (left <= 0) return "fertig korrigiert ✓";
  const n = perDay(exam);
  const days = workdaysUntil(exam.rueckgabe);
  if (n === null) return `Rückgabe ${formatDay(exam.rueckgabe)} – noch ${left} offen, Frist ist erreicht!`;
  return `noch ${left} offen · ${days} Schultage bis ${formatDay(exam.rueckgabe)} · ca. ${n} pro Tag`;
}

function Overview({ exams, onOpenExams }: { exams: Exam[]; onOpenExams: () => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [mails, setMails] = useState<{ mail: MailSummary; sort: MailSort }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const source = await getSource();
      const problems: string[] = [];
      try {
        setEvents(await loadEventsForDay(source, new Date()));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
      try {
        // Schul-Mails sind die, die Claude in der Mail-Ansicht dem Bereich Schule zugeordnet hat.
        const [all, cache] = await Promise.all([loadMails(source), getSetting<Record<string, MailSort>>("mailSort")]);
        setMails(all.filter((m) => cache?.[m.id]?.area === "schule").map((m) => ({ mail: m, sort: cache![m.id] })));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
      if (problems.length) setNote(problems.join(" "));
    })();
  }, []);

  const open = exams
    .filter((e) => e.korrigiert < e.anzahl)
    .sort((a, b) => a.rueckgabe.localeCompare(b.rueckgabe));

  return (
    <>
      {note && <p className="error">{note}</p>}
      <div className="cards">
        <article className="card">
          <h3>Heute</h3>
          {events.length === 0 && <p>Keine Termine oder Stunden im Kalender.</p>}
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
          <h3>Schul-Mails</h3>
          {mails.length === 0 && <p>Keine. Unter 📬 Mails „Mit Claude sortieren“ ordnet neue Mails der Schule zu.</p>}
          <ul className="list">
            {mails.map(({ mail, sort }) => (
              <li key={mail.id}>
                {sort.urgency === "heute" && <span className="badge">heute</span>} <strong>{mail.from}</strong> {mail.subject}
                <span className="meta">{sort.summary}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="card plan">
        <div className="row">
          <h3>Schularbeiten zum Korrigieren</h3>
          <button onClick={onOpenExams}>Verwalten</button>
        </div>
        {open.length === 0 ? (
          <p>Gerade nichts zu korrigieren. 🌿</p>
        ) : (
          <ul className="list">
            {open.map((e) => (
              <li key={e.id}>
                <strong>{e.klasse} {e.fach}</strong> · {e.korrigiert}/{e.anzahl}
                <Progress exam={e} />
                <span className="meta">{deadlineText(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}

const emptyForm = () => ({ klasse: "", fach: "", datum: isoDay(new Date()), rueckgabe: "", anzahl: "" });

function Exams({ exams, onChange }: { exams: Exam[]; onChange: (e: Exam[]) => void }) {
  const [form, setForm] = useState(emptyForm());
  const [plan, setPlan] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add() {
    const anzahl = parseInt(form.anzahl, 10);
    if (!form.klasse || !form.rueckgabe || !anzahl) return;
    onChange([...exams, { id: newExamId(), klasse: form.klasse, fach: form.fach, datum: form.datum, rueckgabe: form.rueckgabe, anzahl, korrigiert: 0 }]);
    setForm(emptyForm());
  }

  function setDone(id: string, korrigiert: number) {
    onChange(exams.map((e) => (e.id === id ? { ...e, korrigiert: Math.max(0, Math.min(e.anzahl, korrigiert)) } : e)));
  }

  function remove(id: string) {
    if (confirm("Diese Schularbeit aus der Liste entfernen?")) onChange(exams.filter((e) => e.id !== id));
  }

  async function makePlan() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    const open = exams.filter((e) => e.korrigiert < e.anzahl);
    if (!open.length) return;
    setPlan("");
    setError(null);
    setPlanning(true);
    try {
      // Termine bis zur spätesten Rückgabe (höchstens drei Wochen) als Grundlage für freie Zeiten.
      const source = await getSource();
      const last = open.map((e) => parseDay(e.rueckgabe)).reduce((a, b) => (a > b ? a : b));
      const days: Date[] = [];
      const d = new Date();
      for (let i = 0; i < 21 && d <= last; i++) {
        days.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      const calendar = await Promise.all(
        days.map(async (day) => {
          const events = await loadEventsForDay(source, day).catch(() => null);
          const label = day.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "numeric" });
          if (events === null) return `${label}: (Kalender nicht verfügbar)`;
          const busy = events.map((e) => (e.allDay ? `ganztägig ${e.title}` : `${time(e.start)}–${time(e.end)} ${e.title}`));
          return `${label}: ${busy.length ? busy.join("; ") : "keine Termine"}`;
        }),
      );
      const list = open
        .map((e) => `- ${e.klasse} ${e.fach}: ${e.anzahl - e.korrigiert} von ${e.anzahl} offen, geschrieben ${formatDay(e.datum)}, Rückgabe ${formatDay(e.rueckgabe)}`)
        .join("\n");
      const context = `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}, ${time(new Date())} Uhr.

Offene Schularbeiten:
${list}

Mein Kalender:
${calendar.join("\n")}`;
      await streamCorrectionPlan(apiKey, context, (t) => setPlan((p) => p + t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  const sorted = [...exams].sort((a, b) => a.rueckgabe.localeCompare(b.rueckgabe));

  return (
    <>
      <article className="card">
        <h3>Neue Schularbeit</h3>
        <div className="form-grid">
          <Field label="Klasse"><input value={form.klasse} placeholder="z. B. 4b" onChange={(e) => setForm({ ...form, klasse: e.target.value })} /></Field>
          <Field label="Fach"><input value={form.fach} placeholder="z. B. Mathematik" onChange={(e) => setForm({ ...form, fach: e.target.value })} /></Field>
          <Field label="Geschrieben am"><input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
          <Field label="Rückgabe bis"><input type="date" value={form.rueckgabe} onChange={(e) => setForm({ ...form, rueckgabe: e.target.value })} /></Field>
          <Field label="Anzahl Arbeiten"><input type="number" min="1" value={form.anzahl} onChange={(e) => setForm({ ...form, anzahl: e.target.value })} /></Field>
        </div>
        <button className="primary" onClick={add} disabled={!form.klasse || !form.rueckgabe || !parseInt(form.anzahl, 10)}>
          Hinzufügen
        </button>
      </article>

      {sorted.map((e) => (
        <article key={e.id} className="card exam">
          <div className="row">
            <div>
              <strong>{e.klasse} {e.fach}</strong>
              <span className="meta-inline"> · geschrieben {formatDay(e.datum)}</span>
            </div>
            <button className="ghost" onClick={() => remove(e.id)}>Entfernen</button>
          </div>
          <Progress exam={e} />
          <div className="row">
            <span className="meta-inline">{deadlineText(e)}</span>
            <div className="stepper">
              <button onClick={() => setDone(e.id, e.korrigiert - 1)}>−</button>
              <span>{e.korrigiert} / {e.anzahl} korrigiert</span>
              <button onClick={() => setDone(e.id, e.korrigiert + 1)}>+</button>
            </div>
          </div>
        </article>
      ))}

      {exams.some((e) => e.korrigiert < e.anzahl) && (
        <article className="card plan">
          <div className="row">
            <h3>Korrekturplan</h3>
            <button className="primary" onClick={makePlan} disabled={planning}>
              {planning ? "Plant…" : plan ? "Neu planen" : "Korrekturplan erstellen"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {plan ? <div className="plan-text">{plan}</div> : <p>Claude verteilt die offenen Arbeiten auf deine freien Zeiten bis zur Rückgabe.</p>}
        </article>
      )}

      <GradeKey />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

function GradeKey() {
  const [max, setMax] = useState("48");
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const points = parseFloat(max.replace(",", "."));
  const ranges = points > 0 ? gradeRanges(points, thresholds) : [];
  const fmt = (n: number) => n.toLocaleString("de-DE");

  return (
    <article className="card">
      <h3>Notenschlüssel</h3>
      <div className="form-grid">
        <Field label="Maximale Punkte"><input value={max} inputMode="decimal" onChange={(e) => setMax(e.target.value)} /></Field>
        {thresholds.map((t, i) => (
          <Field key={i} label={`Ab % für ${["1", "2", "3", "4"][i]}`}>
            <input
              type="number"
              value={t}
              onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? Number(e.target.value) : x)))}
            />
          </Field>
        ))}
      </div>
      {ranges.length > 0 && (
        <table className="grades">
          <tbody>
            {ranges.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.max < r.min ? "–" : `${fmt(r.min)} – ${fmt(r.max)} Punkte`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function Classbook() {
  const [klasse, setKlasse] = useState("");
  const [fach, setFach] = useState("");
  const [notes, setNotes] = useState("");
  const [withPlanning, setWithPlanning] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setNote("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setText("");
    setNote(null);
    setBusy(true);
    try {
      await streamClassbook(apiKey, klasse, fach, notes, withPlanning, (t) => setText((x) => x + t));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Kopiert. In EduPage einfügen mit ⌘V.");
    } catch {
      setNote("Kopieren hat nicht geklappt. Markiere den Text und drücke ⌘C.");
    }
  }

  return (
    <article className="card">
      <h3>Einzelne Stunde aus Stichworten</h3>
      <div className="form-grid">
        <Field label="Klasse"><input value={klasse} placeholder="z. B. 2a" onChange={(e) => setKlasse(e.target.value)} /></Field>
        <Field label="Fach"><input value={fach} placeholder="z. B. Informatik" onChange={(e) => setFach(e.target.value)} /></Field>
      </div>
      <label className="field wide">
        Stichworte zur Stunde
        <textarea
          value={notes}
          placeholder="z. B. Scratch Lernkarte 3, Figur steuern mit Pfeiltasten, Partnerarbeit, HÜ: Lernkarte 4 fertig"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={withPlanning} onChange={(e) => setWithPlanning(e.target.checked)} />
        Auch eine Stundenplanung erstellen
      </label>
      <div className="actions">
        <button className="primary" onClick={generate} disabled={busy || !notes.trim()}>
          {busy ? "Schreibt…" : "Formulieren"}
        </button>
        {text && <button onClick={copy} disabled={busy}>Kopieren</button>}
      </div>
      {text && <div className="plan-text output">{text}</div>}
      {note && <p className="hint">{note}</p>}
    </article>
  );
}
