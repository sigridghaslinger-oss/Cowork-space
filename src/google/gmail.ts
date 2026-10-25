import { googleGet } from "./auth";

export type MailSummary = {
  id: string;
  from: string;
  subject: string;
  date: Date;
  snippet: string;
};

type MessageList = { messages?: { id: string }[] };
type Message = {
  id: string;
  snippet: string;
  internalDate: string;
  payload: { headers: { name: string; value: string }[] };
};

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

// Ungelesene Mails der letzten Tage aus dem Posteingang (ohne Werbung und soziale Netzwerke).
export async function getRecentUnread(max = 15): Promise<MailSummary[]> {
  const list = await googleGet<MessageList>(
    `${BASE}?${new URLSearchParams({ q: "is:unread in:inbox category:primary newer_than:3d", maxResults: String(max) })}`,
  );
  const ids = list.messages?.map((m) => m.id) ?? [];

  return Promise.all(
    ids.map(async (id) => {
      const params = new URLSearchParams({ format: "metadata" });
      params.append("metadataHeaders", "From");
      params.append("metadataHeaders", "Subject");
      const msg = await googleGet<Message>(`${BASE}/${id}?${params}`);
      const header = (name: string) => msg.payload.headers.find((h) => h.name === name)?.value ?? "";
      return {
        id: msg.id,
        from: header("From").replace(/\s*<.*>$/, "").replace(/"/g, ""),
        subject: header("Subject") || "(ohne Betreff)",
        date: new Date(Number(msg.internalDate)),
        snippet: decodeEntities(msg.snippet),
      };
    }),
  );
}

function decodeEntities(text: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}
