import { useEffect, useState } from "react";
import { getApiKey, setApiKey } from "../settings";

export default function Settings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getApiKey().then((k) => setKey(k ?? ""));
  }, []);

  async function save() {
    await setApiKey(key);
    setSaved(true);
  }

  return (
    <section>
      <h2>Einstellungen</h2>
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
    </section>
  );
}
