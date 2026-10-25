import Anthropic from "@anthropic-ai/sdk";

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `Du bist Sigrids persönliche Assistenz im "Cowork Space", einer Desktop-App auf ihrem Mac.
Du hilfst bei ihrem Arbeitsalltag: E-Mails entwerfen und zusammenfassen, Tagesplanung mit Terminen und Stundenplan,
an anstehende Zahlungen erinnern und Notizen bearbeiten. Antworte auf Deutsch, freundlich und knapp.`;

// Die App läuft lokal auf Sigrids Rechner, deshalb darf das SDK direkt aus der Oberfläche aufgerufen werden.
function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function streamReply(
  apiKey: string,
  history: ChatMessage[],
  onText: (delta: string) => void,
): Promise<Anthropic.Beta.BetaMessage> {
  const stream = client(apiKey).beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: history,
  });
  stream.on("text", onText);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    onText("\n\n(Claude hat diese Anfrage abgelehnt.)");
  }
  return message;
}
