import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { start, cancel, onUrl } from "@fabianlars/tauri-plugin-oauth";
import { deleteSetting, getSetting, setSetting } from "../settings";

// Nur Lesezugriff: die App zeigt Mails und Termine an, ändert aber nichts.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export type GoogleClient = { clientId: string; clientSecret: string };

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Cowork Space</title></head>
<body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
<h2>Verbunden!</h2><p>Du kannst dieses Fenster schließen und zu Cowork Space zurückkehren.</p></body></html>`;

export async function getGoogleClient(): Promise<GoogleClient | null> {
  return getSetting<GoogleClient>("googleClient");
}

export async function setGoogleClient(client: GoogleClient): Promise<void> {
  await setSetting("googleClient", {
    clientId: client.clientId.trim(),
    clientSecret: client.clientSecret.trim(),
  });
}

export async function isGoogleConnected(): Promise<boolean> {
  return (await getSetting<Tokens>("googleTokens")) !== null;
}

export async function disconnectGoogle(): Promise<void> {
  await deleteSetting("googleTokens");
}

function randomString(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(data);
}

function base64Url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function requestTokens(client: GoogleClient, params: Record<string, string>): Promise<Response> {
  return fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...params,
    }).toString(),
  });
}

// Öffnet die Google-Anmeldung im Browser und wartet auf die Rückleitung an einen lokalen Port.
export async function connectGoogle(): Promise<void> {
  const client = await getGoogleClient();
  if (!client?.clientId || !client.clientSecret) {
    throw new Error("Bitte trage zuerst Client-ID und Client-Secret von Google ein.");
  }

  const verifier = randomString(48);
  const state = randomString(16);
  const port = await start({ response: LOGIN_PAGE });
  const redirectUri = `http://127.0.0.1:${port}`;

  const code = await new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Die Anmeldung hat zu lange gedauert.")), 5 * 60_000);
    const unlisten = await onUrl((url) => {
      const params = new URL(url).searchParams;
      if (params.get("state") !== state) return;
      clearTimeout(timeout);
      unlisten();
      const error = params.get("error");
      const code = params.get("code");
      if (error || !code) reject(new Error(`Google hat die Anmeldung abgelehnt (${error ?? "kein Code"}).`));
      else resolve(code);
    });

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      state,
      code_challenge: await codeChallenge(verifier),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    }).toString();
    await openUrl(authUrl.toString());
  }).finally(() => cancel(port).catch(() => {}));

  const res = await requestTokens(client, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (!res.ok) throw new Error(`Anmeldung fehlgeschlagen: ${await res.text()}`);
  const data = await res.json();
  await setSetting("googleTokens", {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  } satisfies Tokens);
}

async function getAccessToken(): Promise<string> {
  const tokens = await getSetting<Tokens>("googleTokens");
  if (!tokens) throw new Error("Google ist nicht verbunden.");
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;

  const client = await getGoogleClient();
  if (!client) throw new Error("Google-Zugangsdaten fehlen.");
  const res = await requestTokens(client, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  if (!res.ok) {
    // Abgelaufene oder widerrufene Freigabe: neu verbinden lassen.
    await disconnectGoogle();
    throw new Error("Die Google-Verbindung ist abgelaufen. Bitte verbinde dich unter Einstellungen neu.");
  }
  const data = await res.json();
  const refreshed: Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await setSetting("googleTokens", refreshed);
  return refreshed.accessToken;
}

export async function googleGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
  if (!res.ok) throw new Error(`Google-Anfrage fehlgeschlagen (${res.status}).`);
  return res.json() as Promise<T>;
}
