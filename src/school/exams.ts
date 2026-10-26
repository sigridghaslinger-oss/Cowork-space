import { getSetting, setSetting } from "../settings";

export type Exam = {
  id: string;
  klasse: string;
  fach: string;
  datum: string; // Tag der Schularbeit, YYYY-MM-DD
  rueckgabe: string; // geplanter Rückgabetag, YYYY-MM-DD
  anzahl: number;
  korrigiert: number;
};

export async function loadExams(): Promise<Exam[]> {
  return (await getSetting<Exam[]>("exams")) ?? [];
}

export async function saveExams(exams: Exam[]): Promise<void> {
  await setSetting("exams", exams);
}

export const newExamId = () => crypto.randomUUID();

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const formatDay = (s: string) =>
  parseDay(s).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });

// Werktage (Mo–Fr) von heute bis einschließlich zum Tag vor der Rückgabe.
export function workdaysUntil(day: string, from = new Date()): number {
  const end = parseDay(day);
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let n = 0;
  while (d < end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export function perDay(exam: Exam): number | null {
  const left = exam.anzahl - exam.korrigiert;
  if (left <= 0) return 0;
  const days = workdaysUntil(exam.rueckgabe);
  return days > 0 ? Math.ceil(left / days) : null;
}

// Österreichischer Notenschlüssel mit üblichen Prozentgrenzen (anpassbar).
export const DEFAULT_THRESHOLDS = [91, 80, 64, 50];
export const GRADES = ["Sehr gut (1)", "Gut (2)", "Befriedigend (3)", "Genügend (4)", "Nicht genügend (5)"];

export function gradeRanges(maxPoints: number, thresholds: number[], step = 0.5) {
  const round = (x: number) => Math.ceil(x / step) * step;
  const mins = thresholds.map((t) => round((maxPoints * t) / 100));
  return GRADES.map((label, i) => {
    const min = i < mins.length ? mins[i] : 0;
    const max = i === 0 ? maxPoints : mins[i - 1] - step;
    return { label, min, max };
  });
}
