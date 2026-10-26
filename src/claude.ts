import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { MailSummary } from "./google/gmail";

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
  areaContext?: string,
): Promise<Anthropic.Beta.BetaMessage> {
  const stream = client(apiKey).beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: areaContext ? `${SYSTEM_PROMPT}\n\nAktueller Bereich: ${areaContext}` : SYSTEM_PROMPT,
    messages: history,
  });
  stream.on("text", onText);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    onText("\n\n(Claude hat diese Anfrage abgelehnt.)");
  }
  return message;
}

export async function streamDayPlan(
  apiKey: string,
  context: string,
  onText: (delta: string) => void,
): Promise<void> {
  const prompt = `Hier sind meine Termine und ungelesenen Mails für heute.

${context}

Erstelle mir einen kurzen Tagesplan:
1. Ein Ablauf des Tages mit den Terminen in zeitlicher Reihenfolge und sinnvollen Lücken für Aufgaben.
2. Welche Mails ich heute beantworten oder erledigen sollte, je ein Satz dazu.
3. Fällige Zahlungen oder Rechnungen, die in den Mails erwähnt werden, mit Betrag und Frist, falls genannt. Wenn keine dabei sind, schreib das.
Schreib ohne Einleitung, mit kurzen Überschriften.`;
  await streamReply(apiKey, [{ role: "user", content: prompt }], onText);
}

const MailSortSchema = z.object({
  mails: z.array(
    z.object({
      id: z.string(),
      area: z.enum(["schule", "lernanker", "privat", "ausbildung", "buch", "sonstiges"]),
      urgency: z.enum(["heute", "spaeter", "info"]),
      summary: z.string(),
      payment: z
        .object({ amount: z.string().nullable(), due: z.string().nullable() })
        .nullable(),
    }),
  ),
});

export type MailSort = z.infer<typeof MailSortSchema>["mails"][number];

export async function sortMails(apiKey: string, mails: MailSummary[]): Promise<MailSort[]> {
  const list = mails
    .map((m) => `<mail id="${m.id}">\nVon: ${m.from}\nBetreff: ${m.subject}\nAuszug: ${m.snippet}\n</mail>`)
    .join("\n");
  const response = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: betaZodOutputFormat(MailSortSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Ordne jede dieser ungelesenen Mails ein.
- area: zu welchem meiner Bereiche sie gehört (Schule, Lernanker, Privat, Ausbildung, Buch), sonst "sonstiges".
- urgency: "heute" wenn ich heute reagieren oder etwas erledigen muss, "spaeter" wenn es Zeit hat, "info" wenn ich nichts tun muss (Newsletter, Bestätigungen, Werbung).
- summary: ein kurzer deutscher Satz, worum es geht und was zu tun ist.
- payment: nur bei Rechnungen, Zahlungsaufforderungen oder Abbuchungen, mit Betrag und Frist wie in der Mail genannt (sonst null).

${list}`,
      },
    ],
  });
  if (!response.parsed_output) throw new Error("Claude konnte die Mails nicht sortieren.");
  return response.parsed_output.mails;
}

export async function streamReplyDraft(
  apiKey: string,
  mail: MailSummary,
  content: string,
  wish: string,
  onText: (delta: string) => void,
): Promise<void> {
  const prompt = `Entwirf eine Antwort auf diese Mail in meinem Namen (Sigrid).
${wish ? `Was ich antworten möchte: ${wish}\n` : ""}
Schreib nur den Antworttext mit Anrede und Gruß, ohne Betreffzeile und ohne Erklärungen. Passe Ton und Du/Sie an die Mail an.

<mail>
Von: ${mail.from}
Betreff: ${mail.subject}

${content}
</mail>`;
  await streamReply(apiKey, [{ role: "user", content: prompt }], onText);
}

export async function streamCorrectionPlan(apiKey: string, context: string, onText: (delta: string) => void) {
  const prompt = `Ich bin Lehrerin und muss Schularbeiten korrigieren. Erstelle mir einen realistischen Korrekturplan.

${context}

Regeln:
- Verteile die offenen Arbeiten auf die Tage bis zur Rückgabe, nutze freie Zeiten zwischen und nach meinen Terminen.
- Plane pro Tag konkrete Zeitfenster (z. B. „15:30–17:00: 6 Arbeiten 4b Mathematik“) und rechne mit etwa 10–15 Minuten pro Arbeit, wenn nichts anderes angegeben ist.
- Wochenenden nur, wenn es sonst nicht reicht, und dann kurz.
- Plane einen Puffer vor der Rückgabe ein und Zeit für Notenschlüssel und Eintragen.
- Wenn es zeitlich knapp wird, sag es deutlich und schlag eine Lösung vor.
Antworte kurz, als Liste nach Tagen, ohne Einleitung.`;
  await streamReply(apiKey, [{ role: "user", content: prompt }], onText);
}

export async function streamClassbook(
  apiKey: string,
  klasse: string,
  fach: string,
  notes: string,
  withPlanning: boolean,
  onText: (delta: string) => void,
) {
  const prompt = `Ich bin Lehrerin an einer österreichischen Mittelschule. Klasse: ${klasse || "–"}, Fach: ${fach || "–"}.
Meine Stichworte zur Stunde: ${notes}

Schreib mir:
1. **Klassenbucheintrag**: ein bis zwei knappe Zeilen zum Lehrstoff, so wie man sie ins Klassenbuch (EduPage) einträgt.
${withPlanning ? "2. **Stundenplanung**: Lernziel, Ablauf mit Zeitangaben (Einstieg, Erarbeitung, Sicherung), Methoden, Material, Hausübung falls passend.\n" : ""}Keine Einleitung, keine Schülernamen.`;
  await streamReply(apiKey, [{ role: "user", content: prompt }], onText);
}
