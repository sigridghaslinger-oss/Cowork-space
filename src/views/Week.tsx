import { useEffect, useState } from "react";
import { classbookFromScreens, type WeekEntry } from "../claude";
import { base64ToBlob, imageToJpeg } from "../images";
import { captureMacWindow } from "../mac";
import { openPlanbuch } from "../planbuch/db";
import { getApiKey, getSetting, setSetting } from "../settings";

const APP_NAME = "Mein Schulplan";
const STORE_KEY = "klassenbuch-woche";

type Entry = WeekEntry & { done: boolean };
type Saved = { erstellt: string; entries: Entry[]; hinweise: string };

const DAYNAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function mondayOf(offsetWeeks: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7);
  return d;
}

type PlanSettings = {
  classes?: { id: string; name: string; subject?: string }[];
  holidays?: { from: string; to: string }[];
};

// Liest die geplanten Stunden einer Woche aus dem Planbuch: je Stunde das Thema als Eintrag.
async function entriesFromPlanbuch(monday: Date): Promise<Entry[]> {
  const db = await openPlanbuch();
  const settings = (db.get("plan/settings") ?? {}) as PlanSettings;
  const days = [0, 1, 2, 3, 4].map((i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return ymd(d);
  });
  const isHoliday = (day: string) => (settings.holidays ?? []).some((h) => day >= h.from && day <= h.to);
  type Lesson = { date: string; period: number; classId: string; topic?: string; status?: string };
  return db
    .all("lessons")
    .map((l) => l.data as unknown as Lesson)
    .filter((l) => days.includes(l.date) && !isHoliday(l.date) && l.topic?.trim() && l.status !== "entfaellt" && l.status !== "frei")
    .sort((a, b) => (a.date === b.date ? a.period - b.period : a.date < b.date ? -1 : 1))
    .map((l) => {
      const c = settings.classes?.find((x) => x.id === l.classId);
      const [, m, d] = l.date.split("-").map(Number);
      return {
        tag: DAYNAMES[days.indexOf(l.date)],
        datum: `${d}.${m}.`,
        stunde: `${l.period}.`,
        klasse: c?.name ?? "",
        fach: c?.subject ?? "",
        eintrag: l.topic!.trim(),
        unsicher: false,
        done: false,
      };
    });
}

