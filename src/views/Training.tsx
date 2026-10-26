import { useEffect, useState, type ChangeEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Chat, { type ChatState } from "./Chat";
import type { Area, AreaId } from "../areas";
import type { CalendarEvent } from "../google/calendar";
import { getSource, loadEventsForDay } from "../sources";
import { formatDay, isoDay } from "../school/exams";
import {
  coachingHours,
  hoursLabel,
  loadTraining,
  newId,
  saveTraining,
  type CoachingSession,
  type Training as TrainingData,
  type TrainingDate,
} from "../training/data";

type TileId = "overview" | "dates" | "coaching" | "tasks" | "journal" | "docs" | "chat";
const TILE_KEY = "training-tile";

function savedTile(): TileId | null {
  try {
    return (localStorage.getItem(TILE_KEY) as TileId) || null;
  } catch {
    return null;
  }
}

const today = () => isoDay(new Date());
const time = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

type Props = {
  area: Area;
  chat: ChatState;
  setChat: (area: AreaId, update: (c: ChatState) => ChatState) => void;
};

export default function Training({ area, chat, setChat }: Props) {
  const [data, setData] = useState<TrainingData | null>(null);
  const [tile, setTile] = useState<TileId | null>(savedTile);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    loadTraining().then(setData);
  }, []);

  // Passende Kalendertermine der nächsten acht Wochen, damit sie nicht doppelt eingetragen werden müssen.
  useEffect(() => {
    const word = data?.stichwort.trim().toLowerCase();
    if (!word) {
      setCalendar([]);
      return;
    }
    let cancelled = false;
    // Kurz warten, damit beim Tippen des Stichworts nicht jeder Buchstabe den Kalender abfragt.
    const timer = setTimeout(async () => {
      const source = await getSource();
      const days = Array.from({ length: 56 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        return d;
      });
      const all = await Promise.all(days.map((d) => loadEventsForDay(source, d).catch(() => [])));
      const hits = all.flat().filter((e) => `${e.title} ${e.calendar}`.toLowerCase().includes(word));
      if (!cancelled) setCalendar(hits);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data?.stichwort]);

  function update(change: (t: TrainingData) => TrainingData) {
    setData((t) => {
      if (!t) return t;
      const next = change(t);
      saveTraining(next);
      return next;
    });
  }

  function toggleTile(id: TileId) {
    const next = tile === id ? null : id;
    setTile(next);
    try {
      localStorage.setItem(TILE_KEY, next ?? "");
    } catch {
      // Ohne Speicher startet die Seite eben mit allen Kacheln zu.
    }
  }

  if (!data) return null;

  const upcoming = data.termine.filter((d) => d.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum));
  const nextDate = upcoming[0];
  const openTasks = data.aufgaben.filter((a) => !a.erledigt);
  const doneTasks = data.aufgaben.length - openTasks.length;
  const hours = coachingHours(data);
  const lastNote = [...data.journal].sort((a, b) => b.datum.localeCompare(a.datum))[0];

  const tiles: { id: TileId; icon: string; title: string; count?: number; preview: string }[] = [
    { id: "overview", icon: "🎓", title: "Übersicht", preview: data.name || "Ausbildung eintragen" },
    {
      id: "dates",
      icon: "📅",
      title: "Termine",
      count: upcoming.length + calendar.length,
      preview: nextDate ? `${formatDay(nextDate.datum)} ${nextDate.titel}` : calendar[0] ? calendar[0].title : "keine Termine",
    },
    {
      id: "coaching",
      icon: "💬",
      title: "Coaching",
      count: data.coaching.length,
      preview: data.stundenZiel ? `${hoursLabel(hours)} von ${data.stundenZiel} h` : `${hoursLabel(hours)} gesamt`,
    },
    {
      id: "tasks",
      icon: "✅",
      title: "Checkliste",
      count: openTasks.length,
      preview: openTasks[0]?.text ?? (data.aufgaben.length ? "alles erledigt 🌿" : "Aufgaben sammeln"),
    },
    { id: "journal", icon: "📝", title: "Lernjournal", count: data.journal.length, preview: lastNote?.titel ?? "Gedanken festhalten" },
    { id: "docs", icon: "📎", title: "Unterlagen", count: data.unterlagen.length, preview: data.unterlagen[0]?.titel ?? "Links sammeln" },
    { id: "chat", icon: "✨", title: "Claude fragen", preview: "Reflexion, Zusammenfassung, Ideen" },
  ];

  return (
    <section className="today training">
      <div className="row">
        <h2>
          {area.icon} {data.name || area.label}
        </h2>
      </div>

      <article className="card">
        <h3>Als Nächstes</h3>
        <ul className="list">
          <li>
            📅 {nextDate ? <><strong>{formatDay(nextDate.datum)}{nextDate.uhrzeit && `, ${nextDate.uhrzeit}`}</strong> {nextDate.titel}</> : "Kein Termin eingetragen."}
          </li>
          <li>
            ✅ {openTasks.length ? <>{openTasks.length} offene Aufgaben, als Nächstes: <strong>{nextTask(openTasks)}</strong></> : "Keine offenen Aufgaben."}
          </li>
          {(data.stundenZiel > 0 || data.aufgaben.length > 0) && (
            <li className="progress-pair">
              {data.stundenZiel > 0 && (
                <ProgressLine label="Coaching-Stunden" value={hours} max={data.stundenZiel} text={`${hoursLabel(hours)} von ${data.stundenZiel} h`} />
              )}
              {data.aufgaben.length > 0 && (
                <ProgressLine label="Checkliste" value={doneTasks} max={data.aufgaben.length} text={`${doneTasks} von ${data.aufgaben.length} erledigt`} />
              )}
            </li>
          )}
        </ul>
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

      {tile === "overview" && <Overview data={data} update={update} />}
      {tile === "dates" && <Dates data={data} calendar={calendar} update={update} />}
      {tile === "coaching" && <Coaching data={data} update={update} />}
      {tile === "tasks" && <Tasks data={data} update={update} />}
      {tile === "journal" && <Journal data={data} update={update} />}
      {tile === "docs" && <Docs data={data} update={update} />}
      {tile === "chat" && (
        <article className="card tile-panel training-chat">
          <Chat area={area} chat={chat} setChat={setChat} hideTitle />
        </article>
      )}
    </section>
  );
}

