import { useEffect, useState } from "react";
import { getApiKey, setApiKey } from "../settings";
import {
  connectGoogle,
  disconnectGoogle,
  getGoogleClient,
  isGoogleConnected,
  setGoogleClient,
} from "../google/auth";

export default function Settings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    getApiKey().then((k) => setKey(k ?? ""));
    getGoogleClient().then((c) => {
      setClientId(c?.clientId ?? "");
      setClientSecret(c?.clientSecret ?? "");
    });
    isGoogleConnected().then(setGoogleConnected);
  }, []);

  async function save() {
    await setApiKey(key);
    setSaved(true);
  }

  async function connect() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      await setGoogleClient({ clientId, clientSecret });
      await connectGoogle();
      setGoogleConnected(true);
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : String(e));
    } finally {
      setGoogleBusy(false);
    }
  }

  async function disconnect() {
    await disconnectGoogle();
    setGoogleConnected(false);
  }

  return (
    <section>
      <h2>Einstellungen</h2>

      <h3>Claude</h3>
      <label className="field">
        Anthropic API-Schlüssel
        <input
          type="password"
          value={key}
          placeholder="sk-ant-..."
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <p className="hint">
        Einen Schlüssel bekommst du unter console.anthropic.com. Er wird nur auf diesem Mac gespeichert.
      </p>
      <button className="primary" onClick={save} disabled={!key.trim()}>
        Speichern
      </button>
      {saved && <span className="hint"> Gespeichert.</span>}

      <h3 className="section">Google (Gmail und Kalender)</h3>
      {googleConnected ? (
        <>
          <p>Dein Google-Konto ist verbunden.</p>
          <button onClick={disconnect}>Verbindung trennen</button>
        </>
      ) : (
        <>
          <label className="field">
            Client-ID
            <input value={clientId} placeholder="….apps.googleusercontent.com" onChange={(e) => setClientId(e.target.value)} />
          </label>
          <label className="field">
            Client-Secret
            <input type="password" value={clientSecret} placeholder="GOCSPX-…" onChange={(e) => setClientSecret(e.target.value)} />
          </label>
          <p className="hint">Wie du diese Daten bekommst, steht in der Anleitung im README des Projekts.</p>
          <button className="primary" onClick={connect} disabled={googleBusy || !clientId.trim() || !clientSecret.trim()}>
            {googleBusy ? "Warte auf Anmeldung im Browser…" : "Mit Google verbinden"}
          </button>
        </>
      )}
      {googleError && <p className="error">{googleError}</p>}
    </section>
  );
}