// Wochenansicht aus „Mein Schulplan“ abfotografieren, Claude schreibt die Klassenbucheinträge.
export default function Week() {
  const [shots, setShots] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState<"capture" | "write" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    getSetting<Saved>(STORE_KEY).then((s) => s && setSaved(s));
  }, []);

  async function persist(next: Saved | null) {
    setSaved(next);
    await setSetting(STORE_KEY, next);
  }

  async function capture() {
    setError(null);
    setBusy("capture");
    try {
      const png = await captureMacWindow(APP_NAME);
      const jpeg = await imageToJpeg(base64ToBlob(png, "image/png"));
      setShots((s) => [...s, jpeg]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function fromPlanbuch(offsetWeeks: number) {
    setError(null);
    try {
      const monday = mondayOf(offsetWeeks);
      const entries = await entriesFromPlanbuch(monday);
      if (entries.length === 0) {
        setError("In dieser Woche stehen im Planbuch keine Stunden mit Thema.");
        return;
      }
      await persist({ erstellt: new Date().toISOString(), entries, hinweise: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const added = await Promise.all([...files].map((f) => imageToJpeg(f)));
      setShots((s) => [...s, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function write() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setError(null);
    setBusy("write");
    try {
      const result = await classbookFromScreens(apiKey, shots);
      await persist({
        erstellt: new Date().toISOString(),
        entries: result.entries.map((e) => ({ ...e, done: false })),
        hinweise: result.hinweise,
      });
      setShots([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function update(i: number, patch: Partial<Entry>) {
    if (!saved) return;
    persist({ ...saved, entries: saved.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  }

  async function copy(i: number) {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.entries[i].eintrag);
      setCopied(i);
    } catch {
      setError("Kopieren hat nicht geklappt. Markiere den Text und drücke ⌘C.");
    }
  }

  const days = saved ? [...new Set(saved.entries.map((e) => e.tag))] : [];
  const open = saved ? saved.entries.filter((e) => !e.done).length : 0;

  return (
    <>
      <article className="card">
        <h3>Klassenbuch für eine Woche</h3>
        <p className="hint">Am schnellsten: Die Themen kommen direkt aus deinem Planbuch.</p>
        <div className="actions">
          <button className="primary" onClick={() => fromPlanbuch(0)} disabled={busy !== null}>
            Diese Woche aus dem Planbuch
          </button>
          <button onClick={() => fromPlanbuch(-1)} disabled={busy !== null}>
            Letzte Woche aus dem Planbuch
          </button>
        </div>
        <h4>Oder aus Mein Schulplan</h4>
        <ol className="steps">
          <li>Öffne „{APP_NAME}“ in der Wochenansicht und mach das Fenster groß.</li>
          <li>Klicke auf „Abfotografieren“. Ist die Woche zu lang, scroll weiter und fotografiere nochmal.</li>
          <li>Klicke auf „Einträge erstellen“.</li>
        </ol>
        <div className="actions">
          <button onClick={capture} disabled={busy !== null}>
            {busy === "capture" ? "Fotografiert…" : `${APP_NAME} abfotografieren`}
          </button>
          <label className="file-button">
            Bild hinzufügen
            <input type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} />
          </label>
          <button onClick={write} disabled={busy !== null || shots.length === 0}>
            {busy === "write" ? "Claude schreibt…" : "Einträge erstellen"}
          </button>
        </div>
        {shots.length > 0 && (
          <div className="shots">
            {shots.map((s, i) => (
              <figure key={i}>
                <img src={`data:image/jpeg;base64,${s}`} alt={`Bild ${i + 1}`} />
                <button onClick={() => setShots(shots.filter((_, j) => j !== i))}>Entfernen</button>
              </figure>
            ))}
          </div>
        )}
        {busy === "write" && <p className="hint">Das dauert etwa eine Minute.</p>}
        {error && <p className="error">{error}</p>}
      </article>

      {saved && (
        <article className="card">
          <div className="row">
            <h3>Einträge ({open} offen)</h3>
            <button onClick={() => persist(null)}>Liste leeren</button>
          </div>
          <p className="hint">
            Erstellt am {new Date(saved.erstellt).toLocaleDateString("de-DE")}. Kopieren, in EduPage einfügen (⌘V) und dann abhaken.
          </p>
          {saved.hinweise && <p className="claude-comment">{saved.hinweise}</p>}
          {days.map((tag) => (
            <section key={tag} className="week-day">
              <h4>{tag}</h4>
              {saved.entries.map((e, i) =>
                e.tag !== tag ? null : (
                  <div key={i} className={e.done ? "week-entry done" : "week-entry"}>
                    <div className="week-meta">
                      {[e.datum, e.stunde && `${e.stunde.replace(/\.$/, "")}. Stunde`, e.klasse, e.fach].filter(Boolean).join(" · ")}
                      {e.unsicher && <span className="badge">bitte prüfen</span>}
                    </div>
                    <textarea value={e.eintrag} rows={2} onChange={(ev) => update(i, { eintrag: ev.target.value })} />
                    <div className="actions">
                      <button onClick={() => copy(i)}>{copied === i ? "Kopiert ✓" : "Kopieren"}</button>
                      <label className="check">
                        <input type="checkbox" checked={e.done} onChange={(ev) => update(i, { done: ev.target.checked })} />
                        In EduPage eingetragen
                      </label>
                    </div>
                  </div>
                ),
              )}
            </section>
          ))}
        </article>
      )}
    </>
  );
}
