import { getSetting, setSetting } from "../settings";

// Alles zur Ausbildung liegt lokal am Mac unter dem Schlüssel „training“.

export type TrainingDate = {
  id: string;
  datum: string; // YYYY-MM-DD
  uhrzeit: string; // z. B. „09:00“, leer = ganztägig
  titel: string;
  ort: string;
  art: "Modul" | "Supervision" | "Prüfung" | "Abgabe" | "Sonstiges";
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

export type Training = {
  name: string;
  anbieter: string;
  start: string;
  ende: string;
  ziel: string;
  // Stunden, die für den Abschluss nachgewiesen werden müssen (0 = keine Vorgabe).
  stundenZiel: number;
  // Termine im Mac-Kalender, deren Titel oder Kalender dieses Wort enthält, erscheinen auch hier.
  stichwort: string;
  termine: TrainingDate[];
  coaching: CoachingSession[];
  aufgaben: Task[];
  journal: JournalEntry[];
  unterlagen: Document[];
};

export const emptyTraining = (): Training => ({
  name: "",
  anbieter: "",
  start: "",
  ende: "",
  ziel: "",
  stundenZiel: 0,
  stichwort: "Ausbildung",
  termine: [],
  coaching: [],
  aufgaben: [],
  journal: [],
  unterlagen: [],
});

export async function loadTraining(): Promise<Training> {
  return { ...emptyTraining(), ...((await getSetting<Partial<Training>>("training")) ?? {}) };
}

export async function saveTraining(t: Training): Promise<void> {
  await setSetting("training", t);
}

export const newId = () => crypto.randomUUID();

export const coachingHours = (t: Training) => t.coaching.reduce((n, s) => n + s.minuten, 0) / 60;

export const hoursLabel = (h: number) => `${h.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;
