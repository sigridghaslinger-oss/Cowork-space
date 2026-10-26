import { useEffect, useState } from "react";
import { classbookFromScreens, type WeekEntry } from "../claude";
import { base64ToBlob, imageToJpeg } from "../images";
import { captureMacWindow } from "../mac";
import { getApiKey, getSetting, setSetting } from "../settings";

const APP_NAME = "Mein Schulplan";
const STORE_KEY = "klassenbuch-woche";

type Entry = WeekEntry & { done: boolean };
type Saved = { erstellt: string; entries: Entry[]; hinweise: string };

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
        <h3>Woche aus Mein Schulplan</h3>
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
          <button className="primary" onClick={write} disabled={busy !== null || shots.length === 0}>
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
