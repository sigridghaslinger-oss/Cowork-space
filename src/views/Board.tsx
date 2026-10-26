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
  loadBoard,
  newId,
  saveBoard,
  type BoardData,
  type BoardDate,
    type Task,
} from "../board/data";

type TileId = "overview" | "homepage" | "dates" | "coaching" | "tasks" | "journal" | "docs" | "chat";

// Was die beiden Kachel-Bereiche unterscheidet: welche Kacheln es gibt und wie sie heißen.
type BoardConfig = {
  storageKey: string;
  tiles: TileId[];
  stichwort: string;
  overview: { title: string; nameLabel: string; namePlaceholder: string; anbieterLabel: string; zielLabel: string; hours: boolean };
  dateKinds: string[];
  tasks: { title: string; placeholder: string; empty: string };
  journal: { title: string; icon: string; label: string; placeholder: string; empty: string };
  chatPreview: string;
};

const CONFIG: Partial<Record<AreaId, BoardConfig>> = {
  ausbildung: {
    storageKey: "training",
    tiles: ["overview", "dates", "coaching", "tasks", "journal", "docs", "chat"],
    stichwort: "Ausbildung",
    overview: {
      title: "Meine Ausbildung",
      nameLabel: "Name der Ausbildung",
      namePlaceholder: "z. B. Lerncoach Legasthenie, Dyskalkulie, ADHS",
      anbieterLabel: "Ausbildungsinstitut",
      zielLabel: "Mein Ziel / warum ich das mache",
      hours: true,
    },
    dateKinds: ["Modul", "Praxistag", "Supervision", "Prüfung", "Abgabe", "Sonstiges"],
    tasks: { title: "Checkliste", placeholder: "z. B. Hausarbeit Modul 2 abgeben", empty: "Sammle hier, was bis zum Abschluss erledigt sein muss." },
    journal: { title: "Lernjournal", icon: "📝", label: "Was habe ich gelernt, was beschäftigt mich?", placeholder: "z. B. Erkenntnisse aus Modul 2", empty: "Gedanken festhalten" },
    chatPreview: "Reflexion, Zusammenfassung, Ideen",
  },
  lernanker: {
    storageKey: "lernanker",
    tiles: ["overview", "homepage", "dates", "tasks", "journal", "docs", "chat"],
    stichwort: "Lernanker",
    overview: {
      title: "Mein Lernanker",
      nameLabel: "Name des Projekts",
      namePlaceholder: "z. B. Lernanker",
      anbieterLabel: "Zielgruppe",
      zielLabel: "Worum geht es, was ist mein Ziel?",
      hours: false,
    },
    dateKinds: ["Termin", "Veröffentlichung", "Treffen", "Frist", "Sonstiges"],
    tasks: { title: "Checkliste", placeholder: "z. B. Angebot für Elternabend schreiben", empty: "Sammle hier, was für Lernanker zu tun ist." },
    journal: { title: "Ideen & Notizen", icon: "💡", label: "Idee oder Notiz", placeholder: "z. B. Neue Seite: Lerntipps für Eltern", empty: "Ideen sammeln" },
    chatPreview: "Texte, Ideen, Hilfe bei der Homepage",
  },
};

export const hasBoard = (id: AreaId) => id in CONFIG;

