// Bewertungsschemas für Schularbeiten. Jede Schularbeit hat Teilbereiche mit Gewichtung,
// jeder Teilbereich ergibt eine Teilnote 1–5 in halben Schritten. Der Gesamtwert ist der gewichtete Mittelwert.
import { getSetting, setSetting } from "../settings";
import type { RubricDraft } from "../claude";

export type Level = { id: string; label: string; minWords: number | null };

export type ChecklistCriterion = {
  kind: "checklist";
  id: string;
  name: string;
  weight: number;
  groups: { title: string; items: string[] }[];
  step: number; // Notenschritt pro fehlendem Element
  deductions: { label: string; value: number }[];
  wordRule: boolean; // Abzug bei unterschrittener Mindestwortzahl (−0,5 bis 10 %, sonst −1)
  failLabel: string; // z. B. "Kein Diagramm beschrieben"; leer = keine solche Option
};

export type ScaleCriterion = {
  kind: "scale";
  id: string;
  name: string;
  weight: number;
  descriptions: string[]; // Beschreibung für Note 1 bis 5
};

export type ErrorCriterion = {
  kind: "fq";
  id: string;
  name: string;
  weight: number;
  // Obergrenzen des Fehlerquotienten für die Teilnoten 1, 1,5 … 4,5 je Niveau; darüber Teilnote 5.
  limits: Record<string, number[]>;
  rules: string; // Zählregeln für Fehler
};

export type Criterion = ChecklistCriterion | ScaleCriterion | ErrorCriterion;

export type Rubric = {
  id: string;
  title: string;
  klasse: string;
  datum: string;
  aufgabe: string; // Aufgabenstellung, hilft Claude beim Bewerten
  levels: Level[];
  criteria: Criterion[];
  decisive: string; // Teilbereich, der bei Grenzfällen auf x,50 entscheidet ("" = keiner)
  knockout: string; // Teilbereich, bei dem Teilnote 5 automatisch Nicht genügend bedeutet ("" = keiner)
  // Eigener Notenschlüssel je Niveau (Niveau-id → Kriterien). Fehlt er, gelten criteria für alle Niveaus.
  byLevel?: Record<string, LevelKey>;
};

export type LevelKey = { criteria: Criterion[]; decisive: string; knockout: string };

// Die Schularbeit so, wie sie auf einem Niveau bewertet wird.
export function forLevel(r: Rubric, levelId: string): Rubric {
  const k = r.byLevel?.[levelId];
  return k ? { ...r, ...k } : r;
}

// Zwei (oder mehr) eingelesene Notenschlüssel zu einer Schularbeit mit eigenem Schlüssel je Niveau zusammenführen.
export function mergeLevelKeys(parts: { label: string; rubric: Rubric }[]): Rubric {
  const source = (p: (typeof parts)[number]) =>
    p.rubric.levels.find((l) => l.label.toLowerCase() === p.label.toLowerCase()) ?? p.rubric.levels[0];
  const levels: Level[] = parts.map((p) => ({ id: newId(), label: p.label, minWords: source(p)?.minWords ?? null }));
  const byLevel: Record<string, LevelKey> = {};
  parts.forEach((p, i) => {
    const src = source(p)?.id ?? "";
    const criteria = p.rubric.criteria.map((c) =>
      c.kind === "fq" ? { ...c, limits: { [levels[i].id]: c.limits[src] ?? Object.values(c.limits)[0] ?? [] } } : c,
    );
    byLevel[levels[i].id] = { criteria, decisive: p.rubric.decisive, knockout: p.rubric.knockout };
  });
  const first = byLevel[levels[0].id];
  return { ...parts[0].rubric, levels, ...first, byLevel };
}

export const HALF_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
export const GRADE_NAMES = ["Sehr gut", "Gut", "Befriedigend", "Genügend", "Nicht genügend"];

export const newId = () => crypto.randomUUID();

const FQ_RULES =
  "Rechtschreib-, Grammatik- und Satzzeichenfehler je 1. Wiederholungsfehler nur einmal. Fehlende oder falsche Beistriche je 0,5. Ausdrucksfehler zählen hier nicht. Alle Wörter des Textes zählen.";

