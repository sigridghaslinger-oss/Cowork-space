import { load, type Store } from "@tauri-apps/plugin-store";

// Einstellungen liegen lokal im App-Ordner des Macs, nicht in der Cloud.
let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) store = await load("settings.json", { autoSave: true, defaults: {} });
  return store;
}

export async function getSetting<T>(key: string): Promise<T | null> {
  return (await (await getStore()).get<T>(key)) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await getStore()).set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  await (await getStore()).delete(key);
}

export async function getApiKey(): Promise<string | null> {
  return getSetting<string>("anthropicApiKey");
}

export async function setApiKey(key: string): Promise<void> {
  await setSetting("anthropicApiKey", key.trim());
}
