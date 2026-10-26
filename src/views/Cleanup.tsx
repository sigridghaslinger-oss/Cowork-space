import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkInbox, type SenderKind } from "../claude";
import { archiveMac, getMacInbox, getMacUnsubscribeLink, markMacRead, setMacFlag, type InboxMail } from "../mac";
import { getApiKey, getSetting, setSetting } from "../settings";
import { ReplyPanel } from "./Mails";

const DAY = 24 * 60 * 60 * 1000;
const ageInDays = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);
const sinceLabel = (d: Date) => {
  const days = ageInDays(d);
  return days === 0 ? "seit heute" : days === 1 ? "seit gestern" : `seit ${days} Tagen`;
};

// Absender, die sicher nicht persönlich schreiben. Gilt, solange Claude noch nicht geprüft hat.
const AUTOMATED = /no-?reply|do-?not-?reply|newsletter|news@|mailer|marketing|notification|benachrichtigung/i;

// Nur Mails der letzten Wochen kommen für „Wartet auf Antwort“ in Frage.
const REPLY_WINDOW_DAYS = 30;

type Sender = { address: string; name: string; mails: InboxMail[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Cleanup() {
  const [mails, setMails] = useState<InboxMail[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Record<string, SenderKind>>({});
  const [needsReply, setNeedsReply] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<string[]>([]);
  const [oldDays, setOldDays] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const inbox = await getMacInbox();
      setMails(inbox.mails);
      setTotal(inbox.total);
      setUnreadTotal(inbox.unread);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getSetting<Record<string, SenderKind>>("senderKinds").then((k) => setKinds(k ?? {}));
    getSetting<Record<string, boolean>>("mailNeedsReply").then((n) => setNeedsReply(n ?? {}));
    getSetting<string[]>("mailDone").then((d) => setDone(d ?? []));
    load();
  }, []);

  const isAutomated = (m: InboxMail) => {
    const kind = kinds[m.address];
    return kind ? kind !== "person" : AUTOMATED.test(m.address);
  };

  // --- Wartet auf Antwort ---
  const replyCandidates = mails.filter(
    (m) => !m.replied && !done.includes(m.id) && ageInDays(m.date) <= REPLY_WINDOW_DAYS && !isAutomated(m),
  );
  const waiting = replyCandidates
    .filter((m) => needsReply[m.id] || m.flagged)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const unchecked = replyCandidates.filter((m) => !(m.id in needsReply));

  // --- Newsletter & Werbung ---
  const senders = new Map<string, Sender>();
  for (const m of mails) {
    const s = senders.get(m.address) ?? { address: m.address, name: m.from, mails: [] };
    s.mails.push(m);
    senders.set(m.address, s);
  }
  const bulkSenders = [...senders.values()]
    .filter((s) => {
      const kind = kinds[s.address];
      return kind ? kind === "newsletter" || kind === "werbung" : AUTOMATED.test(s.address) && s.mails.length > 1;
    })
    .sort((a, b) => b.mails.length - a.mails.length);
  const unknownSenders = [...senders.values()].filter((s) => !kinds[s.address]);

  // --- Altes wegräumen ---
  const oldRead = mails.filter((m) => m.read && !m.flagged && ageInDays(m.date) > oldDays);
  const oldUnread = mails.filter((m) => !m.read && !m.flagged && ageInDays(m.date) > 14);

  async function checkWithClaude() {
    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      // Häufige Absender zuerst, damit sich die Prüfung lohnt; der Rest folgt beim nächsten Mal.
      const senderBatch = unknownSenders
        .sort((a, b) => b.mails.length - a.mails.length)
        .slice(0, 150)
        .map((s) => ({ address: s.address, name: s.name, subjects: s.mails.slice(0, 3).map((m) => m.subject) }));
      const mailBatch = unchecked.slice(0, 80).map((m) => ({ id: m.id, from: m.from, subject: m.subject }));
      const result = await checkInbox(apiKey, senderBatch, mailBatch);

      const nextKinds = { ...kinds, ...result.kinds };
      setKinds(nextKinds);
      await setSetting("senderKinds", nextKinds);

      // Nur aktuelle Mails behalten, damit der Speicher nicht endlos wächst.
      const current = new Set(mails.map((m) => m.id));
      const nextReply: Record<string, boolean> = {};
      for (const [id, v] of Object.entries(needsReply)) if (current.has(id)) nextReply[id] = v;
      for (const m of mailBatch) nextReply[m.id] = result.needsReply.includes(m.id);
      setNeedsReply(nextReply);
      await setSetting("mailNeedsReply", nextReply);
    } catch (e) {
      setError(message(e));
    } finally {
      setChecking(false);
    }
  }

  // Führt eine Änderung in Apple Mail aus und passt die Liste an, ohne alles neu zu laden.
  async function run(action: () => Promise<string>, update: (list: InboxMail[]) => InboxMail[]) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
      setMails(update);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const archive = (list: InboxMail[]) => {
    const ids = new Set(list.map((m) => m.id));
    return run(
      async () => {
        const { moved, skipped } = await archiveMac([...ids]);
        return (
          `${moved} Mails ins Archiv verschoben. Du findest sie in Apple Mail unter „Archiv“.` +
          (skipped ? ` ${skipped} sind liegen geblieben, weil ihr Konto keinen Archiv-Ordner hat.` : "")
        );
      },
      (all) => all.filter((m) => !ids.has(m.id)),
    );
  };

  const markRead = (list: InboxMail[]) => {
    const ids = new Set(list.map((m) => m.id));
    return run(
      async () => `${await markMacRead([...ids])} Mails als gelesen markiert.`,
      (all) => all.map((m) => (ids.has(m.id) ? { ...m, read: true } : m)),
    );
  };

  const toggleFlag = (m: InboxMail) =>
    run(
      async () => {
        await setMacFlag([m.id], !m.flagged);
        return m.flagged ? "Fähnchen entfernt." : "Mit Fähnchen markiert, du siehst sie auch in Apple Mail.";
      },
      (all) => all.map((x) => (x.id === m.id ? { ...x, flagged: !m.flagged } : x)),
    );

  async function markDone(m: InboxMail) {
    const next = [...done.filter((id) => mails.some((x) => x.id === id)), m.id];
    setDone(next);
    await setSetting("mailDone", next);
  }

  async function unsubscribe(s: Sender) {
    setError(null);
    setNote(null);
    try {
      const newest = [...s.mails].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      const link = await getMacUnsubscribeLink(newest.id);
      if (!link) {
        setNote(`${s.name} schickt keinen Abmelde-Link mit. Öffne eine Mail davon und such ganz unten nach „Abmelden“.`);
        return;
      }
      await openUrl(link);
      setNote(
        link.startsWith("mailto:")
          ? "Apple Mail hat eine Abmelde-Mail vorbereitet. Prüfen und selbst auf Senden klicken."
          : "Die Abmelde-Seite ist im Browser offen. Bestätige dort die Abmeldung.",
      );
    } catch (e) {
      setError(message(e));
    }
  }

  const allBulkMails = bulkSenders.flatMap((s) => s.mails).filter((m) => !m.flagged);

  return (
    <div className="cleanup">
      <div className="row">
        <p className="hint">
          {loading
            ? "Posteingang wird gelesen… bei vielen Mails kann das eine Minute dauern."
            : `${total} Mails im Posteingang, davon ${unreadTotal} ungelesen.` +
              (total > mails.length ? ` Angezeigt werden die neuesten ${mails.length}.` : "")}
        </p>
        <div className="actions">
          <button onClick={load} disabled={loading || busy}>Neu laden</button>
          <button
            className="primary"
            onClick={checkWithClaude}
            disabled={checking || loading || (unchecked.length === 0 && unknownSenders.length === 0)}
          >
            {checking ? "Claude prüft…" : unchecked.length || unknownSenders.length ? "Mit Claude prüfen" : "Alles geprüft"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <article className="card">
        <h3>⏳ Wartet auf deine Antwort</h3>
        {waiting.length === 0 ? (
          <p className="hint">
            {unchecked.length
              ? `Klick auf „Mit Claude prüfen“. Claude schaut sich ${unchecked.length} unbeantwortete Mails an und sucht die heraus, bei denen jemand auf dich wartet.`
              : "Niemand wartet auf eine Antwort von dir. 🎉"}
          </p>
        ) : (
          <ul className="list cleanup-list">
            {waiting.map((m) => (
              <li key={m.id}>
                <div className="cleanup-item">
                  <div>
                    <strong>{m.from}</strong> <span className="meta-inline">{sinceLabel(m.date)}</span>
                    <div className="mail-subject">{m.subject}</div>
                  </div>
                  <div className="actions">
                    <button className="primary" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                      {openId === m.id ? "Schließen" : "Antworten"}
                    </button>
                    <button onClick={() => toggleFlag(m)} disabled={busy} title="Fähnchen in Apple Mail">
                      {m.flagged ? "🚩 Fähnchen weg" : "🚩 Fähnchen"}
                    </button>
                    <button className="ghost" onClick={() => markDone(m)}>Erledigt</button>
                  </div>
                </div>
                {openId === m.id && (
                  <ReplyPanel mail={{ id: m.id, from: m.from, subject: m.subject, date: m.date, snippet: "" }} source="mac" />
                )}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card">
        <h3>📰 Newsletter & Werbung</h3>
        {bulkSenders.length === 0 ? (
          <p className="hint">
            {unknownSenders.length
              ? "Klick auf „Mit Claude prüfen“, dann sortiert Claude Newsletter und Werbung heraus."
              : "Keine Newsletter oder Werbung im Posteingang."}
          </p>
        ) : (
          <>
            <div className="cleanup-item">
              <span>
                {bulkSenders.length} Absender mit zusammen {allBulkMails.length} Mails.
              </span>
              <ConfirmButton
                label={`Alle ${allBulkMails.length} archivieren`}
                question={`Wirklich ${allBulkMails.length} Newsletter- und Werbemails ins Archiv verschieben? Gelöscht wird nichts.`}
                disabled={busy}
                onConfirm={() => archive(allBulkMails)}
              />
            </div>
            <ul className="list cleanup-list">
              {bulkSenders.map((s) => {
                const unreadCount = s.mails.filter((m) => !m.read).length;
                return (
                  <li key={s.address} className="cleanup-item">
                    <div>
                      <strong>{s.name}</strong>{" "}
                      <span className="pill">{kinds[s.address] === "werbung" ? "Werbung" : "Newsletter"}</span>
                      <span className="meta">
                        {s.mails.length} Mails{unreadCount ? `, ${unreadCount} ungelesen` : ""} · {s.address}
                      </span>
                    </div>
                    <div className="actions">
                      {unreadCount > 0 && (
                        <button onClick={() => markRead(s.mails.filter((m) => !m.read))} disabled={busy}>
                          Gelesen
                        </button>
                      )}
                      <ConfirmButton
                        label="Archivieren"
                        question={`${s.mails.length} Mails von ${s.name} ins Archiv?`}
                        disabled={busy}
                        onConfirm={() => archive(s.mails.filter((m) => !m.flagged))}
                      />
                      <button className="ghost" onClick={() => unsubscribe(s)}>Abmelden</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </article>

      <article className="card">
        <h3>🧹 Altes wegräumen</h3>
        <p className="hint">Mails mit Fähnchen bleiben immer liegen. Archivierte Mails findest du in Apple Mail unter „Archiv“.</p>
        <div className="cleanup-item">
          <span>
            Gelesene Mails, älter als{" "}
            <select value={oldDays} onChange={(e) => setOldDays(Number(e.target.value))}>
              <option value={14}>2 Wochen</option>
              <option value={30}>1 Monat</option>
              <option value={90}>3 Monate</option>
              <option value={365}>1 Jahr</option>
            </select>
            : <strong>{oldRead.length}</strong>
          </span>
          <ConfirmButton
            label="Archivieren"
            question={`Wirklich ${oldRead.length} gelesene Mails ins Archiv verschieben? Gelöscht wird nichts.`}
            disabled={busy || oldRead.length === 0}
            onConfirm={() => archive(oldRead)}
          />
        </div>
        <div className="cleanup-item">
          <span>
            Ungelesene Mails, älter als 2 Wochen: <strong>{oldUnread.length}</strong>
          </span>
          <ConfirmButton
            label="Als gelesen markieren"
            question={`${oldUnread.length} alte ungelesene Mails als gelesen markieren?`}
            disabled={busy || oldUnread.length === 0}
            onConfirm={() => markRead(oldUnread)}
          />
        </div>
      </article>
    </div>
  );
}

// Fragt vor jeder Änderung in Apple Mail nach. Erst „Ja“ führt sie aus.
function ConfirmButton(props: { label: string; question: string; disabled?: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} disabled={props.disabled}>
        {props.label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <span>{props.question}</span>
      <button
        className="primary"
        onClick={() => {
          setAsking(false);
          props.onConfirm();
        }}
      >
        Ja
      </button>
      <button className="ghost" onClick={() => setAsking(false)}>Abbrechen</button>
    </span>
  );
}