function savedTile(key: string): TileId | null {
  try {
    return (localStorage.getItem(key) as TileId) || null;
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

// Übersicht eines Bereichs aus Kacheln, die ihren Inhalt darunter öffnen (wie die Heute-Seite).
export default function Board({ area, chat, setChat }: Props) {
  const config = CONFIG[area.id]!;
  const tileKey = `${config.storageKey}-tile`;
  const [data, setData] = useState<BoardData | null>(null);
  const [tile, setTile] = useState<TileId | null>(() => savedTile(tileKey));
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    loadBoard(config.storageKey, config.stichwort).then(setData);
  }, [config]);

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

  function update(change: (t: BoardData) => BoardData) {
    setData((t) => {
      if (!t) return t;
      const next = change(t);
      saveBoard(config.storageKey, next);
      return next;
    });
  }

  function toggleTile(id: TileId) {
    const next = tile === id ? null : id;
    setTile(next);
    try {
      localStorage.setItem(tileKey, next ?? "");
    } catch {
      // Ohne Speicher startet die Seite eben mit allen Kacheln zu.
    }
  }

  if (!data) return null;

  const upcoming = data.termine.filter((d) => d.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum));
  const nextDate = upcoming[0];
  const openTasks = data.aufgaben.filter((a) => !a.erledigt);
  const doneTasks = data.aufgaben.length - openTasks.length;
  const openSites = data.baustellen.filter((a) => !a.erledigt);
  const hours = coachingHours(data);
  const lastNote = [...data.journal].sort((a, b) => b.datum.localeCompare(a.datum))[0];
  const showHours = config.overview.hours && data.stundenZiel > 0;

  const allTiles: Record<TileId, { icon: string; title: string; count?: number; preview: string }> = {
    overview: { icon: area.icon, title: "Übersicht", preview: data.name || "Eintragen, worum es geht" },
    homepage: {
      icon: "🌐",
      title: "Homepage",
      count: openSites.length,
      preview: openSites[0]?.text ?? (data.homepageUrl ? data.homepageUrl.replace(/^https?:\/\//, "") : "Adresse und Baustellen"),
    },
    dates: {
      icon: "📅",
      title: "Termine",
      count: upcoming.length + calendar.length,
      preview: nextDate ? `${formatDay(nextDate.datum)} ${nextDate.titel}` : calendar[0] ? calendar[0].title : "keine Termine",
    },
    coaching: {
      icon: "💬",
      title: "Lerncoaching",
      count: data.coaching.length,
      preview: data.stundenZiel ? `${hoursLabel(hours)} von ${data.stundenZiel} h` : `${hoursLabel(hours)} gesamt`,
    },
    tasks: {
      icon: "✅",
      title: config.tasks.title,
      count: openTasks.length,
      preview: openTasks[0]?.text ?? (data.aufgaben.length ? "alles erledigt 🌿" : "Aufgaben sammeln"),
    },
    journal: { icon: config.journal.icon, title: config.journal.title, count: data.journal.length, preview: lastNote?.titel ?? config.journal.empty },
    docs: { icon: "📎", title: "Unterlagen", count: data.unterlagen.length, preview: data.unterlagen[0]?.titel ?? "Links sammeln" },
    chat: { icon: "✨", title: "Claude fragen", preview: config.chatPreview },
  };

  return (
    <section className="today board">
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
            ✅ {openTasks.length ? <>{openTasks.length === 1 ? "1 offene Aufgabe" : `${openTasks.length} offene Aufgaben`}, als Nächstes: <strong>{nextTask(openTasks)}</strong></> : "Keine offenen Aufgaben."}
          </li>
          {config.tiles.includes("homepage") && openSites.length > 0 && (
            <li>
              🌐 {openSites.length === 1 ? "1 Baustelle" : `${openSites.length} Baustellen`} an der Homepage, als Nächstes: <strong>{nextTask(openSites)}</strong>
            </li>
          )}
          {(showHours || data.aufgaben.length > 0) && (
            <li className="progress-pair">
              {showHours && (
                <ProgressLine label="Praxisstunden" value={hours} max={data.stundenZiel} text={`${hoursLabel(hours)} von ${data.stundenZiel} h`} />
              )}
              {data.aufgaben.length > 0 && (
                <ProgressLine label={config.tasks.title} value={doneTasks} max={data.aufgaben.length} text={`${doneTasks} von ${data.aufgaben.length} erledigt`} />
              )}
            </li>
          )}
        </ul>
      </article>

      <div className="tiles">
        {config.tiles.map((id) => {
          const t = allTiles[id];
          return (
            <button key={id} className={tile === id ? "tile active" : "tile"} onClick={() => toggleTile(id)}>
              <span className="tile-head">
                <span className="tile-icon">{t.icon}</span>
                {t.count !== undefined && <span className="tile-count">{t.count}</span>}
              </span>
              <span className="tile-title">{t.title}</span>
              <span className="tile-preview">{t.preview}</span>
            </button>
          );
        })}
      </div>

      {tile && config.tiles.includes(tile) && (
        <>
          {tile === "overview" && <Overview data={data} update={update} config={config} />}
          {tile === "homepage" && <Homepage data={data} update={update} />}
          {tile === "dates" && <Dates data={data} calendar={calendar} update={update} kinds={config.dateKinds} />}
          {tile === "coaching" && <Coaching data={data} update={update} />}
          {tile === "tasks" && <Tasks data={data} update={update} field="aufgaben" text={config.tasks} />}
          {tile === "journal" && <Journal data={data} update={update} text={config.journal} />}
          {tile === "docs" && <Docs data={data} update={update} />}
          {tile === "chat" && (
            <article className="card tile-panel board-chat">
              <Chat area={area} chat={chat} setChat={setChat} hideTitle />
            </article>
          )}
        </>
      )}
    </section>
  );
}

type PanelProps = { data: BoardData; update: (change: (t: BoardData) => BoardData) => void };

function nextTask(open: Task[]): string {
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

function Overview({ data, update, config }: PanelProps & { config: BoardConfig }) {
  const o = config.overview;
  const set = (key: keyof BoardData) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    update((t) => ({ ...t, [key]: key === "stundenZiel" ? Number(e.target.value) || 0 : e.target.value }));
  return (
    <article className="card tile-panel">
      <h3>{o.title}</h3>
      <p className="hint">Alles wird sofort gespeichert und bleibt nur auf deinem Mac.</p>
      <div className="form-grid">
        <label className="field">{o.nameLabel}<input value={data.name} onChange={set("name")} placeholder={o.namePlaceholder} /></label>
        <label className="field">{o.anbieterLabel}<input value={data.anbieter} onChange={set("anbieter")} /></label>
        <label className="field">Beginn<input type="date" value={data.start} onChange={set("start")} /></label>
        <label className="field">{o.hours ? "Abschluss" : "Ziel bis"}<input type="date" value={data.ende} onChange={set("ende")} /></label>
        {o.hours && (
          <label className="field">Nötige Praxisstunden<input type="number" min={0} value={data.stundenZiel || ""} onChange={set("stundenZiel")} placeholder="z. B. 30" /></label>
        )}
        <label className="field">Stichwort im Kalender<input value={data.stichwort} onChange={set("stichwort")} placeholder={`z. B. ${config.stichwort}`} /></label>
      </div>
      <label className="field wide">{o.zielLabel}<textarea value={data.ziel} onChange={set("ziel")} /></label>
      <p className="hint">Termine im Kalender, deren Titel oder Kalendername das Stichwort enthält, erscheinen automatisch unter Termine.</p>
    </article>
  );
}

const emptyDate = (art: string) => ({ datum: today(), uhrzeit: "", titel: "", ort: "", art });

function Dates({ data, calendar, update, kinds }: PanelProps & { calendar: CalendarEvent[]; kinds: string[] }) {
  const [form, setForm] = useState(emptyDate(kinds[0]));
  const [showPast, setShowPast] = useState(false);
  const sorted = [...data.termine].sort((a, b) => a.datum.localeCompare(b.datum) || a.uhrzeit.localeCompare(b.uhrzeit));
  const upcoming = sorted.filter((d) => d.datum >= today());
  const past = sorted.filter((d) => d.datum < today()).reverse();

  function add() {
    if (!form.titel.trim() || !form.datum) return;
    update((t) => ({ ...t, termine: [...t.termine, { id: newId(), ...form, titel: form.titel.trim() }] }));
    setForm(emptyDate(kinds[0]));
  }

  const remove = (id: string) => update((t) => ({ ...t, termine: t.termine.filter((d) => d.id !== id) }));

  const row = (d: BoardDate) => (
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
        <label className="field">Was<input value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} placeholder={kinds[0] === "Modul" ? "z. B. Modul 3" : "z. B. Treffen mit Webdesignerin"} /></label>
        <label className="field">Ort<input value={form.ort} onChange={(e) => setForm({ ...form, ort: e.target.value })} /></label>
        <label className="field">Art
          <select value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value })}>
            {kinds.map((a) => <option key={a}>{a}</option>)}
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