type PanelProps = { data: TrainingData; update: (change: (t: TrainingData) => TrainingData) => void };

function nextTask(open: TrainingData["aufgaben"]): string {
  const withDate = open.filter((a) => a.frist).sort((a, b) => a.frist.localeCompare(b.frist));
  const t = withDate[0] ?? open[0];
  return t.frist ? `${t.text} (bis ${formatDay(t.frist)})` : t.text;
}

function ProgressLine({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <span className="meta-inline">{label} · {text}</span>
      <div className="progress" title={`${pct} %`}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Overview({ data, update }: PanelProps) {
  const set = (key: keyof TrainingData) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    update((t) => ({ ...t, [key]: key === "stundenZiel" ? Number(e.target.value) || 0 : e.target.value }));
  return (
    <article className="card tile-panel">
      <h3>Meine Ausbildung</h3>
      <p className="hint">Alles wird sofort gespeichert und bleibt nur auf deinem Mac.</p>
      <div className="form-grid">
        <label className="field">Name der Ausbildung<input value={data.name} onChange={set("name")} placeholder="z. B. Systemisches Coaching" /></label>
        <label className="field">Anbieter / Institut<input value={data.anbieter} onChange={set("anbieter")} /></label>
        <label className="field">Beginn<input type="date" value={data.start} onChange={set("start")} /></label>
        <label className="field">Abschluss<input type="date" value={data.ende} onChange={set("ende")} /></label>
        <label className="field">Nötige Coaching-Stunden<input type="number" min={0} value={data.stundenZiel || ""} onChange={set("stundenZiel")} placeholder="z. B. 30" /></label>
        <label className="field">Stichwort im Kalender<input value={data.stichwort} onChange={set("stichwort")} placeholder="z. B. Ausbildung" /></label>
      </div>
      <label className="field wide">Mein Ziel / warum ich das mache<textarea value={data.ziel} onChange={set("ziel")} /></label>
      <p className="hint">Termine im Kalender, deren Titel oder Kalendername das Stichwort enthält, erscheinen automatisch unter Termine.</p>
    </article>
  );
}

const emptyDate = () => ({ datum: today(), uhrzeit: "", titel: "", ort: "", art: "Modul" as TrainingDate["art"] });

function Dates({ data, calendar, update }: PanelProps & { calendar: CalendarEvent[] }) {
  const [form, setForm] = useState(emptyDate());
  const [showPast, setShowPast] = useState(false);
  const sorted = [...data.termine].sort((a, b) => a.datum.localeCompare(b.datum) || a.uhrzeit.localeCompare(b.uhrzeit));
  const upcoming = sorted.filter((d) => d.datum >= today());
  const past = sorted.filter((d) => d.datum < today()).reverse();

  function add() {
    if (!form.titel.trim() || !form.datum) return;
    update((t) => ({ ...t, termine: [...t.termine, { id: newId(), ...form, titel: form.titel.trim() }] }));
    setForm(emptyDate());
  }

  const remove = (id: string) => update((t) => ({ ...t, termine: t.termine.filter((d) => d.id !== id) }));

  const row = (d: TrainingDate) => (
    <li key={d.id}>
      <span className="event-time">{formatDay(d.datum)}</span>
      <div className="grow">
        {d.titel} <span className="badge">{d.art}</span>
        <span className="meta">{[d.uhrzeit && `${d.uhrzeit} Uhr`, d.ort].filter(Boolean).join(" · ") || "ganztägig"}</span>
      </div>
      <button className="ghost danger" title="Entfernen" onClick={() => remove(d.id)}>✕</button>
    </li>
  );

  return (
    <article className="card tile-panel">
      <h3>Termine</h3>
      <div className="form-grid">
        <label className="field">Datum<input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></label>
        <label className="field">Uhrzeit<input type="time" value={form.uhrzeit} onChange={(e) => setForm({ ...form, uhrzeit: e.target.value })} /></label>
        <label className="field">Was<input value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} placeholder="z. B. Modul 3" /></label>
        <label className="field">Ort<input value={form.ort} onChange={(e) => setForm({ ...form, ort: e.target.value })} /></label>
        <label className="field">Art
          <select value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value as TrainingDate["art"] })}>
            {["Modul", "Supervision", "Prüfung", "Abgabe", "Sonstiges"].map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <button className="primary" onClick={add} disabled={!form.titel.trim()}>Termin eintragen</button>

      <h4>Kommende Termine</h4>
      {upcoming.length === 0 ? <p>Noch nichts eingetragen.</p> : <ul className="list events">{upcoming.map(row)}</ul>}

      {calendar.length > 0 && (
        <>
          <h4>Aus deinem Kalender („{data.stichwort}“)</h4>
          <ul className="list events">
            {calendar.map((e) => (
              <li key={`${e.calendar}-${e.id}-${e.start.getTime()}`}>
                <span className="event-time">{formatDay(isoDay(e.start))}</span>
                <div>
                  {e.title}
                  <span className="meta">{e.allDay ? "ganztägig" : `${time(e.start)}–${time(e.end)}`} · {e.calendar}{e.location ? ` · ${e.location}` : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <button className="ghost link" onClick={() => setShowPast(!showPast)}>
            {showPast ? "Vergangene ausblenden" : `${past.length} vergangene Termine anzeigen`}
          </button>
          {showPast && <ul className="list events past">{past.map(row)}</ul>}
        </>
      )}
    </article>
  );
}

const ARTEN: CoachingSession["art"][] = ["Coaching (ich coache)", "Supervision", "Peer-Coaching", "Selbsterfahrung"];
const emptySession = () => ({ datum: today(), minuten: "60", art: ARTEN[0], kuerzel: "", thema: "", reflexion: "" });

function Coaching({ data, update }: PanelProps) {
  const [form, setForm] = useState(emptySession());
  const [open, setOpen] = useState<string | null>(null);
  const sessions = [...data.coaching].sort((a, b) => b.datum.localeCompare(a.datum));
  const total = coachingHours(data);

  function add() {
    const minuten = parseInt(form.minuten, 10);
    if (!minuten) return;
    update((t) => ({ ...t, coaching: [...t.coaching, { id: newId(), ...form, minuten }] }));
    setForm(emptySession());
  }

  function remove(id: string) {
    if (confirm("Diese Sitzung löschen?")) update((t) => ({ ...t, coaching: t.coaching.filter((s) => s.id !== id) }));
  }

  return (
    <article className="card tile-panel">
      <div className="row">
        <h3>Coaching-Sitzungen</h3>
        <span className="meta-inline">{hoursLabel(total)}{data.stundenZiel ? ` von ${data.stundenZiel} h` : ""}</span>
      </div>
      {data.stundenZiel > 0 && <ProgressLine label="Fortschritt" value={total} max={data.stundenZiel} text={`${Math.min(100, Math.round((total / data.stundenZiel) * 100))} %`} />}
      <div className="chips coaching-sums">
        {ARTEN.map((a) => {
          const h = data.coaching.filter((s) => s.art === a).reduce((n, s) => n + s.minuten, 0) / 60;
          return h ? <span key={a} className="pill">{a}: {hoursLabel(h)}</span> : null;
        })}
      </div>

      <div className="form-grid">
        <label className="field">Datum<input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></label>
        <label className="field">Dauer (Minuten)<input type="number" min={5} step={5} value={form.minuten} onChange={(e) => setForm({ ...form, minuten: e.target.value })} /></label>
        <label className="field">Art
          <select value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value as CoachingSession["art"] })}>
            {ARTEN.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="field">Kürzel<input value={form.kuerzel} onChange={(e) => setForm({ ...form, kuerzel: e.target.value })} placeholder="z. B. K1" /></label>
      </div>
      <label className="field wide">Thema<input value={form.thema} onChange={(e) => setForm({ ...form, thema: e.target.value })} /></label>
      <label className="field wide">Reflexion: Was lief gut, was nehme ich mit?<textarea value={form.reflexion} onChange={(e) => setForm({ ...form, reflexion: e.target.value })} /></label>
      <p className="hint">Bitte nur ein Kürzel statt des Namens verwenden.</p>
      <button className="primary" onClick={add}>Sitzung speichern</button>

      <h4>Bisher</h4>
      {sessions.length === 0 && <p>Noch keine Sitzungen eingetragen.</p>}
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.id} className="entry">
            <div className="mail-head" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div>
                <strong>{formatDay(s.datum)}</strong> · {s.art}{s.kuerzel && ` · ${s.kuerzel}`} · {s.minuten} min
                <span className="meta">{s.thema || "ohne Thema"}</span>
              </div>
              <button className="ghost danger" title="Löschen" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>✕</button>
            </div>
            {open === s.id && s.reflexion && <p className="entry-text">{s.reflexion}</p>}
          </li>
        ))}
      </ul>
    </article>
  );
}

