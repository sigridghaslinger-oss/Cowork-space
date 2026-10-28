import { useState, type CSSProperties } from "react";
import Chat, { emptyChat, type ChatState } from "./views/Chat";
import Today from "./views/Today";
import Settings from "./views/Settings";
import Mails from "./views/Mails";
import School from "./views/School";
import Board, { hasBoard } from "./views/Board";
import { AREAS, areaById, type AreaId } from "./areas";
import { isMac } from "./platform";

type View = "today" | "mails" | "chat" | "settings";

// Heute und Mails brauchen Kalender und Mail vom Mac, im Browser (iPad) fehlen sie.
const NAV: { id: View; label: string; icon: string }[] = [
  ...(isMac
    ? [
        { id: "today" as const, label: "Heute", icon: "☀️" },
        { id: "mails" as const, label: "Mails", icon: "📬" },
      ]
    : []),
  { id: "chat", label: "Bereich", icon: "🗂️" },
  { id: "settings", label: "Einstellungen", icon: "⚙️" },
];

export default function App() {
  const [view, setView] = useState<View>(isMac ? "today" : "chat");
  const [areaId, setAreaId] = useState<AreaId>("schule");
  const [chats, setChats] = useState<Partial<Record<AreaId, ChatState>>>({});

  const area = areaById(areaId);
  // Der gewählte Bereich färbt die ganze App in seiner Akzentfarbe.
  const theme = { "--accent": area.strong, "--accent-soft": area.soft } as CSSProperties;

  function pickArea(id: AreaId) {
    setAreaId(id);
    if (view !== "chat") setView("chat");
  }

  return (
    <div className="app" style={theme}>
      <header className="topbar">
        <span className="brand">Cowork Space</span>
        <div className="areas">
          {AREAS.map((a) => (
            <button
              key={a.id}
              className={`area ${a.id === areaId && view === "chat" ? "active" : ""}`}
              style={{ "--area-soft": a.soft, "--area-strong": a.strong } as CSSProperties}
              onClick={() => pickArea(a.id)}
            >
              <span>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <span>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <main className="content">
          {view === "today" && <Today />}
          {view === "mails" && <Mails />}
          {view === "chat" && areaId === "schule" && (
            <School
              area={area}
              chat={chats.schule ?? emptyChat}
              setChat={(id, update) => setChats((all) => ({ ...all, [id]: update(all[id] ?? emptyChat) }))}
            />
          )}
          {view === "chat" && hasBoard(areaId) && (
            <Board
              key={areaId}
              area={area}
              chat={chats[areaId] ?? emptyChat}
              setChat={(id, update) => setChats((all) => ({ ...all, [id]: update(all[id] ?? emptyChat) }))}
            />
          )}
          {view === "chat" && areaId !== "schule" && !hasBoard(areaId) && (
            <Chat
              key={areaId}
              area={area}
              chat={chats[areaId] ?? emptyChat}
              setChat={(id, update) => setChats((all) => ({ ...all, [id]: update(all[id] ?? emptyChat) }))}
            />
          )}
          {view === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}