const ARTEN = ["Lerncoaching", "Testung / Diagnostik", "Elterngespräch", "Hospitation", "Supervision", "Peer-Übung"];
const SCHWERPUNKTE = ["Legasthenie", "Dyskalkulie", "ADHS"];
const emptySession = () => ({ datum: today(), minuten: "50", art: ARTEN[0], schwerpunkt: SCHWERPUNKTE[0], kuerzel: "", thema: "", reflexion: "" });

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
        <h3>Lerncoaching & Praxis</h3>
        <span className="meta-inline">{hoursLabel(total)}{data.stundenZiel ? ` von ${data.stundenZiel} h` : ""}</span>
      </div>
      {data.stundenZiel > 0 && <ProgressLine label="Fortschritt" value={total} max={data.stundenZiel} text={`${Math.min(100, Math.round((total / data.stundenZiel) * 100))} %`} />}
      <div className="chips coaching-sums">
        {ARTEN.map((a) => {
          const h = data.coaching.filter((s) => s.art === a).reduce((n, s) => n + s.minuten, 0) / 60;
          return h ? <span key={a} className="pill">{a}: {hoursLabel(h)}</span> : null;
        })}
        {SCHWERPUNKTE.map((f) => {
          const n = data.coaching.filter((s) => s.schwerpunkt === f).length;
          return n ? <span key={f} className="pill focus">{f}: {n}×</span> : null;
        })}
      </div>

      <div className="form-grid">
        <label className="field">Datum<input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></label>
        <label className="field">Dauer (Minuten)<input type="number" min={5} step={5} value={form.minuten} onChange={(e) => setForm({ ...form, minuten: e.target.value })} /></label>
        <label className="field">Art
          <select value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value })}>
            {ARTEN.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="field">Schwerpunkt
          <select value={form.schwerpunkt} onChange={(e) => setForm({ ...form, schwerpunkt: e.target.value })}>
            {SCHWERPUNKTE.map((f) => <option key={f}>{f}</option>)}
            <option value="">kein bestimmter</option>
          </select>
        </label>
        <label className="field">Kürzel<input value={form.kuerzel} onChange={(e) => setForm({ ...form, kuerzel: e.target.value })} placeholder="z. B. Kind A" /></label>
      </div>
      <label className="field wide">Thema / Übung<input value={form.thema} placeholder="z. B. Lesetraining mit Silbenbögen" onChange={(e) => setForm({ ...form, thema: e.target.value })} /></label>
      <label className="field wide">Reflexion: Was lief gut, was nehme ich mit?<textarea value={form.reflexion} onChange={(e) => setForm({ ...form, reflexion: e.target.value })} /></label>
      <p className="hint">Bitte nur ein Kürzel statt des Namens des Kindes verwenden.</p>
      <button className="primary" onClick={add}>Sitzung speichern</button>

      <h4>Bisher</h4>
      {sessions.length === 0 && <p>Noch keine Sitzungen eingetragen.</p>}
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.id} className="entry">
            <div className="mail-head" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div>
                <strong>{formatDay(s.datum)}</strong> · {s.art}{s.schwerpunkt && ` · ${s.schwerpunkt}`}{s.kuerzel && ` · ${s.kuerzel}`} · {s.minuten} min
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

