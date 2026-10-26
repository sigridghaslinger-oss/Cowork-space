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

// Eine eingescannte Seite: entweder ein Bild (als JPEG verkleinert) oder ein PDF.
export type ScanFile = { kind: "image" | "pdf"; data: string };

function scanBlocks(files: ScanFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  return files.map((f) =>
    f.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
  );
}

const RubricDraftSchema = z.object({
  title: z.string(),
  klasse: z.string(),
  aufgabe: z.string(),
  levels: z.array(z.object({ label: z.string(), minWords: z.number().nullable() })),
  criteria: z.array(
    z.object({
      kind: z.enum(["checklist", "scale", "fq"]),
      name: z.string(),
      weight: z.number(),
      groups: z.array(z.object({ title: z.string(), items: z.array(z.string()) })),
      step: z.number(),
      deductions: z.array(z.object({ label: z.string(), value: z.number() })),
      wordRule: z.boolean(),
      failLabel: z.string(),
      descriptions: z.array(z.string()),
      limits: z.array(z.object({ level: z.string(), values: z.array(z.number()) })),
      rules: z.string(),
    }),
  ),
  decisive: z.string(),
  knockout: z.string(),
});

export type RubricDraft = z.infer<typeof RubricDraftSchema>;

// Liest einen Notenschlüssel (PDF oder Text) und macht daraus ein Bewertungsschema für die App.
export async function rubricFromKey(apiKey: string, input: { pdf?: string; text?: string }): Promise<RubricDraft> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf } });
  content.push({
    type: "text",
    text: `${input.text ? `Hier ist mein Notenschlüssel:\n\n${input.text}\n\n` : "Das PDF ist mein Notenschlüssel für eine Schularbeit. "}Übertrage ihn in dieses Schema, ohne etwas zu erfinden:
- title, klasse, aufgabe: Name der Schularbeit, Klasse/Schulstufe, Aufgabenstellung bzw. Textsorte.
- levels: die Niveaus (z. B. Standard und AHS) mit Mindestwortzahl, sonst eine Stufe "Standard" mit minWords null.
- criteria: jeder Teilbereich, der eine eigene Teilnote ergibt, mit seiner Gewichtung (weight, z. B. 2 wenn er doppelt zählt).
  kind "checklist": Elemente zum Abhaken in groups (Überschrift + Elemente), step = Notenschritt pro fehlendem Element (meist 0,5), deductions = Abzüge mit Wert, wordRule = true wenn es Abzüge für zu wenige Wörter gibt, failLabel = wann der Teilbereich automatisch 5 ist (sonst leer).
  kind "scale": Teilbereich, den man einschätzt; descriptions = genau 5 Beschreibungen für die Noten 1 bis 5.
  kind "fq": Fehlerquotient; limits = je Niveau (level = Name des Niveaus) die 8 Obergrenzen für die Teilnoten 1; 1,5; 2; 2,5; 3; 3,5; 4; 4,5. rules = Zählregeln für Fehler.
  Felder, die zur Art nicht passen, leer lassen (leere Listen, 0, false, "").
- decisive: Name des Teilbereichs, der bei einem Grenzfall auf x,50 entscheidet, sonst "".
- knockout: Name des Teilbereichs, bei dem Teilnote 5 automatisch Nicht genügend bedeutet, sonst "".`,
  });
  // Mit Streaming, weil lange Antworten sonst an der Zeitgrenze des SDK scheitern.
  const response = await client(apiKey).beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(RubricDraftSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  }).finalMessage();
  if (!response.parsed_output) throw new Error("Claude konnte den Notenschlüssel nicht lesen.");
  return response.parsed_output;
}

const GradeSchema = z.object({
  readable: z.boolean(),
  words: z.number(),
  errors: z.number(),
  criteria: z.array(
    z.object({
      id: z.string(),
      checked: z.array(z.number()),
      deductions: z.array(z.number()),
      failed: z.boolean(),
      note: z.number(),
      comment: z.string(),
    }),
  ),
  feedback: z.string(),
  hinweise: z.string(),
});

export type GradeSuggestion = z.infer<typeof GradeSchema>;

