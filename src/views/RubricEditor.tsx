import { useState } from "react";
import {
  HALF_STEPS,
  KIND_LABELS,
  blankCriterion,
  fmtNote,
  newId,
  type Criterion,
  type Rubric,
} from "../school/rubric";

type Props = {
  initial: Rubric;
  isNew: boolean;
  onSave: (r: Rubric) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

const num = (s: string) => parseFloat(s.replace(",", ".")) || 0;

// Elemente als Text: eine Zeile pro Element, Zeilen mit ":" am Ende sind Überschriften.
const groupsToText = (groups: { title: string; items: string[] }[]) =>
  groups.map((g) => [g.title ? `${g.title}:` : "", ...g.items].filter(Boolean).join("\n")).join("\n");

function textToGroups(text: string) {
  const groups: { title: string; items: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":")) groups.push({ title: line.slice(0, -1).trim(), items: [] });
    else {
      if (groups.length === 0) groups.push({ title: "", items: [] });
      groups[groups.length - 1].items.push(line);
    }
  }
  return groups.length ? groups : [{ title: "", items: [] }];
}

// Abzüge als Text: "Bezeichnung = 0,5" pro Zeile.
const deductionsToText = (d: { label: string; value: number }[]) => d.map((x) => `${x.label} = ${fmtNote(x.value)}`).join("\n");

function textToDeductions(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf("=");
      return i === -1 ? { label: l, value: 0.5 } : { label: l.slice(0, i).trim(), value: num(l.slice(i + 1)) };
    });
}

