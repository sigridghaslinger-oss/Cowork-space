# Cowork Space

Eine Mac-App, in der Claude beim Arbeitsalltag hilft: Mails im Blick behalten, Mails entwerfen und zusammenfassen,
Tagesplanung mit Terminen und Stundenplan, Erinnerungen an Zahlungen und Notizen bearbeiten.

## Stand (Version 0.2)

- **Heute:** Termine aller Google-Kalender (auch ein eigener Stundenplan-Kalender) und ungelesene Gmail-Mails.
  Ein Klick auf **Tagesplan erstellen** lässt Claude den Tag planen und an fällige Zahlungen aus den Mails erinnern.
- **Chat:** Unterhaltung mit Claude, Antworten erscheinen live.
- **Einstellungen:** API-Schlüssel von Anthropic hinterlegen (wird nur lokal auf dem Mac gespeichert).

## App installieren

1. Auf GitHub unter **Actions → Mac-App bauen** den neuesten erfolgreichen Lauf öffnen.
2. Unten bei „Artifacts“ **Cowork-Space-mac** herunterladen und entpacken.
3. Die `.dmg`-Datei öffnen und **Cowork Space** in den Programme-Ordner ziehen.
4. Beim ersten Start meldet macOS, dass die App nicht verifiziert ist. Dann unter
   **Systemeinstellungen → Datenschutz & Sicherheit** auf **Trotzdem öffnen** klicken.
5. In der App unter **Einstellungen** den API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) eintragen.

## Google verbinden (Gmail und Kalender)

Damit die App deine Mails und Termine lesen darf, legst du einmalig bei Google einen eigenen Zugang an.
Die App liest nur, sie verschickt, löscht oder ändert nichts.

1. Öffne [console.cloud.google.com](https://console.cloud.google.com) und melde dich mit deinem Google-Konto an.
2. Oben links auf die Projektauswahl klicken, **Neues Projekt** wählen, Name `Cowork Space`, **Erstellen**.
3. Im Suchfeld oben nacheinander **Gmail API** und **Google Calendar API** suchen und jeweils **Aktivieren** klicken.
4. Links im Menü **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. **Google Auth Platform**) öffnen und auf **Jetzt starten** klicken:
   - App-Name `Cowork Space`, deine E-Mail-Adresse als Support- und Kontaktadresse.
   - Zielgruppe: **Extern**.
5. Unter **Zielgruppe → Testnutzer** deine eigene Gmail-Adresse hinzufügen.
6. Unter **Clients → Client erstellen** als Anwendungstyp **Desktop-App** wählen, Name `Cowork Space Mac`, **Erstellen**.
7. Kopiere **Client-ID** und **Clientschlüssel** (Client-Secret) und trag beides in der App unter **Einstellungen → Google** ein.
8. Klick auf **Mit Google verbinden**. Im Browser warnt Google, dass die App nicht überprüft ist. Das ist normal, weil es deine eigene App ist:
   auf **Weiter** klicken und den Zugriff erlauben.

Hinweis: Solange die App bei Google im Testmodus ist, läuft die Anmeldung nach etwa 7 Tagen ab.
Die App sagt dir dann Bescheid, und du klickst einfach erneut auf **Mit Google verbinden**.

## Für Entwickler

Technik: [Tauri 2](https://tauri.app) (Rust) mit React + TypeScript und dem Anthropic TypeScript SDK.

```bash
npm install
npm run tauri dev     # App lokal starten
npm run tauri build   # .dmg bauen
```

Voraussetzungen: Node.js 22, Rust und die Xcode Command Line Tools (`xcode-select --install`).
