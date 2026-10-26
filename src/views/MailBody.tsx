import { useState } from "react";
import type { MailSummary } from "../google/gmail";
import { loadMailContent, type Source } from "../sources";

// Zeigt den Anfang einer Mail und lädt auf Wunsch den ganzen Text nach.
export default function MailBody({ mail, source }: { mail: MailSummary; source: Source }) {
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (full !== null) return;
    setBusy(true);
    setError(null);
    try {
      setFull(await loadMailContent(source, mail));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mail-body" onClick={(e) => e.stopPropagation()}>
      {open ? (
        <div className="mail-full">{busy ? "Lädt…" : error ?? full}</div>
      ) : (
        mail.snippet && <p className="mail-snippet">{mail.snippet}</p>
      )}
      <button className="ghost link" onClick={toggle}>{open ? "Weniger anzeigen" : "Ganze Mail lesen"}</button>
    </div>
  );
}
