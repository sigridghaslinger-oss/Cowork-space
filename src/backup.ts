import { invoke } from "@tauri-apps/api/core";
import { isMac, openStore, saveFile } from "./platform";

// Sicherung aller Daten als eine Datei, um Mac und iPad abzugleichen.
// Schlüssel und Anmeldungen bleiben auf dem jeweiligen Gerät und kommen nicht in die Datei.
const FILES = ["settings.json", "planbuch.json"];
const SECRETS = ["anthropicApiKey", "googleClient", "googleTokens"];

type Backup = {
  app: "cowork-space";
  version: 1;
  created: string;
  device: "mac" | "web";
  stores: Record<string, Record<string, unknown>>;
};

const pad = (n: number) => String(n).padStart(2, "0");

export async function createBackup(): Promise<string> {
  const stores: Backup["stores"] = {};
  for (const name of FILES) {
    const entries = await (await openStore(name)).entries<unknown>();
    stores[name] = Object.fromEntries(entries.filter(([k]) => !SECRETS.includes(k)));
  }
  const now = new Date();
  const backup: Backup = { app: "cowork-space", version: 1, created: now.toISOString(), device: isMac ? "mac" : "web", stores };
  const data = JSON.stringify(backup);
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const filename = `Cowork-Space-Sicherung ${stamp}.json`;

  if (isMac) return invoke<string>("save_backup", { filename, data });

  // Auf dem iPad öffnet sich das Teilen-Fenster, dort „In Dateien sichern“ → iCloud Drive wählen.
  const file = new File([data], filename, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return filename;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw new Error("Sichern abgebrochen.");
    }
  }
  return saveFile(filename, data, "application/json");
}

export type BackupInfo = { created: Date; device: "mac" | "web"; data: Backup };

export async function readBackup(file: File): Promise<BackupInfo> {
  let data: Backup;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("Diese Datei ist keine Cowork-Space-Sicherung.");
  }
  if (data?.app !== "cowork-space" || !data.stores) throw new Error("Diese Datei ist keine Cowork-Space-Sicherung.");
  return { created: new Date(data.created), device: data.device, data };
}

/** Ersetzt alle Daten auf diesem Gerät durch die Sicherung (Schlüssel bleiben erhalten). */
export async function restoreBackup(backup: Backup): Promise<void> {
  for (const name of FILES) {
    const store = await openStore(name);
    const keep = Object.fromEntries((await store.entries<unknown>()).filter(([k]) => SECRETS.includes(k)));
    await store.replace({ ...(backup.stores[name] ?? {}), ...keep });
  }
}
