import { useState } from "react";
import { createMacReminder } from "../mac";

// Zeitpunkte zur Auswahl, gerechnet ab jetzt.
function at(daysAhead: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function choices(): { label: string; due: Date }[] {
  const evening = at(0, 18);
  return [
    ...(evening.getTime() > Date.now() ? [{ label: "Heute 18 Uhr", due: evening }] : []),
    { label: "Morgen früh", due: at(1, 7, 30) },
    { label: "In 3 Tagen", due: at(3, 7, 30) },
    { label: "In einer Woche", due: at(7, 7, 30) },
  ];
}

type Props = { title: string; notes?: string; mailId?: string };

// Legt nach einem Klick auf einen Zeitpunkt eine Erinnerung in der Erinnerungen-App an.
export default function RemindButton({ title, notes, mailId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function create(due: Date) {
    setState("busy");
    setError(null);
    try {
      await createMacReminder({ title, notes, due, mailId });
      setState("done");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  if (state === "done") return <span className="meta-inline">⏰ Erinnerung angelegt</span>;
  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="In der Erinnerungen-App anlegen">
        ⏰ Erinnern
      </button>
    );
  }
  return (
    <span className="confirm" onClick={(e) => e.stopPropagation()}>
      {choices().map((c) => (
        <button key={c.label} onClick={() => create(c.due)} disabled={state === "busy"}>{c.label}</button>
      ))}
      <button className="ghost" onClick={() => setOpen(false)}>Abbrechen</button>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
