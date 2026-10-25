const CARDS = [
  { title: "Termine", text: "Kalender (Google, Outlook, iCloud) folgt im nächsten Schritt." },
  { title: "Stundenplan", text: "Dein Stundenplan wird hier angezeigt." },
  { title: "Mails", text: "Wichtige neue Mails und Zusammenfassungen." },
  { title: "Zahlungen", text: "Erinnerungen an fällige Rechnungen." },
];

export default function Today() {
  const date = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section>
      <h2>Heute, {date}</h2>
      <div className="cards">
        {CARDS.map((card) => (
          <article key={card.title} className="card">
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
