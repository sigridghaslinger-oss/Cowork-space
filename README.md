# Cowork Space

Eine Mac-App, in der Claude beim Arbeitsalltag hilft: Mails im Blick behalten, Mails entwerfen und zusammenfassen,
Tagesplanung mit Terminen und Stundenplan, Erinnerungen an Zahlungen und Notizen bearbeiten.

## Stand (Version 0.1)

- **Heute:** Übersicht mit Platzhaltern für Termine, Stundenplan, Mails und Zahlungen.
- **Chat:** Unterhaltung mit Claude, Antworten erscheinen live.
- **Einstellungen:** API-Schlüssel von Anthropic hinterlegen (wird nur lokal auf dem Mac gespeichert).

## App installieren

1. Auf GitHub unter **Actions → Mac-App bauen** den neuesten erfolgreichen Lauf öffnen.
2. Unten bei „Artifacts“ **Cowork-Space-mac** herunterladen und entpacken.
3. Die `.dmg`-Datei öffnen und **Cowork Space** in den Programme-Ordner ziehen.
4. Beim ersten Start meldet macOS, dass die App nicht verifiziert ist. Dann unter
   **Systemeinstellungen → Datenschutz & Sicherheit** auf **Trotzdem öffnen** klicken.
5. In der App unter **Einstellungen** den API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) eintragen.

## Für Entwickler

Technik: [Tauri 2](https://tauri.app) (Rust) mit React + TypeScript und dem Anthropic TypeScript SDK.

```bash
npm install
npm run tauri dev     # App lokal starten
npm run tauri build   # .dmg bauen
```

Voraussetzungen: Node.js 22, Rust und die Xcode Command Line Tools (`xcode-select --install`).
