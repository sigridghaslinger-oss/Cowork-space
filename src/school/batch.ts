// Stapel-Korrektur: viele eingescannte Arbeiten auf einmal von Claude bewerten lassen.
// Der Stapel lebt außerhalb der Ansicht, damit die Bewertung weiterläuft, während Sigrid durchsieht
// oder einen anderen Reiter öffnet. Gespeichert werden nur Klasse, Nr. und Claudes Vorschlag, nie die Scans.
import { useEffect, useState } from "react";
import { getApiKey, getSetting, setSetting } from "../settings";
import { gradeScan, type GradeSuggestion, type ScanFile } from "../claude";
import { describeRubric, forLevel, newId, type Rubric } from "./rubric";
import { LEGA_RULE } from "./lega";

export type BatchItem = {
  id: string;
  klasse: string;
  nr: string;
  level: string; // Niveau-id
  angabe?: string; // gewählte Angabe; leer = Claude erkennt sie
  pages: string[]; // Dateinamen, nur zur Anzeige
  lega?: boolean; // Legasthenie: gleiche Fehler zählen als eine Fehlergruppe
  status: "wartet" | "liest" | "fertig" | "fehler" | "erledigt";
  suggestion?: GradeSuggestion;
  error?: string;
};

const storeKey = (rubricId: string) => `stapel:${rubricId}`;
const PARALLEL = 3;

const items: Record<string, BatchItem[]> = {};
const scans = new Map<string, ScanFile[]>();
const listeners = new Set<() => void>();
const running = new Set<string>();

function emit(rubricId: string) {
  setSetting(storeKey(rubricId), items[rubricId] ?? []);
  listeners.forEach((l) => l());
}

function patch(rubricId: string, id: string, p: Partial<BatchItem>) {
  items[rubricId] = (items[rubricId] ?? []).map((x) => (x.id === id ? { ...x, ...p } : x));
  emit(rubricId);
}

async function load(rubricId: string) {
  if (items[rubricId]) return;
  const stored = (await getSetting<BatchItem[]>(storeKey(rubricId))) ?? [];
  // Nach einem Neustart sind die Scans weg: Unfertiges muss neu gewählt werden.
  items[rubricId] = stored.map((x) =>
    x.status === "wartet" || x.status === "liest"
      ? { ...x, status: "fehler", error: "Die App wurde zwischendurch geschlossen. Bitte die Seiten neu wählen." }
      : x,
  );
  listeners.forEach((l) => l());
}

export function useBatch(rubricId: string): BatchItem[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    load(rubricId);
    return () => {
      listeners.delete(l);
    };
  }, [rubricId]);
  return items[rubricId] ?? [];
}

export function addToBatch(rubric: Rubric, works: { klasse: string; nr: string; level: string; angabe: string; lega: boolean; files: { name: string; file: ScanFile }[] }[]) {
  const list = items[rubric.id] ?? [];
  const added = works.map((w) => {
    const id = newId();
    scans.set(id, w.files.map((f) => f.file));
    return { id, klasse: w.klasse, nr: w.nr, level: w.level, angabe: w.angabe, lega: w.lega, pages: w.files.map((f) => f.name), status: "wartet" as const };
  });
  // Gleiche Klasse und Nr. ersetzt einen älteren Eintrag.
  const keys = new Set(added.map((a) => `${a.klasse}|${a.nr}`));
  items[rubric.id] = [...list.filter((x) => !keys.has(`${x.klasse}|${x.nr}`)), ...added];
  emit(rubric.id);
  run(rubric);
}

async function run(rubric: Rubric) {
  if (running.has(rubric.id)) return;
  running.add(rubric.id);
  try {
    const apiKey = await getApiKey();
    const worker = async () => {
      for (;;) {
        const next = (items[rubric.id] ?? []).find((x) => x.status === "wartet");
        if (!next) return;
        const files = scans.get(next.id);
        if (!apiKey || !files) {
          patch(rubric.id, next.id, {
            status: "fehler",
            error: apiKey ? "Die Seiten fehlen. Bitte neu wählen." : "Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.",
          });
          continue;
        }
        patch(rubric.id, next.id, { status: "liest" });
        const label = rubric.levels.find((l) => l.id === next.level)?.label ?? "";
        try {
          const suggestion = await gradeScan(apiKey, describeRubric(forLevel(rubric, next.level), next.angabe ?? ""), label, files, next.lega ? LEGA_RULE : "");
          scans.delete(next.id);
          const found = rubric.angaben?.some((a) => a.id === suggestion.angabe) ? suggestion.angabe : undefined;
          patch(rubric.id, next.id, { status: "fertig", suggestion, angabe: next.angabe || found, error: undefined });
        } catch (e) {
          patch(rubric.id, next.id, { status: "fehler", error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  } finally {
    running.delete(rubric.id);
  }
}

export function retryItem(rubric: Rubric, id: string) {
  if (!scans.has(id)) return;
  patch(rubric.id, id, { status: "wartet", error: undefined });
  run(rubric);
}

export const canRetry = (id: string) => scans.has(id);

export function markDone(rubricId: string, id: string) {
  patch(rubricId, id, { status: "erledigt" });
}

export function removeItem(rubricId: string, id: string) {
  scans.delete(id);
  items[rubricId] = (items[rubricId] ?? []).filter((x) => x.id !== id);
  emit(rubricId);
}

export function clearBatch(rubricId: string, onlyDone: boolean) {
  const keep = (items[rubricId] ?? []).filter((x) => onlyDone && x.status !== "erledigt");
  for (const x of items[rubricId] ?? []) if (!keep.includes(x)) scans.delete(x.id);
  items[rubricId] = keep;
  emit(rubricId);
}