export const DIAGRAMM_4: Rubric = {
  id: "deutsch-diagramm-4",
  title: "1. Deutsch-Schularbeit: Diagrammbeschreibung",
  klasse: "4. Klasse",
  datum: "2026-10-22",
  aufgabe: "Diagrammbeschreibung mit persönlicher Stellungnahme.",
  levels: [
    { id: "standard", label: "Standard", minWords: 200 },
    { id: "ahs", label: "AHS", minWords: 250 },
  ],
  criteria: [
    {
      kind: "checklist",
      id: "inhalt",
      name: "Inhalt/Aufbau",
      weight: 2,
      groups: [
        {
          title: "Einleitung",
          items: ["Thema bzw. Fragestellung", "Personengruppe und Anzahl der Befragten", "Diagrammtyp", "Quelle: wer, wann"],
        },
        {
          title: "Hauptteil",
          items: [
            "Wichtigste Ergebnisse mit Zahlenwerten",
            "Auffällige oder interessante Werte",
            "Werte zueinander in Beziehung gesetzt",
          ],
        },
        {
          title: "Schluss",
          items: ["Hauptaussage des Diagramms", "Schlussfolgerung aus den Ergebnissen", "Bewertung: positiv oder negativ"],
        },
        { title: "Stellungnahme", items: ["Klarer Standpunkt (mind. 3 Sätze)", "Beispiel aus dem eigenen Umfeld"] },
      ],
      step: 0.5,
      deductions: [
        { label: "Zahlenwerte falsch abgelesen oder wiedergegeben", value: 0.5 },
        { label: "Keine erkennbare Gliederung in Absätze", value: 0.5 },
        { label: "Diagramm nur aufgezählt statt beschrieben", value: 0.5 },
      ],
      wordRule: true,
      failLabel: "Kein Diagramm beschrieben, nur Meinung",
    },
    {
      kind: "scale",
      id: "ausdruck",
      name: "Ausdruck",
      weight: 1,
      descriptions: [
        "Abwechslungsreich, treffende Fachwörter, Satzanfänge durchgehend variiert",
        "Meist abwechslungsreich, wenige Wiederholungen, weitgehend variiert",
        "Einfache Sätze, eintönige Verknüpfungen, teils umgangssprachlich",
        "Viele unklare Sätze, oft umgangssprachlich, fast immer gleiche Satzanfänge",
        "Satzbau stört das Verständnis, Aussagen bleiben unklar",
      ],
    },
    {
      kind: "fq",
      id: "fq",
      name: "Fehlerquotient",
      weight: 1,
      limits: {
        standard: [1.0, 1.5, 2.5, 3.0, 4.0, 4.5, 5.5, 6.5],
        ahs: [0.5, 1.0, 1.5, 2.0, 3.0, 3.5, 4.5, 5.0],
      },
      rules: FQ_RULES,
    },
  ],
  decisive: "inhalt",
  knockout: "inhalt",
};

export function blankRubric(): Rubric {
  return {
    id: newId(),
    title: "",
    klasse: "",
    datum: "",
    aufgabe: "",
    levels: [{ id: newId(), label: "Standard", minWords: null }],
    criteria: [],
    decisive: "",
    knockout: "",
  };
}

export function blankCriterion(kind: Criterion["kind"]): Criterion {
  const base = { id: newId(), name: "", weight: 1 };
  if (kind === "checklist")
    return { ...base, kind, groups: [{ title: "", items: [] }], step: 0.5, deductions: [], wordRule: false, failLabel: "" };
  if (kind === "scale") return { ...base, kind, descriptions: ["", "", "", "", ""] };
  return { ...base, kind, limits: {}, rules: FQ_RULES };
}

export const KIND_LABELS: Record<Criterion["kind"], string> = {
  checklist: "Checkliste (Elemente ankreuzen)",
  scale: "Einschätzung 1–5 mit Beschreibung",
  fq: "Fehlerquotient (Fehler pro 100 Wörter)",
};

export async function loadRubrics(): Promise<Rubric[]> {
  return (await getSetting<Rubric[]>("rubrics")) ?? [DIAGRAMM_4];
}

export async function saveRubrics(rubrics: Rubric[]): Promise<void> {
  await setSetting("rubrics", rubrics);
}

export const usesWords = (r: Rubric) =>
  r.criteria.some((c) => c.kind === "fq" || (c.kind === "checklist" && c.wordRule));
export const usesErrors = (r: Rubric) => r.criteria.some((c) => c.kind === "fq");
export const itemCount = (c: ChecklistCriterion) => c.groups.reduce((n, g) => n + g.items.length, 0);

