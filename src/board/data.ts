import { getSetting, setSetting } from "../settings";

// Die Kachel-Bereiche (Ausbildung, Lernanker) speichern lokal am Mac, jeder unter seinem eigenen Schlüssel.

export type BoardDate = {
  id: string;
  datum: string; // YYYY-MM-DD
  uhrzeit: string; // z. B. „09:00“, leer = ganztägig
  titel: string;
  ort: string;
  art: string; // z. B. Modul, Supervision; je Bereich andere Auswahl
};

export type CoachingSession = {
  id: string;
  datum: string;
  minuten: number;
  art: "Coaching (ich coache)" | "Supervision" | "Peer-Coaching" | "Selbsterfahrung";
  // Nur ein Kürzel, kein voller Name, damit nichts Persönliches an Claude geht.
  kuerzel: string;
  thema: string;
  reflexion: string;
};

export type Task = { id: string; text: string; frist: string; erledigt: boolean };

export type JournalEntry = { id: string; datum: string; titel: string; text: string };

export type Document = { id: string; titel: string; link: string };

export type BoardData = {
  name: string;
  anbieter: string;
  start: string;
  ende: string;
  ziel: string;
  // Stunden, die für den Abschluss nachgewiesen werden müssen (0 = keine Vorgabe).
  stundenZiel: number;
  // Termine im Mac-Kalender, deren Titel oder Kalender dieses Wort enthält, erscheinen auch hier.
  stichwort: string;
  termine: BoardDate[];
  coaching: CoachingSession[];
  aufgaben: Task[];
  journal: JournalEntry[];
  unterlagen: Document[];
  // Lernanker: die eigene Homepage, ihr Code und was daran noch zu tun ist.
  homepageUrl: string;
  codeUrl: string;
  baustellen: Task[];
};

export const emptyBoard = (stichwort: string): BoardData => ({
  name: "",
  anbieter: "",
  start: "",
  ende: "",
  ziel: "",
  stundenZiel: 0,
  stichwort,
  termine: [],
  coaching: [],
  aufgaben: [],
  journal: [],
  unterlagen: [],
  homepageUrl: "",
  codeUrl: "",
  baustellen: [],
});

export async function loadBoard(key: string, stichwort: string): Promise<BoardData> {
  return { ...emptyBoard(stichwort), ...((await getSetting<Partial<BoardData>>(key)) ?? {}) };
}

export async function saveBoard(key: string, data: BoardData): Promise<void> {
  await setSetting(key, data);
}

export const newId = () => crypto.randomUUID();

export const coachingHours = (t: BoardData) => t.coaching.reduce((n, s) => n + s.minuten, 0) / 60;

export const hoursLabel = (h: number) => `${h.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;
