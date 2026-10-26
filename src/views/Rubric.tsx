import { useEffect, useState } from "react";
import { getSetting, setSetting, getApiKey } from "../settings";
import { gradeScan, rubricFromKey, type GradeSuggestion, type ScanFile } from "../claude";
import RubricEditor from "./RubricEditor";
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
type Saved = {
  klasse: string;
  nr: string;
  level: string;
  parts: number[];
  gesamt: number;
  note: string;
};

const storeKey = (id: string) => `bewertungen:${id}`;

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
      <ImportKey
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
            Schularbeit
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {rubrics.length === 0 && <option value="">Noch keine Schularbeit angelegt</option>}
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
            <button className="primary" onClick={() => setMode({ kind: "import" })}>Aus Notenschlüssel erstellen</button>
            <button onClick={() => setMode({ kind: "edit", rubric: blankRubric(), isNew: true })}>Selbst anlegen</button>
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

function ImportKey({ onDone, onCancel }: { onDone: (r: Rubric) => void; onCancel: () => void }) {
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await rubricFromKey(apiKey, { pdf: pdf?.data, text: text.trim() || undefined });
      onDone(fromDraft(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <h3>Schularbeit aus Notenschlüssel erstellen</h3>
      <p>Claude liest deinen Notenschlüssel und legt daraus die Kriterien an. Danach kannst du alles prüfen und anpassen.</p>
      <label className="field wide">
        Notenschlüssel als PDF
        <input
          type="file"
          accept="application/pdf"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setPdf(f ? { name: f.name, data: await fileToBase64(f) } : null);
          }}
        />
      </label>
      <label className="field wide">
        … oder Text hineinkopieren
        <textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="actions">
        <button className="primary" onClick={run} disabled={busy || (!pdf && !text.trim())}>
          {busy ? "Claude liest…" : "Kriterien erstellen"}
        </button>
        <button onClick={onCancel} disabled={busy}>Abbrechen</button>
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

  useEffect(() => {
    getSetting<Saved[]>(storeKey(rubric.id)).then((s) => setSaved(s ?? []));
  }, [rubric.id]);

  const needWords = usesWords(rubric);
  const needErrors = usesErrors(rubric);
  const wordCount = parseInt(words, 10) || 0;
  const errorCount = parseFloat(errors.replace(",", ".")) || 0;
  const ready = rubric.criteria.length > 0 && (!needWords || wordCount > 0);
  const r = evaluate(rubric, { level, words: wordCount, errors: errorCount, values });
  const noteText = `${GRADE_NAMES[r.note - 1]} (${r.note}${r.tendency})`;
  const levelLabel = rubric.levels.find((l) => l.id === level)?.label ?? "";

  const setValue = (id: string, patch: Partial<CriterionInput>) => setValues({ ...values, [id]: { ...values[id], ...patch } });

  function applySuggestion(s: GradeSuggestion) {
    setSuggestion(s);
    if (needWords && s.words > 0) setWords(String(Math.round(s.words)));
    if (needErrors) setErrors(fmtNote(Math.round(s.errors * 2) / 2));
    const next = { ...values };
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

  async function save() {
    const entry: Saved = { klasse, nr, level: levelLabel, parts: r.parts.map((p) => p.note), gesamt: r.gesamt, note: noteText };
    await persist([...saved.filter((s) => !(s.klasse === klasse && s.nr === nr)), entry]);
    // Für die nächste Arbeit: gleiche Klasse und Niveau, Nummer weiterzählen, Rest leeren.
    const n = parseInt(nr, 10);
    setNr(Number.isNaN(n) ? "" : String(n + 1));
    setWords("");
    setErrors("");
    setValues(fresh());
    setSuggestion(null);
    setHint(null);
    setScanKey((k) => k + 1);
  }

  const sortedSaved = [...saved].sort(
    (a, b) => a.klasse.localeCompare(b.klasse) || (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0),
  );

  async function copyText(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setHint(ok);
    } catch {
      setHint("Kopieren hat nicht geklappt.");
    }
  }

  function copyList() {
    const head = ["Klasse", "Nr.", "Niveau", ...rubric.criteria.map((c) => c.name), "Gesamtwert", "Note"].join("\t");
    const rows = sortedSaved.map((s) => [s.klasse, s.nr, s.level, ...s.parts.map(fmtNote), fmtNote(s.gesamt), s.note].join("\t"));
    copyText([head, ...rows].join("\n"), "Liste kopiert. In Excel oder Numbers einfügen mit ⌘V.");
  }

  async function clearList() {
    if (confirm("Alle gespeicherten Bewertungen dieser Schularbeit löschen?")) await persist([]);
  }

  return (
    <>
      <article className="card">
        <h3>
          {rubric.title}
          {rubric.klasse ? ` · ${rubric.klasse}` : ""}
        </h3>
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

        <Scan key={scanKey} rubric={rubric} levelLabel={levelLabel} onResult={applySuggestion} />

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
            <div className="rubric-note">{noteText}</div>
            {r.reason && <p className="hint">{r.reason}</p>}
            {suggestion?.feedback && (
              <div className="feedback">
                <div className="rubric-group-title">Rückmeldung für das Kind (Vorschlag)</div>
                <p>{suggestion.feedback}</p>
                <button onClick={() => copyText(suggestion.feedback, "Rückmeldung kopiert.")}>Rückmeldung kopieren</button>
              </div>
            )}
            <div className="actions">
              <button className="primary" onClick={save} disabled={!klasse.trim() || !nr.trim()}>
                Speichern und nächste Arbeit
              </button>
              {(!klasse.trim() || !nr.trim()) && <span className="meta-inline">Zum Speichern Klasse und Nr. eintragen.</span>}
            </div>
          </>
        ) : (
          <p>{needWords ? "Trag die Wortzahl ein oder lass Claude die Arbeit lesen" : "Fülle die Kriterien aus"}, dann siehst du hier Teilnoten, Gesamtwert und Note.</p>
        )}
      </article>

      {saved.length > 0 && (
        <article className="card">
          <div className="row">
            <h3>Bewertete Arbeiten ({saved.length})</h3>
            <div className="actions">
              <button onClick={copyList}>Liste kopieren</button>
              <button onClick={clearList}>Liste leeren</button>
            </div>
          </div>
          <table className="grades">
            <tbody>
              {sortedSaved.map((s) => (
                <tr key={`${s.klasse}-${s.nr}`}>
                  <td>{s.klasse}</td>
                  <td>Nr. {s.nr}</td>
                  <td>{fmtNote(s.gesamt)}</td>
                  <td>{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}
      {hint && <p className="hint">{hint}</p>}
    </>
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

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(f);
  });
}

// Fotos verkleinern und als JPEG schicken: kleiner, schneller und unter der Größengrenze der API.
function imageToJpeg(f: File, maxSide = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild nicht lesbar"));
    };
    img.src = url;
  });
}
