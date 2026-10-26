# Cowork Space

Eine Mac-App, in der Claude beim Arbeitsalltag hilft: Mails im Blick behalten, Mails entwerfen und zusammenfassen,
Tagesplanung mit Terminen und Stundenplan, Erinnerungen an Zahlungen und Notizen bearbeiten.

## Stand (Version 0.7)

- **Heute:** Termine und ungelesene Mails, standardmäßig direkt aus der Kalender- und Mail-App des Macs
  (alle dort eingerichteten Konten: iCloud, Gmail, Outlook …). Alternativ über Google.
  Ein Klick auf **Tagesplan erstellen** lässt Claude den Tag planen und an fällige Zahlungen aus den Mails erinnern.
- **Mails:** Ungelesene Mails. **Mit Claude sortieren** ordnet sie den Bereichen zu, nach Dringlichkeit
  („Heute erledigen“, „Später“, „Nur zur Info“) und sammelt Rechnungen unter **Zahlungen**.
  Bei jeder Mail entwirft **Antworten** einen Text, der sich als Antwort in Apple Mail öffnen lässt.
  Verschickt wird nur, was du selbst abschickst.
- **Schule:** eigene Arbeitsfläche mit **Überblick** (heutige Stunden, Schul-Mails, Korrekturfristen),
  **Schularbeiten** (Fortschritt, Korrekturplan von Claude passend zum Kalender, Notenschlüssel-Rechner),
  **Bewerten** (eigene Schularbeiten mit eigenen Kriterien anlegen, selbst oder von Claude aus dem Notenschlüssel-PDF erstellt;
  Arbeiten einscannen und Claude einen Bewertungsvorschlag samt Rückmeldung machen lassen, den du prüfst;
  Teilnoten, gewichteter Gesamtwert, Grenzfall-Regel und Note mit Tendenz; gespeichert nur mit Nummer, Liste für Excel kopierbar),
  **Klassenbuch & Planung** (die Wochenansicht von „Mein Schulplan“ per Knopfdruck abfotografieren, Claude schreibt je Stunde einen Klassenbucheintrag zum Kopieren und Abhaken; außerdem aus Stichworten einen Eintrag und eine Stundenplanung formulieren). Das Abfotografieren braucht am Mac die Erlaubnis für Bildschirmaufnahme und Chat.
  Schülernamen werden nicht gespeichert. Eingescannte Seiten gehen an Claude, darum den Namen auf dem Blatt abdecken.
  Tipp: Den EduPage-Stundenplan als Kalender-Abo (iCal) in die Kalender-App einfügen, dann erscheint er automatisch.
- **Chat:** Unterhaltung mit Claude, Antworten erscheinen live.
- **Einstellungen:** API-Schlüssel von Anthropic hinterlegen (wird nur lokal auf dem Mac gespeichert).

## App installieren

1. Auf GitHub unter **Actions → Mac-App bauen** den neuesten erfolgreichen Lauf öffnen.
2. Unten bei „Artifacts“ **Cowork-Space-mac** herunterladen und entpacken.
3. Die `.dmg`-Datei öffnen und **Cowork Space** in den Programme-Ordner ziehen.
4. Beim ersten Start meldet macOS, dass die App nicht verifiziert ist. Dann unter
   **Systemeinstellungen → Datenschutz & Sicherheit** auf **Trotzdem öffnen** klicken.
5. In der App unter **Einstellungen** den API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) eintragen.

## Mail und Kalender vom Mac (empfohlen)

Unter **Einstellungen → Termine und Mails** ist **Vom Mac** voreingestellt. Beim ersten Öffnen von **Heute** fragt macOS,
ob Cowork Space auf deine Kalender und die Mail-App zugreifen darf. Bitte beides erlauben.

Falls du versehentlich abgelehnt hast: **Systemeinstellungen → Datenschutz & Sicherheit → Kalender** bzw.
**→ Automation → Cowork Space → Mail** einschalten. Benötigt macOS 14 (Sonoma) oder neuer.

## Optional: Google verbinden (Gmail und Kalender)

Nur nötig, wenn du unter **Einstellungen** die Quelle **Über Google** wählst. Damit die App deine Mails und Termine lesen darf, legst du einmalig bei Google einen eigenen Zugang an.
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
