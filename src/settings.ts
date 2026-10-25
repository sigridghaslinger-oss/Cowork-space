import { load, type Store } from "@tauri-apps/plugin-store";

// Einstellungen liegen lokal im App-Ordner des Macs, nicht in der Cloud.
let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) store = await load("settings.json", { autoSave: true, defaults: {} });
  return store;
}

export async function getApiKey(): Promise<string | null> {
  return (await (await getStore()).get<string>("anthropicApiKey")) ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  await (await getStore()).set("anthropicApiKey", key.trim());
}
