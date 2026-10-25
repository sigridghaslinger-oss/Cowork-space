import { useState } from "react";
import Chat from "./views/Chat";
import Today from "./views/Today";
import Settings from "./views/Settings";

type View = "today" | "chat" | "settings";

const NAV: { id: View; label: string }[] = [
  { id: "today", label: "Heute" },
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Einstellungen" },
];

export default function App() {
  const [view, setView] = useState<View>("today");

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>Cowork Space</h1>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {view === "today" && <Today />}
        {view === "chat" && <Chat />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}
