// Kinder mit Legasthenie, gemerkt je Klasse und Nr. (nie mit Namen). Gilt für alle Schularbeiten, Tests und Diktate.
// Bei ihnen werden gleiche Rechtschreibfehler zu Fehlergruppen zusammengefasst, die nur als 1 Fehler zählen.
import { getSetting, setSetting } from "../settings";

export type LegaMap = Record<string, string[]>;
const KEY = "legasthenie";
const norm = (nr: string) => String(parseInt(nr, 10) || nr.trim());

export async function loadLega(): Promise<LegaMap> {
  return (await getSetting<LegaMap>(KEY)) ?? {};
}

export const isLega = (map: LegaMap, klasse: string, nr: string) =>
  !!klasse.trim() && !!nr.trim() && (map[klasse.trim()] ?? []).includes(norm(nr));

export async function setLega(map: LegaMap, klasse: string, nr: string, on: boolean): Promise<LegaMap> {
  const k = klasse.trim();
  const rest = (map[k] ?? []).filter((x) => x !== norm(nr));
  const next = { ...map, [k]: on ? [...rest, norm(nr)] : rest };
  await setSetting(KEY, next);
  return next;
}

export const LEGA_RULE =
  "Das Kind hat eine Legasthenie: Fasse gleiche Rechtschreibfehler (gleiches Fehlermuster, z. B. immer ie/i, Doppelkonsonant, ß/ss oder Groß-/Kleinschreibung nach derselben Regel) zu Fehlergruppen zusammen. Jede Fehlergruppe zählt nur als 1 Fehler. Beistrichfehler zählen weiterhin je 0,5 (2 Beistrichfehler = 1 Fehler). Gib in errors die Anzahl nach dieser Regel an und nenne die Fehlergruppen kurz in hinweise.";
