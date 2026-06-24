import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createGame, createUser, fetchLeaderboard, fetchAdminStats } from "./api";

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

function StartScreen({ onStart, sessions = [], onResume, onDeleteSession, onLeaderboard }) {
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
        <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", letterSpacing: "0.08em" }}>геополитическая стратегия</div>
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

        <button
          onClick={onLeaderboard}
          style={{ width: "100%", marginTop: 10, background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, cursor: "pointer", letterSpacing: "0.06em" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c8347"; e.currentTarget.style.color = "#9c8347"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a3040"; e.currentTarget.style.color = "#5a6070"; }}
        >
          ЗАЛА СЛАВЫ — ТОП ПРЕЗИДЕНТОВ
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

const STAT_LABELS = { stability: "Стабильность", economy: "Экономика", military: "Армия", diplomacy: "Дипломатия", approval: "Рейтинг" };

const COUNTRY_FLAG_MAP = { RU: "🇷🇺", US: "🇺🇸", CN: "🇨🇳", UA: "🇺🇦", DE: "🇩🇪", TR: "🇹🇷" };

function AdminPanel({ onClose }) {
  const [step, setStep] = useState("auth"); // "auth" | "stats"
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  async function handleAuth() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminStats(password);
      setStats(data);
      setStep("stats");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
    zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'PT Serif',Georgia,serif",
  };
  const panel = {
    background: "#14181f", border: "1px solid #9c8347", borderRadius: 8,
    padding: "28px 28px 24px", width: "min(90vw, 640px)", maxHeight: "85vh",
    overflowY: "auto", color: "#ece7d8", position: "relative",
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: "#5a6070", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>

        {step === "auth" && (
          <>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 16 }}>АДМИНИСТРАТИВНЫЙ ДОСТУП</div>
            <div className="doc-font" style={{ fontSize: 15, marginBottom: 16 }}>Введите пароль для просмотра статистики</div>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAuth()}
              placeholder="Пароль…"
              style={{ width: "100%", background: "#1f2733", border: "1px solid #3a4156", borderRadius: 4, padding: "10px 12px", color: "#ece7d8", fontFamily: "'PT Serif',serif", fontSize: 14, outline: "none", marginBottom: 12 }}
            />
            {error && <div style={{ color: "#e09090", fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <button
              onClick={handleAuth}
              disabled={loading || !password}
              style={{ background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "10px 20px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              {loading ? "Проверка…" : "Войти →"}
            </button>
          </>
        )}

        {step === "stats" && stats && (
          <>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 20 }}>СТАТИСТИКА · REALPOLITIK</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
              {[
                { label: "Всего игроков", value: stats.users.total, sub: `+${stats.users.today} сегодня` },
                { label: "Всего партий", value: stats.games.total, sub: `${stats.games.active} активных` },
                { label: "Всего ходов", value: stats.turns.total, sub: "сделано игроками" },
              ].map(({ label, value, sub }) => (
                <div key={label} style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 12px", textAlign: "center" }}>
                  <div className="mono-font" style={{ fontSize: 24, fontWeight: 700, color: "#9c8347" }}>{value}</div>
                  <div className="mono-font" style={{ fontSize: 9, color: "#ece7d8", marginTop: 4 }}>{label}</div>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 10 }}>ВСЕ ИГРОКИ (последние 50)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.players.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 12px" }}>
                  <div style={{ fontSize: 18, flexShrink: 0 }}>{COUNTRY_FLAG_MAP[p.country_id] || "🌐"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="doc-font" style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}</div>
                    <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>
                      {new Date(p.created_at).toLocaleString("ru-RU")} · ход {p.current_turn}
                    </div>
                  </div>
                  {p.score != null && (
                    <div className="mono-font" style={{ fontSize: 14, fontWeight: 700, color: "#9c8347", flexShrink: 0 }}>{p.score} очк.</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LeaderboardPage({ onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLeaderboard()
      .then(data => setEntries(data.entries || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#1a1f2c", fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap'); * { box-sizing: border-box; } body { margin: 0; }`}</style>
      <div style={{ background: "linear-gradient(180deg,#0f1318 0%,#1a1f2c 100%)", borderBottom: "2px solid #9c8347", padding: "24px 20px 18px", textAlign: "center" }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 8 }}>СОВЕРШЕННО СЕКРЕТНО</div>
        <h1 className="doc-font" style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 700, letterSpacing: "0.04em" }}>REALPOLITIK</h1>
        <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", letterSpacing: "0.08em" }}>ЗАЛА СЛАВЫ — ТОП ПРЕЗИДЕНТОВ</div>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px 48px" }}>
        <button onClick={onBack} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#9c8347", padding: "6px 14px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, marginBottom: 24 }}>
          ← Назад
        </button>

        {loading && <div className="mono-font" style={{ color: "#5a6070", fontSize: 12, textAlign: "center", marginTop: 40 }}>Загрузка данных…</div>}
        {error && <div className="doc-font" style={{ color: "#e09090", fontSize: 13, textAlign: "center", marginTop: 40 }}>{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="doc-font" style={{ color: "#5a6070", fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Пока никто не сыграл достаточно ходов.<br />Стань первым в истории!
          </div>
        )}

        {entries.map((e, i) => {
          const flag = COUNTRY_FLAG[e.country_id] || "🌐";
          const bd = e.score_breakdown || {};
          return (
            <div key={e.game_id + e.turn_n} style={{ background: "#1f2733", border: `1px solid ${i === 0 ? "#9c8347" : "#2a3040"}`, borderRadius: 6, padding: "14px 16px", marginBottom: 10, display: "flex", gap: 14, alignItems: "center" }}>
              <div className="mono-font" style={{ fontSize: 22, fontWeight: 700, color: i === 0 ? "#9c8347" : "#3a4156", minWidth: 32, textAlign: "center" }}>
                {i + 1}
              </div>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{flag}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span className="doc-font" style={{ fontSize: 15, fontWeight: 700, color: "#ece7d8" }}>{e.player_name}</span>
                  <span className="mono-font" style={{ fontSize: 10, color: "#5a6070" }}>{e.country_name} · ход {e.turn_n}</span>
                  <span className="mono-font" style={{ fontSize: 9, color: "#3a4050" }}>{new Date(e.created_at).toLocaleDateString("ru-RU")}</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  {Object.entries(bd).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 48 }}>
                      <div style={{ width: 40, height: 4, background: "#14181f", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, Math.max(0, v))}%`, height: "100%", background: v >= 60 ? "#4a7a5c" : v >= 40 ? "#9c8347" : "#a8313a", borderRadius: 2 }} />
                      </div>
                      <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginTop: 2 }}>{STAT_LABELS[k] || k}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="mono-font" style={{ fontSize: 22, fontWeight: 700, color: i === 0 ? "#9c8347" : "#ece7d8" }}>{e.score}</div>
                <div className="mono-font" style={{ fontSize: 8, color: "#5a6070" }}>ОЧКОВ</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Root() {
  const [game, setGame] = useState(null);
  const [sessions, setSessions] = useState(loadSessions);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyA") {
        e.preventDefault();
        setShowAdmin(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  let screen;
  if (game) screen = <App gameId={game.id} playerName={game.name} onNewGame={handleNewGame} />;
  else if (showLeaderboard) screen = <LeaderboardPage onBack={() => setShowLeaderboard(false)} />;
  else screen = <StartScreen onStart={handleStart} sessions={sessions} onResume={handleResume} onDeleteSession={handleDeleteSession} onLeaderboard={() => setShowLeaderboard(true)} />;

  return (
    <>
      {screen}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
