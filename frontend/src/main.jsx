import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createGame, createUser } from "./api";

const COUNTRIES = [
  {
    id: "RU",
    flag: "🇷🇺",
    desc: "Ядерная держава под санкционным давлением. Высокая военная мощь, экономические ограничения.",
    difficulty: "Сложно",
    available: true,
  },
  {
    id: "US",
    flag: "🇺🇸",
    desc: "Глобальная сверхдержава. Управление союзами, внутренняя поляризация, доминирование доллара.",
    difficulty: "Средне",
    available: false,
  },
  {
    id: "CN",
    flag: "🇨🇳",
    desc: "Восходящая сверхдержава. Экономическая экспансия, Тайвань, конкуренция с Западом.",
    difficulty: "Средне",
    available: false,
  },
  {
    id: "UA",
    flag: "🇺🇦",
    desc: "Страна в состоянии войны. Максимальная сложность — каждый ход на счету.",
    difficulty: "Эксперт",
    available: false,
  },
  {
    id: "DE",
    flag: "🇩🇪",
    desc: "Локомотив ЕС. Энергетический переход, зависимость от экспорта, лидерство в Европе.",
    difficulty: "Легко",
    available: false,
  },
  {
    id: "TR",
    flag: "🇹🇷",
    desc: "Многовекторный игрок между Востоком и Западом. Балансирование между НАТО и Россией.",
    difficulty: "Сложно",
    available: false,
  },
];

const DIFFICULTY_COLOR = {
  "Эксперт": "#a8313a",
  "Сложно":  "#9c8347",
  "Средне":  "#5b6b8c",
  "Легко":   "#4a6b5c",
};