type TaskText = { title: string; placeholder: string; empty: string };

function Tasks({ data, update, field, text: labels }: PanelProps & { field: "aufgaben" | "baustellen"; text: TaskText }) {
  return (
    <article className="card tile-panel">
      <h3>{labels.title}</h3>
      <TaskList data={data} update={update} field={field} text={labels} />
    </article>
  );
}

// Abhakliste mit optionaler Frist; dient als Checkliste und als Baustellen-Liste der Homepage.
function TaskList({ data, update, field, text: labels }: PanelProps & { field: "aufgaben" | "baustellen"; text: TaskText }) {
  const [text, setText] = useState("");
  const [frist, setFrist] = useState("");
  const items = data[field];
  const sorted = [...items].sort(
    (a, b) => Number(a.erledigt) - Number(b.erledigt) || (a.frist || "9999").localeCompare(b.frist || "9999"),
  );

  function add() {
    if (!text.trim()) return;
    update((t) => ({ ...t, [field]: [...t[field], { id: newId(), text: text.trim(), frist, erledigt: false }] }));
    setText("");
    setFrist("");
  }

  const toggle = (id: string) =>
    update((t) => ({ ...t, [field]: t[field].map((a) => (a.id === id ? { ...a, erledigt: !a.erledigt } : a)) }));
  const remove = (id: string) => update((t) => ({ ...t, [field]: t[field].filter((a) => a.id !== id) }));

  return (
    <>
      <div className="composer task-add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={labels.placeholder}
        />
        <input type="date" value={frist} onChange={(e) => setFrist(e.target.value)} title="Frist (optional)" />
        <button className="primary" onClick={add} disabled={!text.trim()}>Hinzufügen</button>
      </div>
      {sorted.length === 0 && <p>Noch nichts eingetragen. {labels.empty}</p>}
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
    </>
  );
}

function Homepage({ data, update }: PanelProps) {
  const set = (key: "homepageUrl" | "codeUrl") => (e: ChangeEvent<HTMLInputElement>) => update((t) => ({ ...t, [key]: e.target.value.trim() }));
  const open = (url: string) => /^https?:\/\//.test(url) && openUrl(url);
  return (
    <article className="card tile-panel">
      <h3>Meine Homepage</h3>
      <div className="form-grid">
        <label className="field">Adresse der Homepage<input value={data.homepageUrl} onChange={set("homepageUrl")} placeholder="https://…" /></label>
        <label className="field">Code (z. B. GitHub)<input value={data.codeUrl} onChange={set("codeUrl")} placeholder="https://github.com/…" /></label>
      </div>
      <div className="actions">
        <button onClick={() => open(data.homepageUrl)} disabled={!/^https?:\/\//.test(data.homepageUrl)}>🌐 Homepage öffnen</button>
        <button onClick={() => open(data.codeUrl)} disabled={!/^https?:\/\//.test(data.codeUrl)}>💻 Code öffnen</button>
      </div>
      <h4>Baustellen</h4>
      <TaskList
        data={data}
        update={update}
        field="baustellen"
        text={{ title: "Baustellen", placeholder: "z. B. Startseite: Bild austauschen", empty: "Notiere hier, woran du an der Homepage noch arbeiten willst." }}
      />
    </article>
  );
}

function Journal({ data, update, text: labels }: PanelProps & { text: BoardConfig["journal"] }) {
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
      <h3>{labels.title}</h3>
      <label className="field wide">Überschrift<input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={labels.placeholder} /></label>
      <label className="field wide">{labels.label}<textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} /></label>
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
