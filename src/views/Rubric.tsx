import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../settings";
import {
  AUSDRUCK,
  DEDUCTIONS,
  ELEMENT_COUNT,
  ELEMENT_GROUPS,
  GRADE_NAMES,
  HALF_STEPS,
  LEVELS,
  evaluate,
  fmtNote,
  minWords,
  type Level,
} from "../school/rubric";

// Bewertete Arbeiten werden nur mit Nummer gespeichert, nie mit Namen.
type Saved = {
  klasse: string;
  nr: string;
  level: Level;
  inhalt: number;
  ausdruck: number;
  fehler: number;
  gesamt: number;
  note: string;
};

const STORE_KEY = "bewertungen-deutsch-diagramm-4";

const emptyChecks = () => Array.from({ length: ELEMENT_COUNT }, () => false);

export default function Rubric() {
  const [klasse, setKlasse] = useState("");
  const [nr, setNr] = useState("");
  const [level, setLevel] = useState<Level>("standard");
  const [words, setWords] = useState("");
  const [errors, setErrors] = useState("");
  const [checked, setChecked] = useState(emptyChecks);
  const [deductions, setDeductions] = useState<string[]>([]);
  const [noDiagram, setNoDiagram] = useState(false);
  const [ausdruck, setAusdruck] = useState(2);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    getSetting<Saved[]>(STORE_KEY).then((s) => setSaved(s ?? []));
  }, []);

  const wordCount = parseInt(words, 10) || 0;
  const errorCount = parseFloat(errors.replace(",", ".")) || 0;
  const ready = wordCount > 0;
  const r = evaluate({ level, words: wordCount, checked, deductions, noDiagram, ausdruck, errors: errorCount });
  const noteText = `${GRADE_NAMES[r.note - 1]} (${r.note}${r.tendency})`;

  let index = 0;

  async function persist(next: Saved[]) {
    setSaved(next);
    await setSetting(STORE_KEY, next);
  }

  async function save() {
    const entry: Saved = { klasse, nr, level, inhalt: r.inhalt, ausdruck, fehler: r.fehler, gesamt: r.gesamt, note: noteText };
    await persist([...saved.filter((s) => !(s.klasse === klasse && s.nr === nr)), entry]);
    // Für die nächste Arbeit: gleiche Klasse und Niveau, Nummer weiterzählen, Rest leeren.
    const n = parseInt(nr, 10);
    setNr(Number.isNaN(n) ? "" : String(n + 1));
    setWords("");
    setErrors("");
    setChecked(emptyChecks());
    setDeductions([]);
    setNoDiagram(false);
    setAusdruck(2);
    setHint(null);
  }

  async function copyList() {
    const rows = sortedSaved.map((s) =>
      [s.klasse, s.nr, LEVELS.find((l) => l.id === s.level)!.label, fmtNote(s.inhalt), fmtNote(s.ausdruck), fmtNote(s.fehler), fmtNote(s.gesamt), s.note].join("\t"),
    );
    const text = ["Klasse\tNr.\tNiveau\tInhalt/Aufbau\tAusdruck\tFehlerquotient\tGesamtwert\tNote", ...rows].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setHint("Liste kopiert. In Excel oder Numbers einfügen mit ⌘V.");
    } catch {
      setHint("Kopieren hat nicht geklappt.");
    }
  }

  async function clearList() {
    if (confirm("Alle gespeicherten Bewertungen löschen?")) await persist([]);
  }

  const sortedSaved = [...saved].sort(
    (a, b) => a.klasse.localeCompare(b.klasse) || (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0),
  );

  return (
    <>
      <article className="card">
        <h3>1. Deutsch-Schularbeit · 4. Klasse · Diagrammbeschreibung</h3>
        <p>Gesamtwert = (2 × Inhalt/Aufbau + Ausdruck + Fehlerquotient) : 4</p>

        <div className="form-grid rubric-top">
          <label className="field">
            Klasse
            <input value={klasse} placeholder="z. B. 4C" onChange={(e) => setKlasse(e.target.value)} />
          </label>
          <label className="field">
            Nr. (statt Name)
            <input value={nr} inputMode="numeric" placeholder="z. B. 1" onChange={(e) => setNr(e.target.value)} />
          </label>
          <label className="field">
            Niveau
            <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              {LEVELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} ({l.minWords} W.)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Wörter
            <input value={words} inputMode="numeric" onChange={(e) => setWords(e.target.value)} />
          </label>
          <label className="field">
            Fehler
            <input value={errors} inputMode="decimal" placeholder="Beistrich = 0,5" onChange={(e) => setErrors(e.target.value)} />
          </label>
        </div>

        <div className="rubric-cols">
          <div>
            <h4>Inhalt/Aufbau · {r.elements} von {ELEMENT_COUNT} Elementen</h4>
            {ELEMENT_GROUPS.map((g) => (
              <div key={g.title} className="rubric-group">
                <div className="rubric-group-title">{g.title}</div>
                {g.items.map((item) => {
                  const i = index++;
                  return (
                    <label key={item} className="check">
                      <input
                        type="checkbox"
                        checked={checked[i]}
                        onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
                      />
                      {i + 1}. {item}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>

          <div>
            <h4>Abzüge bei Inhalt/Aufbau</h4>
            {DEDUCTIONS.map((d) => (
              <label key={d.id} className="check">
                <input
                  type="checkbox"
                  checked={deductions.includes(d.id)}
                  onChange={(e) =>
                    setDeductions(e.target.checked ? [...deductions, d.id] : deductions.filter((x) => x !== d.id))
                  }
                />
                {d.label} (−{fmtNote(d.value)})
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={noDiagram} onChange={(e) => setNoDiagram(e.target.checked)} />
              Kein Diagramm beschrieben, nur Meinung (Inhalt/Aufbau 5)
            </label>
            {ready && r.wordDeduction > 0 && (
              <p className="hint">
                Unter {minWords(level)} Wörtern: automatisch −{fmtNote(r.wordDeduction)}
                {r.wordDeduction === 1 ? " (mehr als 10 % zu kurz)" : " (bis zu 10 % zu kurz)"}
              </p>
            )}

            <h4>Ausdruck</h4>
            <select value={ausdruck} onChange={(e) => setAusdruck(Number(e.target.value))}>
              {HALF_STEPS.map((n) => (
                <option key={n} value={n}>
                  {fmtNote(n)}
                  {AUSDRUCK.find((a) => a.note === n) ? ` · ${AUSDRUCK.find((a) => a.note === n)!.text}` : ""}
                </option>
              ))}
            </select>
            <p className="hint">Halbe Noten, wenn der Text zwischen zwei Beschreibungen liegt. AHS mit höherem Anspruch.</p>
          </div>
        </div>
      </article>

      <article className="card plan rubric-result">
        {ready ? (
          <>
            <table className="grades">
              <tbody>
                <tr>
                  <td>Inhalt/Aufbau (× 2)</td>
                  <td>
                    {fmtNote(r.inhalt)}
                    {r.inhalt !== r.inhaltBase && !noDiagram && <span className="meta-inline"> ({fmtNote(r.inhaltBase)} vor Abzügen)</span>}
                  </td>
                </tr>
                <tr>
                  <td>Ausdruck</td>
                  <td>{fmtNote(ausdruck)}</td>
                </tr>
                <tr>
                  <td>Fehlerquotient</td>
                  <td>
                    {fmtNote(r.fehler)} <span className="meta-inline">(FQ {r.fq.toLocaleString("de-DE", { minimumFractionDigits: 1 })})</span>
                  </td>
                </tr>
                <tr>
                  <td>Gesamtwert</td>
                  <td>{r.gesamt.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
            <div className="rubric-note">{noteText}</div>
            {r.reason && <p className="hint">{r.reason}</p>}
            <div className="actions">
              <button className="primary" onClick={save} disabled={!klasse.trim() || !nr.trim()}>
                Speichern und nächste Arbeit
              </button>
              {(!klasse.trim() || !nr.trim()) && <span className="meta-inline">Zum Speichern Klasse und Nr. eintragen.</span>}
            </div>
          </>
        ) : (
          <p>Trag die Wortzahl ein, dann siehst du hier Teilnoten, Gesamtwert und Note.</p>
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
          {hint && <p className="hint">{hint}</p>}
        </article>
      )}
    </>
  );
}
