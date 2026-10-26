// Notenschlüssel 1. Deutsch-Schularbeit, 4. Klasse: Diagrammbeschreibung (Schuljahr 2026/27).
// Gesamtwert = (2 × Inhalt/Aufbau + Ausdruck + Fehlerquotient) : 4, jede Teilnote 1–5 in halben Schritten.

export type Level = "standard" | "ahs";

export const LEVELS: { id: Level; label: string; minWords: number }[] = [
  { id: "standard", label: "Standard", minWords: 200 },
  { id: "ahs", label: "AHS", minWords: 250 },
];

export const ELEMENT_GROUPS: { title: string; items: string[] }[] = [
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
];

export const ELEMENT_COUNT = ELEMENT_GROUPS.reduce((n, g) => n + g.items.length, 0);

// Abzüge bei Inhalt/Aufbau, die man ankreuzt. Der Abzug für die Wortzahl wird aus der Wortzahl berechnet.
export const DEDUCTIONS: { id: string; label: string; value: number }[] = [
  { id: "zahlen", label: "Zahlenwerte falsch abgelesen oder wiedergegeben", value: 0.5 },
  { id: "absaetze", label: "Keine erkennbare Gliederung in Absätze", value: 0.5 },
  { id: "liste", label: "Diagramm nur aufgezählt statt beschrieben", value: 0.5 },
];

export const AUSDRUCK: { note: number; text: string }[] = [
  { note: 1, text: "Abwechslungsreich, treffende Fachwörter, Satzanfänge durchgehend variiert" },
  { note: 2, text: "Meist abwechslungsreich, wenige Wiederholungen, weitgehend variiert" },
  { note: 3, text: "Einfache Sätze, eintönige Verknüpfungen, teils umgangssprachlich" },
  { note: 4, text: "Viele unklare Sätze, oft umgangssprachlich, fast immer gleiche Satzanfänge" },
  { note: 5, text: "Satzbau stört das Verständnis, Aussagen bleiben unklar" },
];

export const HALF_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// Obergrenzen des Fehlerquotienten für die Teilnoten 1 bis 4,5; darüber Teilnote 5.
const FQ_LIMITS: Record<Level, number[]> = {
  standard: [1.0, 1.5, 2.5, 3.0, 4.0, 4.5, 5.5, 6.5],
  ahs: [0.5, 1.0, 1.5, 2.0, 3.0, 3.5, 4.5, 5.0],
};

export const GRADE_NAMES = ["Sehr gut", "Gut", "Befriedigend", "Genügend", "Nicht genügend"];

export type RubricInput = {
  level: Level;
  words: number;
  checked: boolean[]; // erfüllte Elemente
  deductions: string[]; // ids aus DEDUCTIONS
  noDiagram: boolean; // kein Diagramm beschrieben, nur Meinung
  ausdruck: number;
  errors: number; // Beistrichfehler zählen halb
};

export type RubricResult = {
  elements: number;
  inhaltBase: number;
  wordDeduction: number;
  inhalt: number;
  fq: number;
  fehler: number;
  gesamt: number;
  note: number;
  tendency: "" | "+" | "−";
  reason: string;
};

const round1 = (x: number) => Math.round(x * 10 + 1e-9) / 10;

export function minWords(level: Level): number {
  return LEVELS.find((l) => l.id === level)!.minWords;
}

export function wordDeduction(level: Level, words: number): number {
  const min = minWords(level);
  if (words >= min) return 0;
  return words < min * 0.9 ? 1 : 0.5;
}

export function inhaltFromElements(n: number): number {
  return Math.min(5, 1 + Math.max(0, ELEMENT_COUNT - n) * 0.5);
}

export function fehlerquotient(errors: number, words: number): number {
  return words > 0 ? round1((errors * 100) / words) : 0;
}

export function fehlerNote(level: Level, fq: number): number {
  const i = FQ_LIMITS[level].findIndex((limit) => fq <= limit + 1e-9);
  return i === -1 ? 5 : HALF_STEPS[i];
}

export function evaluate(input: RubricInput): RubricResult {
  const elements = input.checked.filter(Boolean).length;
  const inhaltBase = inhaltFromElements(elements);
  const wd = wordDeduction(input.level, input.words);
  const extra = DEDUCTIONS.filter((d) => input.deductions.includes(d.id)).reduce((s, d) => s + d.value, 0);
  const inhalt = input.noDiagram ? 5 : Math.min(5, inhaltBase + wd + extra);
  const fq = fehlerquotient(input.errors, input.words);
  const fehler = fehlerNote(input.level, fq);
  const gesamt = (2 * inhalt + input.ausdruck + fehler) / 4;

  let note: number;
  let reason = "";
  if (inhalt >= 5) {
    note = 5;
    reason = input.noDiagram
      ? "Kein Diagramm beschrieben: Inhalt/Aufbau 5, daher Nicht genügend."
      : "Inhalt/Aufbau 5 (Aufgabe nicht erfüllt): Nicht genügend.";
  } else if (Math.abs(gesamt * 2 - Math.round(gesamt * 2)) < 1e-9 && Math.round(gesamt * 2) % 2 === 1) {
    // Grenzfall genau auf x,50: Inhalt/Aufbau entscheidet.
    const lower = gesamt - 0.5;
    note = inhalt < gesamt ? lower : lower + 1;
    reason =
      inhalt < gesamt
        ? "Grenzfall: Inhalt/Aufbau ist besser, daher die bessere Note."
        : "Grenzfall: Inhalt/Aufbau ist nicht besser, daher die schlechtere Note.";
  } else {
    note = Math.min(5, Math.floor(gesamt + 0.5));
  }

  let tendency: RubricResult["tendency"] = "";
  if (note > 1 && note < 5 && gesamt >= note - 0.5 && gesamt < note + 0.5) {
    if (gesamt < note - 0.25) tendency = "+";
    else if (gesamt >= note + 0.25) tendency = "−";
  }

  return { elements, inhaltBase, wordDeduction: wd, inhalt, fq, fehler, gesamt, note, tendency, reason };
}

export const fmtNote = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
