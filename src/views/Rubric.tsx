import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting, getApiKey } from "../settings";
import { gradeScan, rubricFromKey, type GradeSuggestion, type ScanFile } from "../claude";
import RubricEditor from "./RubricEditor";
import {
  guessClass,
  linkClass,
  loadLinks,
  planbuchClasses,
  unlinkClass,
  writeGrades,
  type NotenbuchLink,
  type PlanbuchClass,
} from "../school/notenbuch";
import { addToBatch, canRetry, clearBatch, markDone, removeItem, retryItem, useBatch, type BatchItem } from "../school/batch";
import { fileToBase64, imageToJpeg } from "../images";
import {
  DIAGRAMM_4,
  GRADE_NAMES,
  HALF_STEPS,
  blankRubric,
  describeRubric,
  emptyInput,
  evaluate,
  fmtNote,
  fromDraft,
  itemCount,
  loadRubrics,
  newId,
  saveRubrics,
  usesErrors,
  usesWords,
  type CriterionInput,
  type Rubric,
} from "../school/rubric";

// Bewertete Arbeiten werden nur mit Nummer gespeichert, nie mit Namen.
// Die Felder ab levelId gibt es erst seit der Änderungsfunktion; ältere Einträge haben sie nicht.
type Saved = {
  klasse: string;
  nr: string;
  level: string;
  parts: number[];
  gesamt: number;
  note: string;
  levelId?: string;
  grade?: number;
  words?: number;
  errors?: number;
  values?: Record<string, CriterionInput>;
  suggestion?: GradeSuggestion;
  own?: string; // selbst eingetragene Note, z. B. "2−"; leer = wie vorgeschlagen
};

const storeKey = (id: string) => `bewertungen:${id}`;
const SIZES_KEY = "klassengroessen";

type Mode = { kind: "grade" } | { kind: "edit"; rubric: Rubric; isNew: boolean } | { kind: "import" };