// Claude liest eine eingescannte Schularbeit und schlägt eine Bewertung nach dem Schema vor.
export async function gradeScan(
  apiKey: string,
  rubricText: string,
  levelLabel: string,
  files: ScanFile[],
): Promise<GradeSuggestion> {
  const response = await client(apiKey).beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(GradeSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `${SYSTEM_PROMPT}\n\nDu unterstützt Sigrid als Lehrerin beim Korrigieren. Dein Ergebnis ist ein Vorschlag, den sie prüft.`,
    messages: [
      {
        role: "user",
        content: [
          ...scanBlocks(files),
          {
            type: "text",
            text: `Das ist eine eingescannte Schularbeit (Niveau: ${levelLabel}). Bewerte sie nach diesem Schema:

${rubricText}

Vorgehen:
- Lies den handschriftlichen Text sorgfältig. readable = false, wenn große Teile unleserlich sind.
- words: Anzahl der Wörter des Schülertextes (ohne Aufgabenstellung, Name und Überschrift der Angabe).
- errors: Fehleranzahl nach den Zählregeln, Beistrichfehler als 0,5.
- criteria: für jeden Teilbereich ein Eintrag mit seiner id. Bei Checklisten die Nummern der erfüllten Elemente in checked und der zutreffenden Abzüge in deductions; failed = true nur wenn die Aufgabe verfehlt ist. Bei Einschätzungen note von 1 bis 5 in halben Schritten. Bei Checklisten und Fehlerquotient note = 0. comment: ein bis zwei Sätze Begründung.
- feedback: drei bis vier freundliche Sätze für das Kind in der Du-Form: was gelungen ist und was es beim nächsten Mal verbessern kann.
- hinweise: worauf Sigrid beim Nachkorrigieren achten soll (unsichere Stellen, schwer lesbare Wörter). Sonst "".
Nenne niemals den Namen des Kindes, auch wenn er auf dem Blatt steht.`,
          },
        ],
      },
    ],
  }).finalMessage();
  if (response.stop_reason === "refusal") throw new Error("Claude hat diese Arbeit nicht bewertet.");
  if (!response.parsed_output) throw new Error("Claude konnte keine Bewertung erstellen.");
  return response.parsed_output;
}

const WeekSchema = z.object({
  entries: z.array(
    z.object({
      tag: z.string(),
      datum: z.string(),
      stunde: z.string(),
      klasse: z.string(),
      fach: z.string(),
      eintrag: z.string(),
      unsicher: z.boolean(),
    }),
  ),
  hinweise: z.string(),
});

export type WeekEntry = z.infer<typeof WeekSchema>["entries"][number];

// Claude liest Bildschirmfotos aus „Mein Schulplan“ und schreibt je Stunde einen Klassenbucheintrag.
export async function classbookFromScreens(apiKey: string, images: string[]) {
  const response = await client(apiKey).beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(WeekSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `${SYSTEM_PROMPT}\n\nDu hilfst Sigrid, ihr Klassenbuch in EduPage zu führen.`,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((data) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
          })),
          {
            type: "text",
            text: `Das sind Bildschirmfotos aus meiner Unterrichtsplanung („Mein Schulplan“), meist die Wochenansicht. Mehrere Bilder können dieselbe Woche zeigen, dann führe sie zusammen und lass Doppeltes weg.

Schreib für jede geplante Unterrichtsstunde einen Klassenbucheintrag:
- tag (z. B. "Montag"), datum (z. B. "27.10.", sonst ""), stunde (z. B. "3." oder Uhrzeit, sonst ""), klasse, fach.
- eintrag: der Lehrstoff in einer knappen Zeile, so wie man ihn ins Klassenbuch einträgt. Nur was in der Planung steht, nichts dazuerfinden.
- unsicher = true, wenn der Text abgeschnitten oder schwer lesbar ist.
- Reihenfolge nach Tag und Stunde. Lass Ferien, Feiertage, Konferenzen, Pausen und Verwaltungstermine weg.
- Keine Schülernamen.
- hinweise: was ich prüfen sollte (z. B. abgeschnittene Titel, fehlende Tage). Sonst "".`,
          },
        ],
      },
    ],
  }).finalMessage();
  if (response.stop_reason === "refusal") throw new Error("Claude hat die Einträge nicht erstellt.");
  if (!response.parsed_output) throw new Error("Claude konnte keine Einträge erstellen.");
  return response.parsed_output;
}
