import { useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { streamReply, type ChatMessage } from "../claude";
import { getApiKey } from "../settings";

type Bubble = { role: "user" | "assistant"; text: string };

export default function Chat() {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
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

    const nextHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setInput("");
    setBusy(true);
    setBubbles((b) => [...b, { role: "user", text }, { role: "assistant", text: "" }]);

    try {
      const message = await streamReply(apiKey, nextHistory, (delta) => {
        setBubbles((b) => {
          const copy = [...b];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, text: last.text + delta };
          return copy;
        });
      });
      // Die vollständige Antwort (inkl. Denkblöcke) zurückgeben, damit der Verlauf gültig bleibt.
      setHistory([...nextHistory, { role: "assistant", content: message.content }]);
    } catch (e) {
      setBubbles((b) => b.slice(0, -2));
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
      <h2>Chat</h2>
      <div className="messages">
        {bubbles.length === 0 && (
          <p className="hint">Frag mich etwas, z. B. „Entwirf eine Mail an meine Vermieterin wegen der Heizung.“</p>
        )}
        {bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            {b.text || (busy && i === bubbles.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="composer">
        <textarea
          value={input}
          placeholder="Nachricht an Claude"
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