function StartScreen({ onStart, sessions = [], onResume, onDeleteSession }) {
  const [playerName, setPlayerName] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("RU");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  async function handleStart() {
    if (!playerName.trim()) { setError("Введите ваше имя"); return; }
    const country = COUNTRIES.find(c => c.id === selectedCountry);
    if (!country?.available) { setError("Эта страна пока недоступна"); return; }

    setStarting(true);
    setError(null);
    try {
      const { id: userId } = await createUser(playerName.trim());

      const { gameId } = await createGame(selectedCountry, userId);
      onStart(gameId, playerName.trim(), selectedCountry);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#1a1f2c", fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; } body { margin: 0; }
        .doc-font { font-family: 'PT Serif', Georgia, serif; }
        .mono-font { font-family: 'JetBrains Mono', monospace; }
        .c-card { transition: border-color 0.15s, background 0.15s; }
        .c-card:hover:not(.locked) { border-color: #9c8347 !important; }
        .c-card.selected { border-color: #9c8347 !important; background: #1a2a1a !important; }
      `}</style>

      <div style={{ background: "linear-gradient(180deg,#0f1318 0%,#1a1f2c 100%)", borderBottom: "2px solid #9c8347", padding: "32px 20px 24px", textAlign: "center" }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 10 }}>СОВЕРШЕННО СЕКРЕТНО</div>
        <h1 className="doc-font" style={{ margin: "0 0 6px", fontSize: 36, fontWeight: 700, letterSpacing: "0.04em" }}>REALPOLITIK</h1>
        <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", letterSpacing: "0.08em" }}>геополитическая стратегия · Claude Sonnet 4.6</div>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "28px 20px 48px" }}>

        <div style={{ background: "#1f2733", border: "1px solid #2a3040", borderLeft: "3px solid #9c8347", borderRadius: 4, padding: "16px 18px", marginBottom: 28 }}>
          <div className="doc-font" style={{ fontSize: 15, color: "#ece7d8", lineHeight: 1.6, fontStyle: "italic" }}>
            Устал от бессилия, что не можешь ни на что повлиять?
          </div>
          <div className="doc-font" style={{ fontSize: 15, color: "#9c8347", lineHeight: 1.6, marginTop: 6, fontWeight: 700 }}>
            REALPOLITIK даёт тебе шанс сделать всё правильно — стань президентом.
          </div>
        </div>

        {sessions.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 10 }}>ПРОДОЛЖИТЬ ИГРУ</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => onResume(s)}
                  style={{ display: "flex", alignItems: "center", gap: 12, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, padding: "12px 14px", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#2a3040"}
                >
                  <div style={{ fontSize: 22, flexShrink: 0 }}>{COUNTRY_FLAG[s.countryId] || "🌐"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="doc-font" style={{ fontSize: 14, color: "#ece7d8", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.playerName}</div>
                    <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>
                      {new Date(s.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                    </div>
                  </div>
                  <div className="mono-font" style={{ fontSize: 11, color: "#9c8347", flexShrink: 0 }}>Продолжить →</div>
                  <button
                    onClick={e => onDeleteSession(e, s.id)}
                    style={{ background: "none", border: "none", color: "#4a5060", cursor: "pointer", padding: "2px 4px", fontSize: 14, lineHeight: 1, flexShrink: 0 }}
                    title="Удалить сохранение"
                  >×</button>
                </div>
              ))}
            </div>
            <div className="mono-font" style={{ fontSize: 9, color: "#3a4050", marginTop: 8, letterSpacing: "0.06em" }}>ИЛИ НАЧНИТЕ НОВУЮ ИГРУ НИЖЕ</div>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ВАШ ПОЗЫВНОЙ</div>
          <input
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleStart()}
            placeholder="Имя президента…"
            autoFocus
            style={{
              width: "100%", background: "#ece7d8", color: "#262420",
              border: "2px solid #3a4156", borderRadius: 4,
              padding: "11px 14px", fontFamily: "'PT Serif',serif", fontSize: 15,
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: 28 }}>
          <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 12 }}>ВЫБЕРИТЕ СТРАНУ</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {COUNTRIES.map(c => (
              <div
                key={c.id}
                className={`c-card${!c.available ? " locked" : ""}${selectedCountry === c.id ? " selected" : ""}`}
                onClick={() => c.available && setSelectedCountry(c.id)}
                style={{
                  background: selectedCountry === c.id ? "#1a2a1a" : "#1f2733",
                  border: `2px solid ${selectedCountry === c.id ? "#9c8347" : "#2a3040"}`,
                  borderRadius: 6, padding: "14px",
                  cursor: c.available ? "pointer" : "not-allowed",
                  opacity: c.available ? 1 : 0.4,
                  position: "relative",
                }}
              >
                {!c.available && (
                  <div className="mono-font" style={{ position: "absolute", top: 8, right: 8, fontSize: 8, color: "#4a5060", background: "#14181f", padding: "2px 5px", borderRadius: 2 }}>
                    СКОРО
                  </div>
                )}
                <div style={{ fontSize: 26, marginBottom: 6 }}>{c.flag}</div>
                <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: DIFFICULTY_COLOR[c.difficulty] || "#9c8347", marginBottom: 6 }}>
                  {c.difficulty.toUpperCase()}
                </div>
                <div className="doc-font" style={{ fontSize: 12, color: "#a8a294", lineHeight: 1.4 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="doc-font" style={{ color: "#e09090", fontSize: 13.5, marginBottom: 14 }}>{error}</div>
        )}

        <button
          onClick={handleStart}
          disabled={starting || !playerName.trim()}
          style={{
            width: "100%",
            background: starting || !playerName.trim() ? "#2a3040" : "#9c8347",
            color: starting || !playerName.trim() ? "#5a6070" : "#1a1f2c",
            border: "none", borderRadius: 4,
            padding: "14px", fontFamily: "'PT Serif',serif",
            fontSize: 16, fontWeight: 700,
            cursor: starting || !playerName.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.04em",
          }}
        >
          {starting ? "Инициализация досье…" : "Принять командование →"}
        </button>

        <div className="mono-font" style={{ textAlign: "center", fontSize: 9, color: "#2a3040", marginTop: 18, letterSpacing: "0.08em" }}>
          ДАННЫЕ НА ИЮНЬ 2026 · ВСЕ СОВПАДЕНИЯ СЛУЧАЙНЫ
        </div>
      </div>
    </div>
  );
}

const COUNTRY_FLAG = { RU: "🇷🇺", US: "🇺🇸", CN: "🇨🇳", UA: "🇺🇦", DE: "🇩🇪", TR: "🇹🇷" };

function loadSessions() {
  try { return JSON.parse(localStorage.getItem("savedSessions") || "[]"); } catch { return []; }
}
function saveSessions(sessions) {
  try { localStorage.setItem("savedSessions", JSON.stringify(sessions)); } catch {}
}

function Root() {
  const [game, setGame] = useState(null);
  const [sessions, setSessions] = useState(loadSessions);

  function handleStart(id, playerName, countryId) {
    const entry = { id, playerName, countryId: countryId || "RU", createdAt: new Date().toISOString() };
    const updated = [entry, ...sessions.filter(s => s.id !== id)].slice(0, 5);
    saveSessions(updated);
    setSessions(updated);
    setGame({ id, name: playerName });
  }

  function handleResume(session) {
    setGame({ id: session.id, name: session.playerName });
  }

  function handleDeleteSession(e, id) {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated);
    setSessions(updated);
  }

  function handleNewGame() {
    setGame(null);
  }

  if (game) return <App gameId={game.id} playerName={game.name} onNewGame={handleNewGame} />;
  return <StartScreen onStart={handleStart} sessions={sessions} onResume={handleResume} onDeleteSession={handleDeleteSession} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