export default function Rubrics() {
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "grade" });

  useEffect(() => {
    loadRubrics().then((list) => {
      setRubrics(list);
      setSelected(list[0]?.id ?? "");
    });
  }, []);

  async function persist(next: Rubric[]) {
    setRubrics(next);
    await saveRubrics(next);
  }

  async function saveRubric(r: Rubric) {
    const exists = rubrics.some((x) => x.id === r.id);
    await persist(exists ? rubrics.map((x) => (x.id === r.id ? r : x)) : [...rubrics, r]);
    setSelected(r.id);
    setMode({ kind: "grade" });
  }

  async function deleteRubric(id: string) {
    if (!confirm("Diese Schularbeit samt Kriterien löschen? Gespeicherte Bewertungen bleiben erhalten.")) return;
    const next = rubrics.filter((x) => x.id !== id);
    await persist(next);
    setSelected(next[0]?.id ?? "");
    setMode({ kind: "grade" });
  }

  const rubric = rubrics.find((r) => r.id === selected);

  if (mode.kind === "edit") {
    return (
      <RubricEditor
        key={mode.rubric.id}
        initial={mode.rubric}
        isNew={mode.isNew}
        onSave={saveRubric}
        onCancel={() => setMode({ kind: "grade" })}
        onDelete={mode.isNew ? undefined : () => deleteRubric(mode.rubric.id)}
      />
    );
  }

  if (mode.kind === "import") {
    return (
      <NewExam
        onDone={(r) => setMode({ kind: "edit", rubric: r, isNew: true })}
        onCancel={() => setMode({ kind: "grade" })}
      />
    );
  }

  return (
    <>
      <article className="card">
        <div className="rubric-picker">
          <label className="field">
            Schularbeit, Test oder Diktat
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {rubrics.length === 0 && <option value="">Noch nichts angelegt</option>}
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.klasse ? ` · ${r.klasse}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            {rubric && <button onClick={() => setMode({ kind: "edit", rubric, isNew: false })}>Kriterien bearbeiten</button>}
            {rubric && (
              <button onClick={() => setMode({ kind: "edit", rubric: { ...structuredClone(rubric), id: newId(), title: `${rubric.title} (Kopie)` }, isNew: true })}>
                Kopieren
              </button>
            )}
            <button className="primary" onClick={() => setMode({ kind: "import" })}>+ Neue Schularbeit / Test / Diktat</button>
          </div>
        </div>
        {rubrics.length === 0 && (
          <p className="hint">
            Leg eine Schularbeit an, oder hol dir die Diagrammbeschreibung zurück:{" "}
            <button className="ghost" onClick={() => persist([DIAGRAMM_4]).then(() => setSelected(DIAGRAMM_4.id))}>
              Beispiel wiederherstellen
            </button>
          </p>
        )}
      </article>

      {rubric && <Grader key={rubric.id} rubric={rubric} />}
    </>
  );
}

const ARTEN = ["Schularbeit", "Test", "Diktat"];

// Neue Schularbeit, neuer Test oder neues Diktat: Eckdaten eintragen und den Notenschlüssel hochladen.
function NewExam({ onDone, onCancel }: { onDone: (r: Rubric) => void; onCancel: () => void }) {
  const [art, setArt] = useState("Schularbeit");
  const [title, setTitle] = useState("");
  const [klasse, setKlasse] = useState("");
  const [datum, setDatum] = useState("");
  const [files, setFiles] = useState<{ name: string; file: ScanFile }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickKey, setPickKey] = useState(0);

  // Was Sigrid oben einträgt, gilt vor dem, was Claude aus dem Notenschlüssel liest.
  const withBasics = (r: Rubric): Rubric => ({
    ...r,
    title: title.trim() || r.title || art,
    klasse: klasse.trim() || r.klasse,
    datum: datum || r.datum,
  });

  async function pick(list: FileList | null) {
    if (!list) return;
    setError(null);
    try {
      const added = await Promise.all(
        Array.from(list).map(async (f) => ({
          name: f.name,
          file: (f.type === "application/pdf"
            ? { kind: "pdf", data: await fileToBase64(f) }
            : { kind: "image", data: await imageToJpeg(f) }) as ScanFile,
        })),
      );
      setFiles([...files, ...added]);
    } catch {
      setError("Eine Datei konnte nicht gelesen werden. Bitte als PDF, JPEG oder PNG speichern. Word-Dateien vorher als PDF sichern.");
    } finally {
      setPickKey((k) => k + 1);
    }
  }

  async function run() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await rubricFromKey(apiKey, { files: files.map((f) => f.file), text: text.trim() || undefined, art });
      onDone(withBasics(fromDraft(draft)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <h3>Neue Schularbeit, neuer Test oder neues Diktat</h3>
      <div className="form-grid rubric-top">
        <label className="field">
          Art
          <select value={art} onChange={(e) => setArt(e.target.value)}>
            {ARTEN.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Titel
          <input value={title} placeholder={`z. B. 2. ${art}: Erörterung`} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Klasse
          <input value={klasse} placeholder="z. B. 4C" onChange={(e) => setKlasse(e.target.value)} />
        </label>
        <label className="field">
          Datum
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>
      </div>

      <div className="scan">
        <strong>📎 Notenschlüssel mit allen Kriterien hochladen</strong>
        <p className="hint">
          PDF oder Fotos, auch mehrere Seiten. Claude liest daraus die Kriterien, Gewichtung und Notengrenzen. Danach kannst du alles prüfen und
          anpassen.
        </p>
        <div className="actions">
          <label className="file-button">
            Dateien wählen
            <input key={pickKey} type="file" multiple accept="application/pdf,image/*" onChange={(e) => pick(e.target.files)} />
          </label>
          {files.map((f, i) => (
            <span key={i} className="pill file-pill">
              {f.name}
              <button className="ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Entfernen">×</button>
            </span>
          ))}
        </div>
        <label className="field wide">
          … oder den Notenschlüssel als Text hineinkopieren
          <textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>

      <div className="actions">
        <button className="primary" onClick={run} disabled={busy || (files.length === 0 && !text.trim())}>
          {busy ? "Claude liest den Notenschlüssel…" : "Kriterien hochladen und anlegen"}
        </button>
        <button onClick={() => onDone(withBasics(blankRubric()))} disabled={busy}>
          Ohne Notenschlüssel, Kriterien selbst eintragen
        </button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Abbrechen</button>
      </div>
      {busy && <p className="hint">Das dauert etwa eine Minute.</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

function Grader({ rubric }: { rubric: Rubric }) {
  const fresh = () => Object.fromEntries(rubric.criteria.map((c) => [c.id, emptyInput(c)]));
  const [klasse, setKlasse] = useState("");
  const [nr, setNr] = useState("");
  const [level, setLevel] = useState(rubric.levels[0]?.id ?? "");
  const [words, setWords] = useState("");
  const [errors, setErrors] = useState("");
  const [values, setValues] = useState<Record<string, CriterionInput>>(fresh);
  const [suggestion, setSuggestion] = useState<GradeSuggestion | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);
  // Was gerade im Formular liegt: eine gespeicherte Arbeit zum Ändern oder eine Arbeit aus dem Stapel.
  const [editing, setEditing] = useState<{ klasse: string; nr: string } | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const [links, setLinks] = useState<Record<string, NotenbuchLink>>({});
  const batch = useBatch(rubric.id);
  const top = useRef<HTMLElement>(null);

  useEffect(() => {
    getSetting<Saved[]>(storeKey(rubric.id)).then((s) => setSaved(s ?? []));
    loadLinks(rubric.id).then(setLinks);
  }, [rubric.id]);

  const needWords = usesWords(rubric);
  const needErrors = usesErrors(rubric);
  const wordCount = parseInt(words, 10) || 0;
  const errorCount = parseFloat(errors.replace(",", ".")) || 0;
  const ready = rubric.criteria.length > 0 && (!needWords || wordCount > 0);
  const r = evaluate(rubric, { level, words: wordCount, errors: errorCount, values });
  const suggested = `${r.note}${r.tendency}`;
  const finalNote = own || suggested;
  const finalGrade = parseInt(finalNote, 10);
  const noteText = `${GRADE_NAMES[finalGrade - 1]} (${finalNote})`;
  const levelLabel = rubric.levels.find((l) => l.id === level)?.label ?? "";

  const setValue = (id: string, patch: Partial<CriterionInput>) => setValues({ ...values, [id]: { ...values[id], ...patch } });

  function applySuggestion(s: GradeSuggestion, base = values) {
    setSuggestion(s);
    if (needWords && s.words > 0) setWords(String(Math.round(s.words)));
    if (needErrors) setErrors(fmtNote(Math.round(s.errors * 2) / 2));
    const next = { ...base };
    for (const c of rubric.criteria) {
      const g = s.criteria.find((x) => x.id === c.id);
      if (!g) continue;
      const v = { ...emptyInput(c) };
      if (c.kind === "checklist") {
        v.checked = v.checked.map((_, i) => g.checked.includes(i));
        v.deductions = v.deductions.map((_, i) => g.deductions.includes(i));
        v.failed = g.failed;
      } else if (c.kind === "scale") {
        v.note = HALF_STEPS.reduce((best, n) => (Math.abs(n - g.note) < Math.abs(best - g.note) ? n : best), 2);
      }
      next[c.id] = v;
    }
    setValues(next);
  }

  async function persist(next: Saved[]) {
    setSaved(next);
    await setSetting(storeKey(rubric.id), next);
  }

  function clearForm() {
    setWords("");
    setErrors("");
    setValues(fresh());
    setSuggestion(null);
    setOwn("");
    setHint(null);
    setScanKey((k) => k + 1);
  }

  function showForm() {
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Eine gespeicherte Arbeit zurück ins Formular holen.
  function openSaved(s: Saved) {
    clearForm();
    setKlasse(s.klasse);
    setNr(s.nr);
    setLevel(s.levelId ?? rubric.levels.find((l) => l.label === s.level)?.id ?? rubric.levels[0]?.id ?? "");
    setWords(s.words ? String(s.words) : "");
    setErrors(s.errors !== undefined ? fmtNote(s.errors) : "");
    setValues(restoreValues(rubric, s.values));
    if (s.suggestion) setSuggestion(s.suggestion);
    setOwn(s.own ?? "");
    setEditing({ klasse: s.klasse, nr: s.nr });
    setBatchId(null);
    if (!s.values) setHint("Diese Arbeit wurde mit einer älteren Version gespeichert. Bitte die Kriterien noch einmal anhaken.");
    showForm();
  }

  // Eine von Claude vorbewertete Arbeit aus dem Stapel ins Formular holen.
  function openBatch(item: BatchItem) {
    clearForm();
    setKlasse(item.klasse);
    setNr(item.nr);
    setLevel(item.level);
    if (item.suggestion) applySuggestion(item.suggestion, fresh());
    const old = saved.find((s) => s.klasse === item.klasse && s.nr === item.nr);
    setEditing(old ? { klasse: old.klasse, nr: old.nr } : null);
    setBatchId(item.id);
    showForm();
  }

  function stopEditing() {
    clearForm();
    setEditing(null);
    setBatchId(null);
    setNr("");
  }

  async function save() {
    const entry: Saved = {
      klasse,
      nr,
      level: levelLabel,
      levelId: level,
      parts: r.parts.map((p) => p.note),
      gesamt: r.gesamt,
      note: noteText,
      grade: finalGrade,
      own: own || undefined,
      words: wordCount,
      errors: errorCount,
      values,
      suggestion: suggestion ?? undefined,
    };
    const same = (s: Saved, k: { klasse: string; nr: string }) => s.klasse === k.klasse && s.nr === k.nr;
    await persist([...saved.filter((s) => !same(s, entry) && !(editing && same(s, editing))), entry]);
    const book = await toNotenbuch(entry);
    clearForm();
    setEditing(null);
    if (book) setHint(book);
    if (batchId) {
      markDone(rubric.id, batchId);
      const next = batch.find((x) => x.status === "fertig" && x.id !== batchId);
      if (next) {
        openBatch(next);
        setHint(`${book ?? "Gespeichert."} Weiter mit ${next.klasse} Nr. ${next.nr}.`);
      } else {
        setBatchId(null);
        setNr("");
        setHint(`${book ?? "Gespeichert."} Im Stapel ist gerade nichts mehr zum Durchsehen.`);
      }
    } else if (editing) {
      setNr("");
      if (!book) setHint("Änderung gespeichert.");
    } else {
      // Für die nächste Arbeit: gleiche Klasse und Niveau, Nummer weiterzählen.
      const n = parseInt(nr, 10);
      setNr(Number.isNaN(n) ? "" : String(n + 1));
    }
  }

  // Nach dem Speichern auch ins Notenbuch des Planbuchs, wenn die Klasse verbunden ist.
  async function toNotenbuch(entry: Saved): Promise<string | null> {
    const link = links[entry.klasse];
    if (!link) return null;
    try {
      const w = await writeGrades(link, [{ nr: entry.nr, note: finalOf(entry) }]);
      return w.written
        ? `Gespeichert und im Notenbuch (${w.className}) eingetragen.`
        : `Gespeichert. Im Notenbuch (${w.className}) gibt es keine Nr. ${entry.nr}, bitte dort die Schülerliste prüfen.`;
    } catch (e) {
      return `Gespeichert, aber nicht im Notenbuch: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function copyText(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setHint(ok);
    } catch {
      setHint("Kopieren hat nicht geklappt.");
    }
  }

  function copyList() {
    const sorted = [...saved].sort(bySeat);
    const head = ["Klasse", "Nr.", "Niveau", ...rubric.criteria.map((c) => c.name), "Gesamtwert", "Note"].join("\t");
    const rows = sorted.map((s) => [s.klasse, s.nr, s.level, ...s.parts.map(fmtNote), fmtNote(s.gesamt), s.note].join("\t"));
    copyText([head, ...rows].join("\n"), "Liste kopiert. In Excel oder Numbers einfügen mit ⌘V.");
  }

  async function clearList() {
    if (confirm("Alle gespeicherten Bewertungen dieser Schularbeit löschen?")) await persist([]);
  }

  async function removeSaved(s: Saved) {
    if (!confirm(`Bewertung von ${s.klasse} Nr. ${s.nr} löschen?`)) return;
    await persist(saved.filter((x) => !(x.klasse === s.klasse && x.nr === s.nr)));
    if (editing && editing.klasse === s.klasse && editing.nr === s.nr) stopEditing();
  }

  const toReview = batch.filter((x) => x.status === "fertig" && x.id !== batchId).length;

  return (
    <>
      <article className="card" ref={top}>
        <h3>
          {rubric.title}
          {rubric.klasse ? ` · ${rubric.klasse}` : ""}
        </h3>
        {(editing || batchId) && (
          <div className="editing-banner">
            <span>
              {batchId
                ? `Aus dem Stapel: ${klasse} Nr. ${nr}. Claude hat vorbewertet, bitte prüfen.${toReview ? ` Danach noch ${toReview} zum Durchsehen.` : ""}`
                : `Du änderst die gespeicherte Bewertung von ${editing!.klasse} Nr. ${editing!.nr}.`}
              {batchId && editing && " Für diese Nr. gibt es schon eine Bewertung, sie wird ersetzt."}
            </span>
            <button onClick={stopEditing}>{batchId ? "Später" : "Abbrechen"}</button>
          </div>
        )}
        <div className="form-grid rubric-top">
          <label className="field">
            Klasse
            <input value={klasse} placeholder="z. B. 4C" onChange={(e) => setKlasse(e.target.value)} />
          </label>
          <label className="field">
            Nr. (statt Name)
            <input value={nr} inputMode="numeric" placeholder="z. B. 1" onChange={(e) => setNr(e.target.value)} />
          </label>
          {rubric.levels.length > 1 && (
            <label className="field">
              Niveau
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                {rubric.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                    {l.minWords ? ` (${l.minWords} W.)` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needWords && (
            <label className="field">
              Wörter
              <input value={words} inputMode="numeric" onChange={(e) => setWords(e.target.value)} />
            </label>
          )}
          {needErrors && (
            <label className="field">
              Fehler
              <input value={errors} inputMode="decimal" placeholder="Beistrich = 0,5" onChange={(e) => setErrors(e.target.value)} />
            </label>
          )}
        </div>

        {!batchId && <Scan key={scanKey} rubric={rubric} levelLabel={levelLabel} onResult={applySuggestion} />}
        {batchId && suggestion && (suggestion.hinweise || !suggestion.readable) && (
          <p className="claude-comment">
            {[suggestion.readable ? "" : "Claude konnte Teile der Arbeit nicht lesen.", suggestion.hinweise].filter(Boolean).join(" ")}
          </p>
        )}

        <div className="rubric-cols">
          {rubric.criteria.map((c) => {
            const v = values[c.id] ?? emptyInput(c);
            const part = r.parts.find((p) => p.id === c.id)!;
            const comment = suggestion?.criteria.find((x) => x.id === c.id)?.comment;
            let index = 0;
            return (
              <div key={c.id}>
                <h4>
                  {c.name} {c.weight !== 1 && `(× ${fmtNote(c.weight)})`}
                  {c.kind === "checklist" && ` · ${v.checked.filter(Boolean).length} von ${itemCount(c)}`}
                </h4>
                {comment && <p className="claude-comment">Claude: {comment}</p>}
                {c.kind === "checklist" && (
                  <>
                    {c.groups.map((g, gi) => (
                      <div key={gi} className="rubric-group">
                        {g.title && <div className="rubric-group-title">{g.title}</div>}
                        {g.items.map((item) => {
                          const i = index++;
                          return (
                            <label key={i} className="check">
                              <input
                                type="checkbox"
                                checked={v.checked[i] ?? false}
                                onChange={(e) => setValue(c.id, { checked: v.checked.map((x, j) => (j === i ? e.target.checked : x)) })}
                              />
                              {i + 1}. {item}
                            </label>
                          );
                        })}
                      </div>
                    ))}
                    {c.deductions.length > 0 && <div className="rubric-group-title">Abzüge</div>}
                    {c.deductions.map((d, i) => (
                      <label key={i} className="check">
                        <input
                          type="checkbox"
                          checked={v.deductions[i] ?? false}
                          onChange={(e) =>
                            setValue(c.id, { deductions: v.deductions.map((x, j) => (j === i ? e.target.checked : x)) })
                          }
                        />
                        {d.label} (−{fmtNote(d.value)})
                      </label>
                    ))}
                    {c.failLabel && (
                      <label className="check">
                        <input type="checkbox" checked={v.failed} onChange={(e) => setValue(c.id, { failed: e.target.checked })} />
                        {c.failLabel} (Teilnote 5)
                      </label>
                    )}
                    {ready && (part.wordDeduction ?? 0) > 0 && (
                      <p className="hint">
                        Zu wenige Wörter: automatisch −{fmtNote(part.wordDeduction!)}
                        {part.wordDeduction === 1 ? " (mehr als 10 % zu kurz)" : " (bis zu 10 % zu kurz)"}
                      </p>
                    )}
                  </>
                )}
                {c.kind === "scale" && (
                  <>
                    <select value={v.note} onChange={(e) => setValue(c.id, { note: Number(e.target.value) })}>
                      {HALF_STEPS.map((n) => (
                        <option key={n} value={n}>
                          {fmtNote(n)}
                          {Number.isInteger(n) && c.descriptions[n - 1] ? ` · ${c.descriptions[n - 1]}` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="hint">Halbe Noten, wenn der Text zwischen zwei Beschreibungen liegt.</p>
                  </>
                )}
                {c.kind === "fq" && (
                  <p className="hint">
                    {ready
                      ? `Fehlerquotient ${part.fq!.toLocaleString("de-DE", { minimumFractionDigits: 1 })} → Teilnote ${fmtNote(part.note)}`
                      : "Wird aus Wörtern und Fehlern berechnet."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </article>

      <article className="card plan rubric-result">
        {ready ? (
          <>
            <table className="grades">
              <tbody>
                {r.parts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {p.weight !== 1 && ` (× ${fmtNote(p.weight)})`}
                    </td>
                    <td>
                      {fmtNote(p.note)}
                      {p.base !== undefined && p.base !== p.note && p.note < 5 && (
                        <span className="meta-inline"> ({fmtNote(p.base)} vor Abzügen)</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Gesamtwert</td>
                  <td>{r.gesamt.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
            <div className="note-pair">
              <div className={own ? "note-box muted" : "note-box"}>
                <div className="rubric-group-title">{suggestion ? "Vorschlag (Claude + Notenschlüssel)" : "Vorschlag nach Notenschlüssel"}</div>
                <div className="rubric-note">
                  {GRADE_NAMES[r.note - 1]} ({suggested})
                </div>
                {r.reason && <p className="hint">{r.reason}</p>}
              </div>
              <div className={own ? "note-box mine" : "note-box"}>
                <label className="rubric-group-title" htmlFor="own-note">Meine Note</label>
                <select id="own-note" value={own} onChange={(e) => setOwn(e.target.value)}>
                  <option value="">wie vorgeschlagen ({suggested})</option>
                  {OWN_NOTES.map((n) => (
                    <option key={n} value={n}>
                      {n} · {GRADE_NAMES[parseInt(n, 10) - 1]}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  {own ? `Gespeichert wird ${noteText}.` : "Wähl hier deine Note, wenn du anders entscheidest."}
                  {links[klasse] ? " Sie kommt auch ins Notenbuch." : ""}
                </p>
              </div>
            </div>
            {suggestion?.feedback && (
              <div className="feedback">
                <div className="rubric-group-title">Rückmeldung für das Kind (Vorschlag)</div>
                <p>{suggestion.feedback}</p>
                <button onClick={() => copyText(suggestion.feedback, "Rückmeldung kopiert.")}>Rückmeldung kopieren</button>
              </div>
            )}
            <div className="actions">
              <button className="primary" onClick={save} disabled={!klasse.trim() || !nr.trim()}>
                {batchId ? "Speichern und nächste aus dem Stapel" : editing ? "Änderung speichern" : "Speichern und nächste Arbeit"}
              </button>
              {(!klasse.trim() || !nr.trim()) && <span className="meta-inline">Zum Speichern Klasse und Nr. eintragen.</span>}
            </div>
          </>
        ) : (
          <p>{needWords ? "Trag die Wortzahl ein oder lass Claude die Arbeit lesen" : "Fülle die Kriterien aus"}, dann siehst du hier Teilnoten, Gesamtwert und Note.</p>
        )}
        {hint && <p className="hint">{hint}</p>}
      </article>

      <BatchPanel rubric={rubric} items={batch} klasse={klasse} level={level} current={batchId} onOpen={openBatch} />

      {saved.length > 0 && (
        <ClassOverview
          rubric={rubric}
          links={links}
          onLinks={setLinks}
          saved={saved}
          editing={editing}
          onOpen={openSaved}
          onRemove={removeSaved}
          onCopy={copyList}
          onClear={clearList}
        />
      )}
    </>
  );
}

const OWN_NOTES = ["1", "1−", "2+", "2", "2−", "3+", "3", "3−", "4+", "4", "4−", "5"];

// Die Note, die zählt: selbst eingetragen, sonst die vorgeschlagene aus dem Notentext „Gut (2+)“.
const finalOf = (s: Saved) => s.own || s.note.match(/\(([^)]+)\)/)?.[1] || String(s.grade ?? "");

const bySeat = (a: Saved, b: Saved) =>
  a.klasse.localeCompare(b.klasse) || (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0) || a.nr.localeCompare(b.nr);

// Note als Zahl 1–5; ältere Einträge haben nur den Text, z. B. "Gut (2−)".
const gradeOf = (s: Saved) => s.grade ?? (parseInt(s.note.match(/\((\d)/)?.[1] ?? "", 10) || 0);

// Gespeicherte Häkchen nur übernehmen, wenn die Kriterien seither gleich geblieben sind.
function restoreValues(rubric: Rubric, stored: Record<string, CriterionInput> | undefined) {
  return Object.fromEntries(
    rubric.criteria.map((c) => {
      const empty = emptyInput(c);
      const v = stored?.[c.id];
      const fits = v && v.checked.length === empty.checked.length && v.deductions.length === empty.deductions.length;
      return [c.id, fits ? v : empty];
    }),
  );
}

// Viele Arbeiten auf einmal einscannen: Claude bewertet im Hintergrund, Sigrid sieht danach eine nach der anderen durch.
function BatchPanel({
  rubric,
  items,
  klasse: defaultKlasse,
  level: defaultLevel,
  current,
  onOpen,
}: {
  rubric: Rubric;
  items: BatchItem[];
  klasse: string;
  level: string;
  current: string | null;
  onOpen: (item: BatchItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<{ name: string; file: ScanFile }[]>([]);
  const [klasse, setKlasse] = useState(defaultKlasse);
  const [level, setLevel] = useState(defaultLevel);
  const [startNr, setStartNr] = useState("1");
  const [perWork, setPerWork] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickKey, setPickKey] = useState(0);

  const per = Math.max(1, parseInt(perWork, 10) || 1);
  const start = parseInt(startNr, 10) || 1;
  const works: { name: string; file: ScanFile }[][] = [];
  for (let i = 0; i < files.length; i += per) works.push(files.slice(i, i + per));

  async function pick(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    setError(null);
    try {
      const sorted = Array.from(list).sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
      const added = await Promise.all(
        sorted.map(async (f) => ({
          name: f.name,
          file: (f.type === "application/pdf"
            ? { kind: "pdf", data: await fileToBase64(f) }
            : { kind: "image", data: await imageToJpeg(f) }) as ScanFile,
        })),
      );
      setFiles([...files, ...added]);
    } catch {
      setError("Eine Datei konnte nicht gelesen werden. Bitte als JPEG, PNG oder PDF speichern.");
    } finally {
      setBusy(false);
      setPickKey((k) => k + 1);
    }
  }

  function start_() {
    addToBatch(
      rubric,
      works.map((w, i) => ({ klasse: klasse.trim(), nr: String(start + i), level, files: w })),
    );
    setStartNr(String(start + works.length));
    setFiles([]);
  }

  const count = (s: BatchItem["status"]) => items.filter((x) => x.status === s).length;
  const waiting = count("wartet") + count("liest");
  const ready = count("fertig");
  const sorted = [...items].sort((a, b) => a.klasse.localeCompare(b.klasse) || (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0));
  const statusText: Record<BatchItem["status"], string> = {
    wartet: "wartet",
    liest: "Claude liest…",
    fertig: "bereit zum Durchsehen",
    fehler: "Fehler",
    erledigt: "✓ gespeichert",
  };

  return (
    <article className="card">
      <div className="row">
        <div>
          <h3>📚 Stapel: mehrere Arbeiten auf einmal</h3>
          <p className="hint">
            {items.length === 0
              ? "Alle Scans einer Klasse hochladen. Claude bewertet sie nacheinander, du siehst sie danach der Reihe nach durch."
              : [waiting && `Claude liest noch ${waiting}`, ready && `${ready} bereit zum Durchsehen`, count("erledigt") && `${count("erledigt")} gespeichert`, count("fehler") && `${count("fehler")} mit Fehler`]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <div className="actions">
          {ready > 0 && (
            <button className="primary" onClick={() => onOpen(sorted.find((x) => x.status === "fertig" && x.id !== current) ?? sorted.find((x) => x.status === "fertig")!)}>
              Durchsehen starten
            </button>
          )}
          <button onClick={() => setOpen(!open)}>{open ? "Zuklappen" : "Arbeiten hinzufügen"}</button>
        </div>
      </div>

      {open && (
        <div className="scan">
          <div className="form-grid rubric-top">
            <label className="field">
              Klasse
              <input value={klasse} placeholder="z. B. 4C" onChange={(e) => setKlasse(e.target.value)} />
            </label>
            <label className="field">
              Erste Nr.
              <input value={startNr} inputMode="numeric" onChange={(e) => setStartNr(e.target.value)} />
            </label>
            <label className="field">
              Seiten pro Arbeit
              <input value={perWork} inputMode="numeric" onChange={(e) => setPerWork(e.target.value)} />
            </label>
            {rubric.levels.length > 1 && (
              <label className="field">
                Niveau
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  {rubric.levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="hint">
            Die Dateien werden nach Namen sortiert und der Reihe nach durchnummeriert. Ein PDF pro Kind? Dann „Seiten pro Arbeit“ auf 1
            lassen. Einzelne Fotos? Dann die Seitenzahl einer Arbeit eintragen. Namen auf den Blättern am besten abdecken.
            Unterschiedliches Niveau kannst du beim Durchsehen noch ändern.
          </p>
          <div className="actions">
            <label className="file-button">
              Dateien wählen
              <input key={pickKey} type="file" multiple accept="image/*,application/pdf" onChange={(e) => pick(e.target.files)} />
            </label>
            {files.length > 0 && <button onClick={() => setFiles([])}>Auswahl leeren</button>}
            <button className="primary" onClick={start_} disabled={busy || works.length === 0 || !klasse.trim()}>
              {works.length > 0 ? `${works.length} ${works.length === 1 ? "Arbeit" : "Arbeiten"} von Claude bewerten lassen` : "Von Claude bewerten lassen"}
            </button>
          </div>
          {busy && <p className="hint">Dateien werden vorbereitet…</p>}
          {!klasse.trim() && files.length > 0 && <p className="hint">Bitte noch die Klasse eintragen.</p>}
          {works.length > 0 && (
            <table className="grades">
              <tbody>
                {works.map((w, i) => (
                  <tr key={i}>
                    <td>Nr. {start + i}</td>
                    <td className="meta-inline">{w.map((f) => f.name).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {per > 1 && files.length % per !== 0 && (
            <p className="error">
              {files.length} Seiten passen nicht genau zu {per} Seiten pro Arbeit. Die letzte Arbeit hat nur {files.length % per}.
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {items.length > 0 && (
        <>
          <table className="grades batch">
            <tbody>
              {sorted.map((x) => (
                <tr key={x.id} className={x.id === current ? "current" : ""}>
                  <td>{x.klasse}</td>
                  <td>Nr. {x.nr}</td>
                  <td className={`batch-${x.status}`}>
                    {statusText[x.status]}
                    {x.error && <span className="meta-inline"> · {x.error}</span>}
                  </td>
                  <td className="actions">
                    {(x.status === "fertig" || x.status === "erledigt") && x.id !== current && (
                      <button onClick={() => onOpen(x)}>{x.status === "fertig" ? "Durchsehen" : "Nochmal öffnen"}</button>
                    )}
                    {x.status === "fehler" && canRetry(x.id) && <button onClick={() => retryItem(rubric, x.id)}>Nochmal versuchen</button>}
                    {x.status !== "liest" && x.id !== current && (
                      <button className="ghost" onClick={() => removeItem(rubric.id, x.id)} aria-label="Entfernen">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {waiting > 0 && <p className="hint">Pro Arbeit etwa ein bis zwei Minuten, Claude liest drei gleichzeitig. Du kannst inzwischen schon durchsehen.</p>}
          <div className="actions">
            {count("erledigt") > 0 && <button onClick={() => clearBatch(rubric.id, true)}>Gespeicherte entfernen</button>}
            {waiting === 0 && (
              <button
                onClick={() => {
                  if (confirm("Den ganzen Stapel leeren? Bereits gespeicherte Bewertungen bleiben erhalten.")) clearBatch(rubric.id, false);
                }}
              >
                Stapel leeren
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// Übersicht je Klasse als Kacheln: Notenspiegel, Durchschnitt und welche Nummern noch fehlen.
function ClassOverview({
  rubric,
  links,
  onLinks,
  saved,
  editing,
  onOpen,
  onRemove,
  onCopy,
  onClear,
}: {
  rubric: Rubric;
  links: Record<string, NotenbuchLink>;
  onLinks: (l: Record<string, NotenbuchLink>) => void;
  saved: Saved[];
  editing: { klasse: string; nr: string } | null;
  onOpen: (s: Saved) => void;
  onRemove: (s: Saved) => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [openKlasse, setOpenKlasse] = useState<string | null>(null);
  const [pbClasses, setPbClasses] = useState<PlanbuchClass[]>([]);
  const [pick, setPick] = useState("");
  const [bookHint, setBookHint] = useState<string | null>(null);
  const [bookBusy, setBookBusy] = useState(false);

  useEffect(() => {
    getSetting<Record<string, number>>(SIZES_KEY).then((s) => setSizes(s ?? {}));
    planbuchClasses().then(setPbClasses).catch(() => setPbClasses([]));
  }, []);

  function toggle(k: string) {
    const next = openKlasse === k ? null : k;
    setOpenKlasse(next);
    setPick(next ? guessClass(next, pbClasses) : "");
    setBookHint(null);
  }

  async function transfer(k: string, classId?: string) {
    setBookBusy(true);
    setBookHint(null);
    try {
      let link = links[k];
      if (classId) {
        link = await linkClass(rubric, k, classId);
        onLinks({ ...links, [k]: link });
      }
      const list = saved.filter((s) => s.klasse === k);
      const w = await writeGrades(link, list.map((s) => ({ nr: s.nr, note: finalOf(s) })));
      setBookHint(
        `${w.written} ${w.written === 1 ? "Note" : "Noten"} im Notenbuch (${w.className}) eingetragen.` +
          (w.unknown.length ? ` Keine passende Nr. in der Schülerliste für: ${w.unknown.join(", ")}.` : ""),
      );
    } catch (e) {
      setBookHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBookBusy(false);
    }
  }

  async function unlink(k: string) {
    await unlinkClass(rubric.id, k);
    const next = { ...links };
    delete next[k];
    onLinks(next);
    setPick(guessClass(k, pbClasses));
    setBookHint("Verbindung getrennt. Die Noten im Notenbuch bleiben stehen.");
  }

  async function setSize(k: string, n: number) {
    const next = { ...sizes, [k]: n };
    if (!n) delete next[k];
    setSizes(next);
    await setSetting(SIZES_KEY, next);
  }

  const classes = [...new Set(saved.map((s) => s.klasse))].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const stats = (k: string) => {
    const list = saved.filter((s) => s.klasse === k).sort(bySeat);
    const grades = list.map(gradeOf).filter((g) => g >= 1 && g <= 5);
    const spiegel = [1, 2, 3, 4, 5].map((g) => grades.filter((x) => x === g).length);
    const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : 0;
    const size = sizes[k] ?? 0;
    const done = new Set(list.map((s) => s.nr));
    const missing = size ? Array.from({ length: size }, (_, i) => String(i + 1)).filter((n) => !done.has(n)) : [];
    return { list, spiegel, avg, size, missing, n: grades.length };
  };
  const fmtAvg = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shown = openKlasse && classes.includes(openKlasse) ? openKlasse : null;
  const st = shown ? stats(shown) : null;

  return (
    <article className="card">
      <div className="row">
        <h3>Bewertete Arbeiten ({saved.length})</h3>
        <div className="actions">
          <button onClick={onCopy}>Liste kopieren</button>
          <button onClick={onClear}>Liste leeren</button>
        </div>
      </div>
      <div className="tiles">
        {classes.map((k) => {
          const s = stats(k);
          return (
            <button key={k} className={shown === k ? "tile active" : "tile"} onClick={() => toggle(k)}>
              <span className="tile-head">
                <span className="tile-icon">🏫</span>
                <span className="tile-count">Ø {s.n ? fmtAvg(s.avg) : "–"}</span>
              </span>
              <span className="tile-title">{k}</span>
              <span className="tile-preview">
                {s.size ? `${s.list.length} von ${s.size} bewertet` : `${s.list.length} bewertet`}
                {s.missing.length > 0 && ` · ${s.missing.length} fehlen`}
              </span>
              <span className="mini-spiegel" aria-hidden>
                {s.spiegel.map((c, i) => (
                  <span key={i} style={{ height: `${s.n ? 4 + (c / Math.max(...s.spiegel)) * 24 : 4}px` }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {shown && st && (
        <div className="tile-panel class-panel">
          <div className="row">
            <div>
              <h4>Notenspiegel {shown}</h4>
              <table className="grades spiegel">
                <tbody>
                  {st.spiegel.map((c, i) => (
                    <tr key={i}>
                      <td>{GRADE_NAMES[i]}</td>
                      <td>{c}</td>
                      <td>
                        <span className="bar" style={{ width: `${st.n ? (c / st.n) * 160 : 0}px` }} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Durchschnitt</td>
                    <td colSpan={2}>
                      <strong>{st.n ? fmtAvg(st.avg) : "–"}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              {st.n > 0 && st.spiegel[4] * 2 > st.n && (
                <p className="error">
                  Mehr als die Hälfte Nicht genügend: Laut Leistungsbeurteilungsverordnung ist die Schularbeit dann einmal zu wiederholen.
                </p>
              )}
            </div>
            <div>
              <h4>Wer fehlt noch?</h4>
              <label className="field">
                Kinder in der Klasse
                <input
                  value={st.size || ""}
                  inputMode="numeric"
                  placeholder="z. B. 22"
                  onChange={(e) => setSize(shown, parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <p className="hint">
                {!st.size
                  ? "Trag ein, wie viele Kinder in der Klasse sind, dann siehst du, welche Nummern noch fehlen."
                  : st.missing.length
                    ? `Noch nicht bewertet: Nr. ${st.missing.join(", ")}`
                    : "Alle Arbeiten bewertet. 🎉"}
              </p>
            </div>
          </div>

          <h4>Notenbuch im Planbuch</h4>
          {links[shown] ? (
            <div className="actions">
              <span>
                Verbunden mit <strong>{pbClasses.find((c) => c.id === links[shown].classId)?.name ?? "?"}</strong>, Spalte „{rubric.title}“.
                Neue Bewertungen kommen beim Speichern automatisch dazu.
              </span>
              <button onClick={() => transfer(shown)} disabled={bookBusy}>Alle Noten nochmal übertragen</button>
              <button className="ghost" onClick={() => unlink(shown)}>Trennen</button>
            </div>
          ) : pbClasses.length === 0 ? (
            <p className="hint">Im Planbuch sind noch keine Klassen angelegt.</p>
          ) : (
            <div className="actions">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Klasse im Planbuch wählen…</option>
                {pbClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={() => transfer(shown, pick)} disabled={!pick || bookBusy}>
                Verbinden und Noten übertragen
              </button>
            </div>
          )}
          <p className="hint">
            {bookHint ??
              "Im Notenbuch entsteht eine Spalte „Schularbeit / Test“ mit dem Titel dieser Arbeit. Die Nr. wird mit der Katalognummer in der Schülerliste verbunden. Übertragen wird deine Note, sonst die vorgeschlagene."}
          </p>

          <h4>Alle Arbeiten</h4>
          <table className="grades">
            <tbody>
              {st.list.map((s) => (
                <tr key={s.nr} className={editing?.klasse === s.klasse && editing.nr === s.nr ? "current" : ""}>
                  <td>Nr. {s.nr}</td>
                  <td>{s.level}</td>
                  <td>{fmtNote(s.gesamt)}</td>
                  <td>{s.note}</td>
                  <td className="actions">
                    <button onClick={() => onOpen(s)}>Ändern</button>
                    <button className="ghost" onClick={() => onRemove(s)} aria-label="Löschen">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function Scan({ rubric, levelLabel, onResult }: { rubric: Rubric; levelLabel: string; onResult: (s: GradeSuggestion) => void }) {
  const [files, setFiles] = useState<{ name: string; file: ScanFile }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list) return;
    setError(null);
    try {
      const added = await Promise.all(
        Array.from(list).map(async (f) => ({
          name: f.name,
          file: (f.type === "application/pdf"
            ? { kind: "pdf", data: await fileToBase64(f) }
            : { kind: "image", data: await imageToJpeg(f) }) as ScanFile,
        })),
      );
      setFiles([...files, ...added]);
    } catch {
      setError("Eine Datei konnte nicht gelesen werden. Bitte als JPEG, PNG oder PDF speichern.");
    }
  }

  async function run() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotes(null);
    try {
      const s = await gradeScan(apiKey, describeRubric(rubric), levelLabel, files.map((f) => f.file));
      onResult(s);
      setNotes(
        [s.readable ? "" : "Claude konnte Teile der Arbeit nicht lesen.", s.hinweise].filter(Boolean).join(" ") ||
          "Claude hat die Kriterien unten vorausgefüllt. Bitte prüfen und bei Bedarf ändern.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scan">
      <div className="row">
        <div>
          <strong>📄 Arbeit einscannen und von Claude bewerten lassen</strong>
          <p className="hint">
            Fotos oder PDF, alle Seiten einer Arbeit. Tipp: Rechtsklick auf den Schreibtisch → „Von iPhone importieren“ →
            „Dokumente scannen“. Den Namen auf dem Blatt am besten abdecken.
          </p>
        </div>
      </div>
      <div className="actions">
        <label className="file-button">
          Seiten wählen
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => pick(e.target.files)} />
        </label>
        {files.map((f, i) => (
          <span key={i} className="pill file-pill">
            {f.name}
            <button className="ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Entfernen">×</button>
          </span>
        ))}
        <button className="primary" onClick={run} disabled={busy || files.length === 0}>
          {busy ? "Claude liest die Arbeit…" : "Von Claude bewerten lassen"}
        </button>
      </div>
      {busy && <p className="hint">Das dauert ein bis zwei Minuten.</p>}
      {notes && <p className="claude-comment">{notes}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