// Elemente, die nur für ein Niveau gelten, beginnen mit dem Niveau in eckigen Klammern, z. B. „[AHS] Gegenargument“.
const LEVEL_MARK = /^\[([^\]]+)\]\s*/;
export const itemLevel = (item: string) => item.match(LEVEL_MARK)?.[1].trim() ?? "";
export const itemText = (item: string) => item.replace(LEVEL_MARK, "");
export const itemApplies = (item: string, levelLabel: string) => {
  const l = itemLevel(item);
  return !l || l.toLowerCase() === levelLabel.toLowerCase();
};
const allItems = (c: ChecklistCriterion) => c.groups.flatMap((g) => g.items);
// Wie viele Elemente auf diesem Niveau verlangt sind, und wie viele davon angehakt.
export function levelCount(c: ChecklistCriterion, levelLabel: string, checked: boolean[]) {
  const items = allItems(c);
  const due = items.map((it) => itemApplies(it, levelLabel));
  return { total: due.filter(Boolean).length, done: due.filter((d, i) => d && checked[i]).length };
}

// Eingaben je Teilbereich.
export type CriterionInput = { checked: boolean[]; deductions: boolean[]; failed: boolean; note: number };

export type EvalInput = {
  level: string;
  words: number;
  errors: number; // Beistrichfehler zählen halb
  values: Record<string, CriterionInput>;
};

export type CriterionResult = {
  id: string;
  name: string;
  weight: number;
  note: number;
  base?: number; // Checkliste: Teilnote vor Abzügen
  wordDeduction?: number;
  fq?: number;
};

export type EvalResult = {
  parts: CriterionResult[];
  gesamt: number;
  note: number;
  tendency: "" | "+" | "−";
  reason: string;
};

const round1 = (x: number) => Math.round(x * 10 + 1e-9) / 10;

export function emptyInput(c: Criterion): CriterionInput {
  return {
    checked: c.kind === "checklist" ? Array.from({ length: itemCount(c) }, () => false) : [],
    deductions: c.kind === "checklist" ? c.deductions.map(() => false) : [],
    failed: false,
    note: 2,
  };
}

export function wordDeduction(minWords: number | null, words: number): number {
  if (!minWords || words >= minWords) return 0;
  return words < minWords * 0.9 ? 1 : 0.5;
}

export function fehlerquotient(errors: number, words: number): number {
  return words > 0 ? round1((errors * 100) / words) : 0;
}

export function fehlerNote(limits: number[] | undefined, fq: number): number {
  if (!limits || limits.length === 0) return 5;
  const i = limits.findIndex((limit) => fq <= limit + 1e-9);
  return i === -1 ? 5 : HALF_STEPS[i];
}

function criterionNote(r: Rubric, c: Criterion, v: CriterionInput, input: EvalInput): CriterionResult {
  const head = { id: c.id, name: c.name, weight: c.weight };
  if (c.kind === "checklist") {
    const level = r.levels.find((l) => l.id === input.level);
    const { total, done } = levelCount(c, level?.label ?? "", v.checked);
    const base = Math.min(5, 1 + Math.max(0, total - done) * c.step);
    const wd = c.wordRule ? wordDeduction(level?.minWords ?? null, input.words) : 0;
    const extra = c.deductions.reduce((s, d, i) => s + (v.deductions[i] ? d.value : 0), 0);
    const note = v.failed ? 5 : Math.min(5, base + wd + extra);
    return { ...head, note, base, wordDeduction: wd };
  }
  if (c.kind === "scale") return { ...head, note: v.note };
  const fq = fehlerquotient(input.errors, input.words);
  return { ...head, note: fehlerNote(c.limits[input.level], fq), fq };
}