export default function RubricEditor({ initial, isNew, onSave, onCancel, onDelete }: Props) {
  const [r, setR] = useState<Rubric>(initial);
  // Textfelder getrennt halten, damit beim Tippen nichts umsortiert wird.
  const [texts, setTexts] = useState<Record<string, { groups: string; deductions: string }>>(() =>
    Object.fromEntries(
      initial.criteria
        .filter((c) => c.kind === "checklist")
        .map((c) => [c.id, { groups: groupsToText(c.groups), deductions: deductionsToText(c.deductions) }]),
    ),
  );

  const set = (patch: Partial<Rubric>) => setR({ ...r, ...patch });
  const setCrit = (id: string, patch: Partial<Criterion>) =>
    set({ criteria: r.criteria.map((c) => (c.id === id ? ({ ...c, ...patch } as Criterion) : c)) });

  function addCriterion(kind: Criterion["kind"]) {
    const c = blankCriterion(kind);
    if (c.kind === "checklist") setTexts({ ...texts, [c.id]: { groups: "", deductions: "" } });
    set({ criteria: [...r.criteria, c] });
  }

  function removeCriterion(id: string) {
    set({
      criteria: r.criteria.filter((c) => c.id !== id),
      decisive: r.decisive === id ? "" : r.decisive,
      knockout: r.knockout === id ? "" : r.knockout,
    });
  }

  function move(id: string, dir: -1 | 1) {
    const i = r.criteria.findIndex((c) => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= r.criteria.length) return;
    const next = [...r.criteria];
    [next[i], next[j]] = [next[j], next[i]];
    set({ criteria: next });
  }

  function save() {
    const criteria = r.criteria.map((c) =>
      c.kind === "checklist" && texts[c.id]
        ? { ...c, groups: textToGroups(texts[c.id].groups), deductions: textToDeductions(texts[c.id].deductions) }
        : c,
    );
    onSave({ ...r, title: r.title.trim() || "Neue Schularbeit", criteria });
  }

  const totalWeight = r.criteria.reduce((s, c) => s + c.weight, 0);

  return (
    <>
      <article className="card">
        <h3>{isNew ? "Neue Schularbeit anlegen" : "Schularbeit bearbeiten"}</h3>
        <div className="form-grid rubric-top">
          <label className="field">
            Name
            <input value={r.title} placeholder="z. B. 2. Deutsch-SA: Erörterung" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="field">
            Klasse
            <input value={r.klasse} placeholder="z. B. 4C, 4D" onChange={(e) => set({ klasse: e.target.value })} />
          </label>
          <label className="field">
            Datum
            <input type="date" value={r.datum} onChange={(e) => set({ datum: e.target.value })} />
          </label>
        </div>
        <label className="field wide">
          Aufgabenstellung (hilft Claude beim Bewerten)
          <textarea value={r.aufgabe} onChange={(e) => set({ aufgabe: e.target.value })} />
        </label>

        <h4>Niveaus</h4>
        {r.levels.map((l) => (
          <div key={l.id} className="editor-row">
            <input
              value={l.label}
              placeholder="z. B. Standard"
              onChange={(e) => set({ levels: r.levels.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) })}
            />
            <input
              value={l.minWords ?? ""}
              inputMode="numeric"
              placeholder="Mindestwörter (optional)"
              onChange={(e) =>
                set({
                  levels: r.levels.map((x) => (x.id === l.id ? { ...x, minWords: parseInt(e.target.value, 10) || null } : x)),
                })
              }
            />
            {r.levels.length > 1 && (
              <button onClick={() => set({ levels: r.levels.filter((x) => x.id !== l.id) })}>Entfernen</button>
            )}
          </div>
        ))}
        <button onClick={() => set({ levels: [...r.levels, { id: newId(), label: "", minWords: null }] })}>+ Niveau</button>
      </article>

      {r.criteria.map((c, idx) => (
        <article key={c.id} className="card">
          <div className="row">
            <h3>
              Teilbereich {idx + 1}: {c.name || "ohne Namen"}
            </h3>
            <div className="actions">
              <button onClick={() => move(c.id, -1)} disabled={idx === 0}>↑</button>
              <button onClick={() => move(c.id, 1)} disabled={idx === r.criteria.length - 1}>↓</button>
              <button onClick={() => removeCriterion(c.id)}>Entfernen</button>
            </div>
          </div>
          <p className="hint">{KIND_LABELS[c.kind]}</p>
          <div className="form-grid">
            <label className="field">
              Name
              <input value={c.name} placeholder="z. B. Inhalt" onChange={(e) => setCrit(c.id, { name: e.target.value })} />
            </label>
            <label className="field">
              Gewichtung
              <input
                defaultValue={fmtNote(c.weight)}
                inputMode="decimal"
                onBlur={(e) => setCrit(c.id, { weight: num(e.target.value) || 1 })}
              />
            </label>
            {c.kind === "checklist" && (
              <label className="field">
                Notenschritt pro fehlendem Element
                <select value={c.step} onChange={(e) => setCrit(c.id, { step: Number(e.target.value) })}>
                  {[0.25, 0.5, 1].map((s) => (
                    <option key={s} value={s}>{fmtNote(s)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {c.kind === "checklist" && (
            <>
              <label className="field wide">
                Elemente (eine Zeile pro Element, Überschriften mit „:“ am Ende, „[AHS]“ am Anfang = nur für AHS verlangt)
                <textarea
                  className="tall"
                  value={texts[c.id]?.groups ?? ""}
                  placeholder={"Einleitung:\nThema genannt\nQuelle genannt\nHauptteil:\n…\n[AHS] Gegenargument entkräftet"}
                  onChange={(e) => setTexts({ ...texts, [c.id]: { ...texts[c.id], groups: e.target.value } })}
                />
              </label>
              <label className="field wide">
                Abzüge (eine Zeile pro Abzug, z. B. „Keine Absätze = 0,5“)
                <textarea
                  value={texts[c.id]?.deductions ?? ""}
                  onChange={(e) => setTexts({ ...texts, [c.id]: { ...texts[c.id], deductions: e.target.value } })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={c.wordRule} onChange={(e) => setCrit(c.id, { wordRule: e.target.checked })} />
                Abzug bei zu wenigen Wörtern (−0,5 bis 10 % darunter, sonst −1)
              </label>
              <label className="field wide">
                Teilnote automatisch 5, wenn … (leer lassen, wenn es das nicht gibt)
                <input
                  value={c.failLabel}
                  placeholder="z. B. Thema verfehlt"
                  onChange={(e) => setCrit(c.id, { failLabel: e.target.value })}
                />
              </label>
            </>
          )}

          {c.kind === "scale" &&
            c.descriptions.map((d, i) => (
              <label key={i} className="field wide">
                Note {i + 1}
                <input
                  value={d}
                  onChange={(e) =>
                    setCrit(c.id, { descriptions: c.descriptions.map((x, j) => (j === i ? e.target.value : x)) })
                  }
                />
              </label>
            ))}

          {c.kind === "fq" && (
            <>
              <p className="hint">Höchster Fehlerquotient für die jeweilige Teilnote. Darüber gibt es eine 5.</p>
              <table className="grades limits">
                <thead>
                  <tr>
                    <td>Teilnote</td>
                    {r.levels.map((l) => (
                      <td key={l.id}>{l.label || "Niveau"}</td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HALF_STEPS.slice(0, 8).map((step, i) => (
                    <tr key={step}>
                      <td>{fmtNote(step)}</td>
                      {r.levels.map((l) => (
                        <td key={l.id}>
                          <input
                            defaultValue={c.limits[l.id]?.[i] !== undefined ? fmtNote(c.limits[l.id][i]) : ""}
                            inputMode="decimal"
                            placeholder="bis"
                            onBlur={(e) => {
                              const row = [...(c.limits[l.id] ?? [])];
                              row[i] = num(e.target.value);
                              setCrit(c.id, { limits: { ...c.limits, [l.id]: row } });
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="field wide">
                Zählregeln für Fehler
                <textarea value={c.rules} onChange={(e) => setCrit(c.id, { rules: e.target.value })} />
              </label>
            </>
          )}
        </article>
      ))}

      <article className="card">
        <h3>Teilbereich hinzufügen</h3>
        <div className="actions">
          {(Object.keys(KIND_LABELS) as Criterion["kind"][]).map((k) => (
            <button key={k} onClick={() => addCriterion(k)}>+ {KIND_LABELS[k]}</button>
          ))}
        </div>
        {r.criteria.length > 0 && (
          <>
            <h4>Sonderregeln</h4>
            <div className="form-grid">
              <label className="field">
                Bei Grenzfall auf x,50 entscheidet
                <select value={r.decisive} onChange={(e) => set({ decisive: e.target.value })}>
                  <option value="">niemand (schlechtere Note)</option>
                  {r.criteria.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || "ohne Namen"}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Teilnote 5 bedeutet Nicht genügend bei
                <select value={r.knockout} onChange={(e) => set({ knockout: e.target.value })}>
                  <option value="">keinem Teilbereich</option>
                  {r.criteria.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || "ohne Namen"}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              Gesamtwert = gewichteter Mittelwert ({r.criteria.map((c) => `${fmtNote(c.weight)} × ${c.name || "?"}`).join(" + ")}) : {fmtNote(totalWeight)}.
              Umrechnung: bis 1,49 Sehr gut, bis 2,49 Gut, bis 3,49 Befriedigend, bis 4,49 Genügend, darüber Nicht genügend.
            </p>
          </>
        )}
      </article>

      <div className="actions sticky-actions">
        <button className="primary" onClick={save} disabled={r.criteria.length === 0}>Speichern</button>
        <button onClick={onCancel}>Abbrechen</button>
        {onDelete && <button onClick={onDelete}>Schularbeit löschen</button>}
      </div>
    </>
  );
}
