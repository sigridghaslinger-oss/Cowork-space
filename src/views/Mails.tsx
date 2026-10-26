import { useEffect, useState, type CSSProperties } from "react";
import type { MailSummary } from "../google/gmail";
import { sortMails, streamReplyDraft, type MailSort } from "../claude";
import { getSource, isSourceReady, loadMailContent, loadMails, type Source } from "../sources";
import { openMacReply } from "../mac";
import { getApiKey, getSetting, setSetting } from "../settings";
import { AREAS, type AreaId } from "../areas";
import Cleanup from "./Cleanup";
import RemindButton from "./RemindButton";
import MailBody from "./MailBody";

type Filter = AreaId | "alle";

const GROUPS: { id: MailSort["urgency"]; label: string }[] = [
  { id: "heute", label: "Heute erledigen" },
  { id: "spaeter", label: "Später" },
  { id: "info", label: "Nur zur Info" },
];

const dateLabel = (d: Date) =>
  d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) +
  " " +
  d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

// Einordnungen werden lokal gemerkt, damit dieselbe Mail nicht erneut an Claude geht.
type SortCache = Record<string, MailSort>;

export default function Mails() {
  const [source, setSource] = useState<Source>("mac");
  const [mails, setMails] = useState<MailSummary[]>([]);
  const [sorted, setSorted] = useState<SortCache>({});
  const [filter, setFilter] = useState<Filter>("alle");
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"unread" | "cleanup">("unread");

  async function refresh(from: Source = source) {
    setLoading(true);
    setError(null);
    try {
      if (!(await isSourceReady(from))) {
        setError("Verbinde unter Einstellungen dein Google-Konto oder stell die Quelle auf „Vom Mac“ um.");
        return;
      }
      setMails(await loadMails(from));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getSetting<SortCache>("mailSort").then((c) => setSorted(c ?? {}));
    getSource().then((src) => {
      setSource(src);
      refresh(src);
    });
  }, []);

  async function sortWithClaude() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    const todo = mails.filter((m) => !sorted[m.id]);
    if (todo.length === 0) return;
    setSorting(true);
    setError(null);
    try {
      const result = await sortMails(apiKey, todo);
      // Nur aktuelle Mails behalten, damit der Speicher nicht endlos wächst.
      const current = new Set(mails.map((m) => m.id));
      const next: SortCache = {};
      for (const [id, s] of Object.entries(sorted)) if (current.has(id)) next[id] = s;
      for (const s of result) if (current.has(s.id)) next[s.id] = s;
      setSorted(next);
      await setSetting("mailSort", next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSorting(false);
    }
  }

  const visible = mails.filter((m) => filter === "alle" || sorted[m.id]?.area === filter);
  const unsortedCount = mails.filter((m) => !sorted[m.id]).length;
  const payments = visible.filter((m) => sorted[m.id]?.payment);

  const card = (m: MailSummary) => (
    <MailCard
      key={m.id}
      mail={m}
      sort={sorted[m.id]}
      source={source}
      open={openId === m.id}
      onToggle={() => setOpenId(openId === m.id ? null : m.id)}
    />
  );

  const tabs = (
    <div className="tabs">
      <button className={tab === "unread" ? "tab active" : "tab"} onClick={() => setTab("unread")}>Ungelesen</button>
      <button className={tab === "cleanup" ? "tab active" : "tab"} onClick={() => setTab("cleanup")}>Aufräumen</button>
    </div>
  );

  if (tab === "cleanup") {
    return (
      <section>
        <div className="row">
          <h2>Mails</h2>
        </div>
        {tabs}
        {source === "mac" ? (
          <Cleanup />
        ) : (
          <p className="hint">Aufräumen geht direkt in Apple Mail. Stell dafür unter Einstellungen die Quelle auf „Vom Mac“.</p>
        )}
      </section>
    );
  }

  return (
    <section>
      <div className="row">
        <h2>Mails</h2>
        <div className="actions">
          <button onClick={() => refresh()} disabled={loading}>{loading ? "Lädt…" : "Aktualisieren"}</button>
          <button className="primary" onClick={sortWithClaude} disabled={sorting || loading || unsortedCount === 0}>
            {sorting ? "Claude sortiert…" : unsortedCount ? `Mit Claude sortieren (${unsortedCount})` : "Alles sortiert"}
          </button>
        </div>
      </div>
      {tabs}

      <div className="chips">
        <button className={filter === "alle" ? "chip active" : "chip"} onClick={() => setFilter("alle")}>Alle</button>
        {AREAS.map((a) => (
          <button
            key={a.id}
            className={filter === a.id ? "chip active" : "chip"}
            style={{ "--area-soft": a.soft, "--area-strong": a.strong } as CSSProperties}
            onClick={() => setFilter(a.id)}
          >
            {a.icon} {a.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {!loading && mails.length === 0 && !error && <p className="hint">Keine ungelesenen Mails. 🎉</p>}

      {payments.length > 0 && (
        <article className="card payments">
          <h3>💶 Zahlungen</h3>
          <ul className="list">
            {payments.map((m) => {
              const p = sorted[m.id].payment!;
              return (
                <li key={m.id} className="cleanup-item">
                  <div>
                    <strong>{p.amount ?? "Betrag offen"}</strong> {m.subject}
                    <span className="meta">{m.from}{p.due ? ` · fällig ${p.due}` : ""}</span>
                  </div>
                  {source === "mac" && (
                    <RemindButton
                      title={`Zahlen: ${p.amount ?? ""} ${m.subject}`.replace(/\s+/g, " ")}
                      notes={`Von ${m.from}${p.due ? `, fällig ${p.due}` : ""}`}
                      mailId={m.id}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </article>
      )}

      {GROUPS.map((g) => {
        const items = visible.filter((m) => sorted[m.id]?.urgency === g.id);
        return items.length ? (
          <div key={g.id} className="group">
            <h3>{g.label}</h3>
            {items.map(card)}
          </div>
        ) : null;
      })}

      {filter === "alle" && unsortedCount > 0 && (
        <div className="group">
          <h3>Noch nicht sortiert</h3>
          {mails.filter((m) => !sorted[m.id]).map(card)}
        </div>
      )}
    </section>
  );
}

type CardProps = {
  mail: MailSummary;
  sort?: MailSort;
  source: Source;
  open: boolean;
  onToggle: () => void;
};

function MailCard({ mail, sort, source, open, onToggle }: CardProps) {
  const area = AREAS.find((a) => a.id === sort?.area);

  return (
    <article className="card mail">
      <div className="mail-head" onClick={onToggle}>
        <div>
          <div className="mail-from">
            {area && (
              <span className="pill" style={{ background: area.soft, color: area.strong }}>
                {area.icon} {area.label}
              </span>
            )}
            <strong>{mail.from}</strong>
            <span className="meta-inline">{dateLabel(mail.date)}</span>
          </div>
          <div className="mail-subject">{mail.subject}</div>
          {sort?.summary && <p className="mail-summary">{sort.summary}</p>}
          <MailBody mail={mail} source={source} />
        </div>
        <div className="actions">
          {source === "mac" && <RemindButton title={`Antworten: ${mail.subject}`} notes={`Mail von ${mail.from}`} mailId={mail.id} />}
          <button className="ghost">{open ? "Schließen" : "Antworten"}</button>
        </div>
      </div>
      {open && <ReplyPanel mail={mail} source={source} />}
    </article>
  );
}

export function ReplyPanel({ mail, source }: { mail: MailSummary; source: Source }) {
  const [wish, setWish] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setNote("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setDraft("");
    setNote(null);
    setBusy(true);
    try {
      const content = await loadMailContent(source, mail);
      await streamReplyDraft(apiKey, mail, content, wish.trim(), (d) => setDraft((t) => t + d));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setNote("In die Zwischenablage kopiert.");
    } catch {
      setNote("Kopieren hat nicht geklappt. Markiere den Text und drücke ⌘C.");
    }
  }

  async function openInMail() {
    // Zur Sicherheit auch kopieren, falls Mail den Text nicht übernimmt.
    await navigator.clipboard.writeText(draft).catch(() => {});
    try {
      const inserted = await openMacReply(mail.id, draft);
      setNote(
        inserted
          ? "Antwort in Apple Mail geöffnet. Prüfen und selbst auf Senden klicken."
          : "Antwortfenster geöffnet. Füge den Entwurf dort mit ⌘V ein.",
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="reply">
      <div className="composer">
        <input
          value={wish}
          placeholder="Optional: Was soll drinstehen? z. B. „Termin am Donnerstag passt, danke“"
          onChange={(e) => setWish(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
        />
        <button className="primary" onClick={generate} disabled={busy}>
          {busy ? "Schreibt…" : draft ? "Neu entwerfen" : "Entwurf schreiben"}
        </button>
      </div>
      {draft && (
        <>
          <textarea className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="actions">
            {source === "mac" && (
              <button className="primary" onClick={openInMail} disabled={busy}>
                In Apple Mail öffnen
              </button>
            )}
            <button onClick={copy} disabled={busy}>Kopieren</button>
          </div>
        </>
      )}
      {note && <p className="hint">{note}</p>}
    </div>
  );
}