export function evaluate(r: Rubric, input: EvalInput): EvalResult {
  const parts = r.criteria.map((c) => criterionNote(r, c, input.values[c.id] ?? emptyInput(c), input));
  const weights = parts.reduce((s, p) => s + p.weight, 0);
  const gesamt = weights > 0 ? parts.reduce((s, p) => s + p.weight * p.note, 0) / weights : 0;
  const knockout = parts.find((p) => p.id === r.knockout);
  const decisive = parts.find((p) => p.id === r.decisive);

  let note: number;
  let reason = "";
  if (knockout && knockout.note >= 5) {
    note = 5;
    reason = `${knockout.name} mit 5: Nicht genügend, unabhängig von den anderen Teilnoten.`;
  } else if (Math.abs(gesamt * 2 - Math.round(gesamt * 2)) < 1e-9 && Math.round(gesamt * 2) % 2 === 1) {
    // Grenzfall genau auf x,50.
    const lower = gesamt - 0.5;
    if (decisive) {
      note = decisive.note < gesamt ? lower : lower + 1;
      reason =
        decisive.note < gesamt
          ? `Grenzfall: ${decisive.name} ist besser, daher die bessere Note.`
          : `Grenzfall: ${decisive.name} ist nicht besser, daher die schlechtere Note.`;
    } else {
      note = lower + 1;
    }
  } else {
    note = Math.min(5, Math.floor(gesamt + 0.5));
  }

  let tendency: EvalResult["tendency"] = "";
  if (note > 1 && note < 5 && gesamt >= note - 0.5 && gesamt < note + 0.5) {
    if (gesamt < note - 0.25) tendency = "+";
    else if (gesamt >= note + 0.25) tendency = "−";
  }

  return { parts, gesamt, note, tendency, reason };
}

export const fmtNote = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });

// Lesbare Beschreibung des Schemas, z. B. für Claude.
export function describeRubric(r: Rubric): string {
  const lines = [`Schularbeit: ${r.title} (${r.klasse})`, `Aufgabenstellung: ${r.aufgabe || "nicht angegeben"}`];
  lines.push(`Niveaus: ${r.levels.map((l) => `${l.label}${l.minWords ? ` (mind. ${l.minWords} Wörter)` : ""}`).join(", ")}`);
  for (const c of r.criteria) {
    lines.push("", `Teilbereich "${c.name}" (id ${c.id}, Gewicht ${c.weight}):`);
    if (c.kind === "checklist") {
      let i = 0;
      for (const g of c.groups) {
        if (g.title) lines.push(`  ${g.title}:`);
        for (const item of g.items)
          lines.push(`    Element ${i++}: ${itemText(item)}${itemLevel(item) ? ` (nur auf Niveau ${itemLevel(item)} verlangt)` : ""}`);
      }
      c.deductions.forEach((d, j) => lines.push(`  Abzug ${j}: ${d.label} (−${d.value})`));
      if (c.failLabel) lines.push(`  Aufgabe verfehlt, wenn: ${c.failLabel}`);
    } else if (c.kind === "scale") {
      c.descriptions.forEach((d, j) => d && lines.push(`  Note ${j + 1}: ${d}`));
    } else {
      lines.push(`  Zählregeln: ${c.rules}`);
    }
  }
  return lines.join("\n");
}

// Macht aus Claudes Entwurf (gelesen aus einem Notenschlüssel) ein Schema mit eigenen ids.
export function fromDraft(d: RubricDraft): Rubric {
  const levels: Level[] = (d.levels.length ? d.levels : [{ label: "Standard", minWords: null }]).map((l) => ({
    id: newId(),
    label: l.label,
    minWords: l.minWords && l.minWords > 0 ? l.minWords : null,
  }));
  const levelId = (label: string) =>
    (levels.find((l) => l.label.toLowerCase() === label.toLowerCase()) ?? levels[0]).id;
  const criteria: Criterion[] = d.criteria.map((c) => {
    const base = { id: newId(), name: c.name, weight: c.weight > 0 ? c.weight : 1 };
    if (c.kind === "checklist")
      return {
        ...base,
        kind: "checklist",
        groups: c.groups.length ? c.groups : [{ title: "", items: [] }],
        step: c.step > 0 ? c.step : 0.5,
        deductions: c.deductions,
        wordRule: c.wordRule,
        failLabel: c.failLabel,
      };
    if (c.kind === "scale")
      return { ...base, kind: "scale", descriptions: [0, 1, 2, 3, 4].map((i) => c.descriptions[i] ?? "") };
    return {
      ...base,
      kind: "fq",
      limits: Object.fromEntries(c.limits.map((l) => [levelId(l.level), l.values.slice(0, 8)])),
      rules: c.rules,
    };
  });
  const byName = (name: string) => criteria.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? "";
  return {
    id: newId(),
    title: d.title,
    klasse: d.klasse,
    datum: "",
    aufgabe: d.aufgabe,
    levels,
    criteria,
    decisive: byName(d.decisive),
    knockout: byName(d.knockout),
  };
}
