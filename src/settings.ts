import { openStore } from "./platform";

// Einstellungen liegen lokal auf dem Gerät (App-Ordner des Macs bzw. Browser), nicht in der Cloud.
const getStore = () => openStore("settings.json");

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
