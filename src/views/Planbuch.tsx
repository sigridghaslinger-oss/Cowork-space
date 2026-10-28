import { saveFile } from "../platform";
import { openPlanbuch } from "../planbuch/db";

declare global {
  interface Window {
    __planbuchClaude?: { use: (name: string) => Promise<unknown> };
  }
}

// Das Planbuch fragt beim Start nach „db“ (Speicher) und „downloads“ (Ausdrucke, CSV, Sicherung).
window.__planbuchClaude = {
  use: async (name: string) => {
    if (name === "db") return openPlanbuch();
    if (name === "downloads")
      return {
        save: ({ filename, data }: { filename: string; data: string }) => saveFile(filename, data),
      };
    return null;
  },
};

// Dein Planbuch (Woche, Jahresplan, Notenbuch, Termine) läuft unverändert in einem eigenen Rahmen.
export default function Planbuch() {
  return <iframe className="planbuch-frame" src="planbuch/index.html" title="Planbuch" />;
}
