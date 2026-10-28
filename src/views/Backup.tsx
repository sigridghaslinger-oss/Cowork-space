import { useRef, useState } from "react";
import { createBackup, readBackup, restoreBackup, type BackupInfo } from "../backup";
import { isMac } from "../platform";

const when = (d: Date) =>
  d.toLocaleString("de-AT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

// Mac und iPad gleichen sich über eine Sicherungsdatei in iCloud Drive ab.
export default function BackupSection() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupInfo | null>(null);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const where = await createBackup();
      setDone(isMac ? `Gespeichert: ${where}` : "Sicherung erstellt.");
    });

  const pick = (file: File | undefined) => file && run(async () => setPending(await readBackup(file)));

  const restore = () =>
    pending &&
    run(async () => {
      await restoreBackup(pending.data);
      // Neu starten, damit alle Bereiche die geladenen Daten zeigen.
      window.location.reload();
    });

  return (
    <>
      <h3 className="section">Sichern und abgleichen (Mac ↔ iPad)</h3>
      <p className="hint">
        {isMac
          ? "„Sichern“ legt eine Datei in iCloud Drive im Ordner „Cowork Space“ ab. Am iPad lädst du sie mit „Sicherung laden“."
          : "„Sichern“ öffnet das Teilen-Fenster: „In Dateien sichern“ wählen und in iCloud Drive den Ordner „Cowork Space“ nehmen. Am Mac lädst du sie mit „Sicherung laden“."}{" "}
        Beim Laden werden die Daten auf diesem Gerät durch die Sicherung ersetzt. Sichere also immer auf dem Gerät, an dem du zuletzt gearbeitet hast.
      </p>
      <div className="backup-actions">
        <button className="primary" onClick={save} disabled={busy}>
          💾 Sichern
        </button>
        <button onClick={() => input.current?.click()} disabled={busy}>
          📂 Sicherung laden
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {pending && (
        <div className="backup-confirm">
          <p>
            Sicherung vom <strong>{when(pending.created)}</strong> ({pending.device === "mac" ? "Mac" : "iPad/Browser"}) laden?
            Alle Daten auf diesem Gerät werden dadurch ersetzt.
          </p>
          <div className="backup-actions">
            <button className="primary" onClick={restore} disabled={busy}>
              Ja, laden
            </button>
            <button onClick={() => setPending(null)} disabled={busy}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {done && <p className="hint">{done}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}