function Tasks({ data, update }: PanelProps) {
  const [text, setText] = useState("");
  const [frist, setFrist] = useState("");
  const sorted = [...data.aufgaben].sort(
    (a, b) => Number(a.erledigt) - Number(b.erledigt) || (a.frist || "9999").localeCompare(b.frist || "9999"),
  );

  function add() {
    if (!text.trim()) return;
    update((t) => ({ ...t, aufgaben: [...t.aufgaben, { id: newId(), text: text.trim(), frist, erledigt: false }] }));
    setText("");
    setFrist("");
  }

  const toggle = (id: string) =>
    update((t) => ({ ...t, aufgaben: t.aufgaben.map((a) => (a.id === id ? { ...a, erledigt: !a.erledigt } : a)) }));
  const remove = (id: string) => update((t) => ({ ...t, aufgaben: t.aufgaben.filter((a) => a.id !== id) }));

  return (
    <article className="card tile-panel">
      <h3>Checkliste</h3>
      <div className="composer task-add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="z. B. Hausarbeit Modul 2 abgeben"
        />
        <input type="date" value={frist} onChange={(e) => setFrist(e.target.value)} title="Frist (optional)" />
        <button className="primary" onClick={add} disabled={!text.trim()}>Hinzufügen</button>
      </div>
      {sorted.length === 0 && <p>Noch keine Aufgaben. Sammle hier, was bis zum Abschluss erledigt sein muss.</p>}
      <ul className="list">
        {sorted.map((a) => (
          <li key={a.id} className={a.erledigt ? "reminder done" : "reminder"}>
            <input type="checkbox" checked={a.erledigt} onChange={() => toggle(a.id)} />
            <div className="grow">
              {a.text}
              {a.frist && <span className={!a.erledigt && a.frist < today() ? "meta overdue" : "meta"}>bis {formatDay(a.frist)}</span>}
            </div>
            <button className="ghost danger" title="Entfernen" onClick={() => remove(a.id)}>✕</button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Journal({ data, update }: PanelProps) {
  const [titel, setTitel] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const entries = [...data.journal].sort((a, b) => b.datum.localeCompare(a.datum));

  function add() {
    if (!titel.trim() && !text.trim()) return;
    update((t) => ({ ...t, journal: [...t.journal, { id: newId(), datum: today(), titel: titel.trim() || "Notiz", text }] }));
    setTitel("");
    setText("");
  }

  function remove(id: string) {
    if (confirm("Diesen Eintrag löschen?")) update((t) => ({ ...t, journal: t.journal.filter((j) => j.id !== id) }));
  }

  return (
    <article className="card tile-panel">
      <h3>Lernjournal</h3>
      <label className="field wide">Überschrift<input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="z. B. Erkenntnisse aus Modul 2" /></label>
      <label className="field wide">Was habe ich gelernt, was beschäftigt mich?<textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} /></label>
      <button className="primary" onClick={add}>Eintrag speichern</button>

      <h4>Einträge</h4>
      {entries.length === 0 && <p>Noch keine Einträge.</p>}
      <ul className="list">
        {entries.map((j) => (
          <li key={j.id} className="entry">
            <div className="mail-head" onClick={() => setOpen(open === j.id ? null : j.id)}>
              <div>
                <strong>{j.titel}</strong>
                <span className="meta">{formatDay(j.datum)}</span>
              </div>
              <button className="ghost danger" title="Löschen" onClick={(e) => { e.stopPropagation(); remove(j.id); }}>✕</button>
            </div>
            {open === j.id && <p className="entry-text">{j.text}</p>}
          </li>
        ))}
      </ul>
    </article>
  );
}

function Docs({ data, update }: PanelProps) {
  const [titel, setTitel] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const url = link.trim();
    if (!titel.trim() || !/^https?:\/\//.test(url)) {
      setError("Bitte einen Titel und einen Link eingeben, der mit https:// beginnt.");
      return;
    }
    setError(null);
    update((t) => ({ ...t, unterlagen: [...t.unterlagen, { id: newId(), titel: titel.trim(), link: url }] }));
    setTitel("");
    setLink("");
  }

  const remove = (id: string) => update((t) => ({ ...t, unterlagen: t.unterlagen.filter((d) => d.id !== id) }));

  return (
    <article className="card tile-panel">
      <h3>Unterlagen</h3>
      <p className="hint">Links zu Skripten, Lernplattform oder Ordnern in OneDrive/iCloud (in OneDrive: Teilen → Link kopieren).</p>
      <div className="composer task-add">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Titel, z. B. Skript Modul 1" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        <button className="primary" onClick={add}>Hinzufügen</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data.unterlagen.length === 0 && <p>Noch keine Unterlagen gespeichert.</p>}
      <ul className="list">
        {data.unterlagen.map((d) => (
          <li key={d.id} className="reminder">
            <div className="grow">
              <button className="ghost link" onClick={() => openUrl(d.link)}>📎 {d.titel}</button>
              <span className="meta">{d.link}</span>
            </div>
            <button className="ghost danger" title="Entfernen" onClick={() => remove(d.id)}>✕</button>
          </li>
        ))}
      </ul>
    </article>
  );
}
