// Verbindet das Planbuch mit Cowork Space: Speicher und Downloads kommen vom Hauptfenster.
window.claude = window.parent && window.parent !== window ? window.parent.__planbuchClaude : undefined;
