// Noten aus „Bewerten“ ins Notenbuch des Planbuchs eintragen.
// Das Notenbuch speichert je Klasse Spalten (columns/<id>) mit Werten pro Schüler:in (roster/<klasse>).
// Die Nr. aus „Bewerten“ wird mit der Katalognummer am Anfang des Kürzels verbunden, z. B. „03 GrJa“.
import { getSetting, setSetting } from "../settings";
import { openPlanbuch } from "../planbuch/db";
import { newId, type Rubric } from "./rubric";

export type PlanbuchClass = { id: string; name: string; subject?: string };
// Je Klasse in „Bewerten“: welche Planbuch-Klasse und welche Notenbuch-Spalte.
export type NotenbuchLink = { classId: string; columnId: string };

const linkKey = (rubricId: string) => `notenbuch:${rubricId}`;

export async function planbuchClasses(): Promise<PlanbuchClass[]> {
  const db = await openPlanbuch();
  return ((db.get("plan/settings")?.classes as PlanbuchClass[] | undefined) ?? []).filter((c) => c.id !== "admin");
}

// Vorschlag, wenn genau eine Planbuch-Klasse mit der Klasse beginnt („4D“ → „4D DE“).
export function guessClass(klasse: string, classes: PlanbuchClass[]): string {
  const k = klasse.trim().toLowerCase();
  const hits = classes.filter((c) => c.name.toLowerCase().split(/\s+/)[0] === k);
  return hits.length === 1 ? hits[0].id : "";
}

export async function loadLinks(rubricId: string): Promise<Record<string, NotenbuchLink>> {
  return (await getSetting<Record<string, NotenbuchLink>>(linkKey(rubricId))) ?? {};
}

async function saveLinks(rubricId: string, links: Record<string, NotenbuchLink>) {
  await setSetting(linkKey(rubricId), links);
}

// Klasse mit dem Notenbuch verbinden. Legt eine Spalte „Schularbeit / Test“ an, falls es sie noch nicht gibt.
export async function linkClass(rubric: Rubric, klasse: string, classId: string): Promise<NotenbuchLink> {
  const db = await openPlanbuch();
  const links = await loadLinks(rubric.id);
  const old = links[klasse];
  if (old && old.classId === classId && db.get(`columns/${old.columnId}`)) return old;
  // Gibt es schon eine Spalte mit dem Titel der Schularbeit? Dann diese nehmen.
  const existing = db.all("columns").find((c) => c.data.classId === classId && c.data.kind === "pruefung" && c.data.title === rubric.title);
  let columnId = existing?.id;
  if (!columnId) {
    columnId = newId();
    await db.doc(`columns/${columnId}`).set({
      classId,
      kind: "pruefung",
      title: rubric.title,
      date: rubric.datum || new Date().toISOString().slice(0, 10),
      weight: 1,
      values: {},
      created: new Date().toISOString(),
    });
  }
  const link = { classId, columnId };
  await saveLinks(rubric.id, { ...links, [klasse]: link });
  return link;
}

export async function unlinkClass(rubricId: string, klasse: string) {
  const links = await loadLinks(rubricId);
  delete links[klasse];
  await saveLinks(rubricId, links);
}

export type WriteResult = { written: number; unknown: string[]; className: string };

// Noten eintragen. grades: Nr. → Note als Text, z. B. "2" oder "3−".
export async function writeGrades(link: NotenbuchLink, grades: { nr: string; note: string }[]): Promise<WriteResult> {
  const db = await openPlanbuch();
  const students = (db.get(`roster/${link.classId}`)?.students as { id: string; code: string }[] | undefined) ?? [];
  const className = (await planbuchClasses()).find((c) => c.id === link.classId)?.name ?? "";
  if (!db.get(`columns/${link.columnId}`)) throw new Error("Die Spalte im Notenbuch gibt es nicht mehr. Bitte die Klasse neu verbinden.");
  const values: Record<string, string> = {};
  const unknown: string[] = [];
  for (const g of grades) {
    const n = parseInt(g.nr, 10);
    const s = students.find((x) => parseInt(x.code, 10) === n);
    if (s && !Number.isNaN(n)) values[s.id] = g.note;
    else unknown.push(g.nr);
  }
  if (Object.keys(values).length) await db.doc(`columns/${link.columnId}`).update({ values });
  return { written: Object.keys(values).length, unknown, className };
}
