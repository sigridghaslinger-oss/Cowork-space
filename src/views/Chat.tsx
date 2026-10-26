import { useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { streamReply, type ChatMessage } from "../claude";
import { getApiKey } from "../settings";
import type { Area, AreaId } from "../areas";

type Bubble = { role: "user" | "assistant"; text: string };

export type ChatState = { history: ChatMessage[]; bubbles: Bubble[] };
export const emptyChat: ChatState = { history: [], bubbles: [] };

type Props = {
  area: Area;
  chat: ChatState;
  setChat: (area: AreaId, update: (c: ChatState) => ChatState) => void;
  hideTitle?: boolean;
};

// Jeder Bereich hat seinen eigenen Gesprächsverlauf; der Zustand liegt in App.
export default function Chat({ area, chat, setChat: setChatFor, hideTitle }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    const apiKey = await getApiKey();
    if (!apiKey) {
      setError("Bitte hinterlege zuerst deinen API-Schlüssel unter Einstellungen.");
      return;
    }

    // Antworten landen im Bereich, in dem gefragt wurde, auch wenn inzwischen gewechselt wird.
    const areaId = area.id;
    const setChat = (update: (c: ChatState) => ChatState) => setChatFor(areaId, update);

    const nextHistory: ChatMessage[] = [...chat.history, { role: "user", content: text }];
    setInput("");
    setBusy(true);
    setChat((c) => ({ ...c, bubbles: [...c.bubbles, { role: "user", text }, { role: "assistant", text: "" }] }));

    try {
      const message = await streamReply(
        apiKey,
        nextHistory,
        (delta) => {
          setChat((c) => {
            const bubbles = [...c.bubbles];
            const last = bubbles[bubbles.length - 1];
            bubbles[bubbles.length - 1] = { ...last, text: last.text + delta };
            return { ...c, bubbles };
          });
        },
        `Sigrids Bereich „${area.label}“. Beziehe dich auf diesen Lebensbereich.`,
      );
      // Die vollständige Antwort (inkl. Denkblöcke) zurückgeben, damit der Verlauf gültig bleibt.
      setChat((c) => ({ ...c, history: [...nextHistory, { role: "assistant", content: message.content }] }));
    } catch (e) {
      setChat((c) => ({ ...c, bubbles: c.bubbles.slice(0, -2) }));
      setInput(text);
      if (e instanceof Anthropic.AuthenticationError) {
        setError("Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn unter Einstellungen.");
      } else if (e instanceof Anthropic.RateLimitError) {
        setError("Zu viele Anfragen. Bitte versuch es gleich noch einmal.");
      } else if (e instanceof Anthropic.APIConnectionError) {
        setError("Keine Verbindung zu Claude. Bist du online?");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat">
      {!hideTitle && (
        <h2>
          {area.icon} {area.label}
        </h2>
      )}
      <div className="messages">
        {chat.bubbles.length === 0 && (
          <div className="empty">
            <p>Worum geht es heute im Bereich {area.label}?</p>
            <p className="hint">Zum Beispiel: „Entwirf mir eine Mail …“ oder „Fasse diese Notizen zusammen …“</p>
          </div>
        )}
        {chat.bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            {b.text || (busy && i === chat.bubbles.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="composer">
        <textarea
          value={input}
          placeholder={`Nachricht an Claude (${area.label})`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="primary" onClick={send} disabled={busy || !input.trim()}>
          Senden
        </button>
      </div>
    </section>
  );
}
