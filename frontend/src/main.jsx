import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createGame, createUser, deleteGame, fetchLeaderboard, fetchAdminStats, login, register, setToken, getToken, fetchMyGames, updateDisplayName } from "./api";

const API_BASE = import.meta.env.VITE_API_BASE || "https://realpolitik-game-production.up.railway.app";

async function fetchAdminGames(password) {
  const res = await fetch(`${API_BASE}/admin/games`, { headers: { "x-admin-password": password } });
  if (!res.ok) throw new Error("Ошибка загрузки партий");
  return res.json();
}

async function sendAdminEvent(password, gameId, body) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Ошибка отправки события");
  return res.json();
}

async function fetchAdminPlayerDetail(password, gameId) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}/detail`, { headers: { "x-admin-password": password } });
  if (!res.ok) throw new Error("Ошибка загрузки деталей игрока");
  return res.json();
}

async function sendForeignAction(password, gameId, body) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}/foreign-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Ошибка отправки действия"); }
  return res.json();
}

async function adminSetStats(password, gameId, stats) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}/set-stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ stats }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Ошибка"); }
  return res.json();
}

async function adminSetInitiative(password, gameId, initiative) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}/set-initiative`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ initiative: Number(initiative) }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Ошибка"); }
  return res.json();
}

async function adminDeactivateGame(password, gameId) {
  const res = await fetch(`${API_BASE}/admin/games/${gameId}`, {
    method: "DELETE",
    headers: { "x-admin-password": password },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Ошибка"); }
  return res.json();
}

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

const START_HEADLINES = [
  { src: "Reuters", text: "Экстренное заседание СБ ООН: ситуация на границе признана критической" },
  { src: "AP", text: "Министры G7 встретились на фоне эскалации — итоги переговоров засекречены" },
  { src: "Al Jazeera", text: "Беспилотники зафиксированы в 40 км от столицы — армия переведена в готовность" },
  { src: "Bloomberg", text: "Мировые рынки падают: инвесторы уходят в защитные активы на фоне угроз" },
  { src: "DW", text: "Германия приостанавливает экспорт вооружений на фоне региональной нестабильности" },
  { src: "Euronews", text: "ЕС готовит новый пакет санкций — голосование запланировано на следующей неделе" },
  { src: "CNN", text: "Источники: перехвачены переговоры о переброске войск к северной границе" },
  { src: "BBC", text: "Нефть достигла двухлетнего максимума из-за угрозы блокады Ормузского пролива" },
  { src: "ТАСС", text: "МИД вызвал послов западных стран для объяснений по военным учениям" },
  { src: "Politico", text: "Конгресс расколот: законопроект о военной помощи заблокирован республиканцами" },
  { src: "AFP", text: "ООН открыла гуманитарный коридор — эвакуация мирного населения началась" },
  { src: "Sky News", text: "Кибератака парализовала инфраструктуру трёх государств — следы ведут к государственной группировке" },
  { src: "WSJ", text: "Отключение от SWIFT: курс национальной валюты рухнул на 18% за сутки" },
  { src: "Le Monde", text: "Франция предложила план мирного урегулирования — Москва и Вашингтон пока молчат" },
  { src: "Axios", text: "Источники в Белом доме: президент подписал закрытый указ о введении особого режима" },
  { src: "NHK", text: "Токио готов пересмотреть оборонный бюджет — региональные угрозы выросли" },
  { src: "Al Arabiya", text: "Эр-Рияд отказал в транзите военных грузов — переговоры продолжаются" },
  { src: "Financial Times", text: "Иностранные инвестиции рухнули на 40%: бизнес уходит из зоны конфликта" },
  { src: "The Guardian", text: "Правозащитники зафиксировали нарушения в зоне боевых действий — требуют расследования" },
  { src: "CGTN", text: "Пекин и Москва подписали декларацию о стратегическом партнёрстве в сфере безопасности" },
  { src: "Reuters", text: "Разведка США: противник завершил переброску тяжёлой техники на восточный фланг" },
  { src: "BBC", text: "Три посольства эвакуированы после угроз — дипломаты возвращаются на родину" },
  { src: "Spiegel", text: "Немецкие спецслужбы предупредили о подготовке диверсий на критической инфраструктуре" },
  { src: "AP", text: "НАТО провело экстренный саммит — союзники усиливают восточный фланг" },
  { src: "Bloomberg", text: "Центробанки G20 скоординировали действия для стабилизации финансовых рынков" },
  { src: "Euronews", text: "Беженцы: число вынужденных переселенцев превысило два миллиона человек" },
  { src: "Al Jazeera", text: "Ракетный удар по военной базе — подробности уточняются, жертвы среди мирных не подтверждены" },
  { src: "Reuters", text: "Переговоры зашли в тупик — делегация покинула зал заседаний без подписания соглашения" },
  { src: "CNN", text: "Пентагон подтвердил: в регион направлена дополнительная авианосная группа" },
  { src: "ТАСС", text: "Россия успешно испытала новую систему перехвата — подробности засекречены" },
  { src: "DW", text: "Экономика региона сжимается: ВВП упал на 6% за квартал из-за санкций и нестабильности" },
  { src: "Kyodo", text: "Япония ввела новые ограничения на экспорт полупроводников в связи с угрозами безопасности" },
  { src: "AFP", text: "Международный суд ООН рассматривает иск о нарушении норм международного права" },
  { src: "Hürriyet", text: "Анкара выступила посредником: турецкие дипломаты встретились с обеими сторонами конфликта" },
  { src: "ANSA", text: "Рим предложил нейтральную площадку для переговоров — приглашения разосланы" },
  { src: "Xinhua", text: "КНР призывает к немедленному прекращению огня и готова выступить гарантом мира" },
  { src: "Yonhap", text: "Сеул зафиксировал аномальную активность вблизи демилитаризованной зоны — силы в готовности" },
  { src: "Sky News", text: "Спутниковые снимки подтверждают: колонна техники движется к границе" },
  { src: "Axios", text: "Утечка секретных документов: АНБ отслеживало переговоры союзников без их ведома" },
  { src: "Der Spiegel", text: "Европейские спецслужбы совместно расследуют разветвлённую шпионскую сеть" },
  { src: "RFI", text: "Африканский союз обеспокоен ростом иностранного военного присутствия на континенте" },
  { src: "Nikkei", text: "Токийская биржа обвалилась на 4% — инвесторы реагируют на геополитическую эскалацию" },
  { src: "Bloomberg", text: "Золото пробило исторический максимум: $3200 за унцию на фоне паники" },
  { src: "The Times", text: "Разведка MI6 предупреждает: вероятность прямого столкновения в регионе выросла до 60%" },
  { src: "Corriere", text: "Италия высылает трёх дипломатов — обвинения в шпионаже и вербовке чиновников" },
  { src: "Kommersant", text: "Закрытый доклад: потери ВПК от санкций составили $47 млрд за год" },
  { src: "Washington Post", text: "Внутренний раскол в администрации: советники президента не могут договориться о стратегии" },
  { src: "AP", text: "Экологическая катастрофа в зоне конфликта: нефтяное пятно движется к побережью" },
  { src: "Reuters", text: "Биткоин вырос на 12% — криптовалюта стала убежищем от геополитических рисков" },
  { src: "Al Jazeera", text: "Журналисты заблокированы на въезде в зону конфликта — СМИ требуют доступа" },
  { src: "BBC", text: "Новые санкции: заморожены активы на сумму свыше $200 млрд в западных банках" },
];

function NewsVideoPanel() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(i => (i + 1) % START_HEADLINES.length); setFade(true); }, 400);
    }, 4000);
    return () => clearInterval(t);
  }, []);
  const item = START_HEADLINES[idx];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #2a3040", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: "#a8313a", padding: "5px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6060", display: "inline-block", animation: "pulse-red 1s infinite" }} />
        <span className="mono-font" style={{ fontSize: 9, color: "#fff", letterSpacing: "0.14em", fontWeight: 700 }}>LIVE · МИРОВЫЕ НОВОСТИ</span>
        <style>{`@keyframes pulse-red { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      </div>
      <div style={{ background: "#0d1118", padding: "14px 14px 10px", minHeight: 80, transition: "opacity 0.4s", opacity: fade ? 1 : 0 }}>
        <div className="mono-font" style={{ fontSize: 8, color: "#a8313a", letterSpacing: "0.1em", marginBottom: 6 }}>{item.src.toUpperCase()}</div>
        <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.5, color: "#ece7d8", fontWeight: 700 }}>{item.text}</div>
      </div>
      <div style={{ background: "#07090d", padding: "5px 0", overflow: "hidden" }}>
        <div style={{ display: "flex", animation: "ticker-s 20s linear infinite", whiteSpace: "nowrap" }}>
          {[...START_HEADLINES, ...START_HEADLINES].map((h, i) => (
            <span key={i} className="mono-font" style={{ fontSize: 9, color: "#5a6070", paddingRight: 36 }}>
              <span style={{ color: "#9c8347", marginRight: 6 }}>{h.src}</span>{h.text}
            </span>
          ))}
        </div>
        <style>{`@keyframes ticker-s { from{transform:translateX(0)} to{transform:translateX(-50%)} }`}</style>
      </div>
      {START_HEADLINES.slice(1, 3).map((h, i) => (
        <div key={i} style={{ background: i % 2 === 0 ? "#0d1118" : "#0a0d14", padding: "6px 14px", borderTop: "1px solid #1a1f2c", display: "flex", gap: 8 }}>
          <span className="mono-font" style={{ fontSize: 8, color: "#4a5060", flexShrink: 0 }}>{h.src}</span>
          <span className="doc-font" style={{ fontSize: 11, color: "#6a7080", lineHeight: 1.4 }}>{h.text.slice(0, 80)}{h.text.length > 80 ? "…" : ""}</span>
        </div>
      ))}
    </div>
  );
}

const GAME_SLOT_LIMIT = 5;

function StartScreen({ authUser, onAuthSuccess, onNameChanged, onStart, myGames = [], myGamesLoading = false, onResume, onDeleteGame, onLeaderboard, onAdminOpen, onLogout }) {
  // auth form state
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // game start state (shown after auth)
  const [selectedCountry, setSelectedCountry] = useState("RU");
  const [selectedMode, setSelectedMode] = useState("advisor"); // "advisor" | "hardcore"
  const [presidentName, setPresidentName] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  // name editing state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState(null);

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed.length < 2) { setNameError("Минимум 2 символа"); return; }
    if (trimmed.length > 40) { setNameError("Максимум 40 символов"); return; }
    setNameLoading(true); setNameError(null);
    try {
      const res = await updateDisplayName(trimmed);
      onNameChanged && onNameChanged(res.displayName);
      setEditingName(false);
    } catch (err) {
      setNameError(err.message);
    } finally {
      setNameLoading(false);
    }
  }

  const [tapCount, setTapCount] = useState(0);
  const tapTimer = React.useRef(null);

  function handleSecretTap() {
    const next = tapCount + 1;
    setTapCount(next);
    clearTimeout(tapTimer.current);
    if (next >= 5) { setTapCount(0); onAdminOpen?.(); }
    else tapTimer.current = setTimeout(() => setTapCount(0), 1500);
  }

  async function handleAuth() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      let result;
      if (authMode === "login") {
        result = await login(username.trim(), password);
      } else {
        result = await register(username.trim(), password, displayName.trim() || username.trim());
      }
      setToken(result.token);
      onAuthSuccess(result);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleStart() {
    const country = COUNTRIES.find(c => c.id === selectedCountry);
    if (!country?.available) { setStartError("Эта страна пока недоступна"); return; }
    setStarting(true);
    setStartError(null);
    try {
      const { gameId } = await createGame(selectedCountry, selectedMode, presidentName.trim() || authUser.displayName);
      onStart(gameId, presidentName.trim() || authUser.displayName, selectedCountry);
    } catch (err) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const inputStyle = {
    width: "100%", background: "#ece7d8", color: "#262420",
    border: "2px solid #3a4156", borderRadius: 4,
    padding: "11px 14px", fontFamily: "'PT Serif',serif", fontSize: 15,
    outline: "none", marginBottom: 10,
  };

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
        .news-panel { display: none !important; }
        @media(min-width: 900px) { .news-panel { display: block !important; } }
      `}</style>

      <div style={{ background: "linear-gradient(180deg,#0f1318 0%,#1a1f2c 100%)", borderBottom: "2px solid #9c8347", padding: "32px 20px 24px", textAlign: "center" }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 10 }}>СОВЕРШЕННО СЕКРЕТНО</div>
        <h1 className="doc-font" style={{ margin: "0 0 6px", fontSize: 36, fontWeight: 700, letterSpacing: "0.04em" }}>REALPOLITIK</h1>
        <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", letterSpacing: "0.08em" }}>геополитическая стратегия</div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 48px", display: "flex", gap: 32, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          <div style={{ background: "#1f2733", border: "1px solid #2a3040", borderLeft: "3px solid #9c8347", borderRadius: 4, padding: "16px 18px", marginBottom: 28 }}>
            <div className="doc-font" style={{ fontSize: 15, color: "#ece7d8", lineHeight: 1.6, fontStyle: "italic" }}>
              Устал от бессилия, что не можешь ни на что повлиять?
            </div>
            <div className="doc-font" style={{ fontSize: 15, color: "#9c8347", lineHeight: 1.6, marginTop: 6, fontWeight: 700 }}>
              REALPOLITIK даёт тебе шанс сделать всё правильно — стань президентом.
            </div>
          </div>

          {!authUser ? (
            /* ——— AUTH FORM ——— */
            <div>
              <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1px solid #2a3040", borderRadius: 4, overflow: "hidden" }}>
                {["login", "register"].map(m => (
                  <button key={m} onClick={() => { setAuthMode(m); setAuthError(null); }}
                    style={{ flex: 1, background: authMode === m ? "#9c8347" : "#1f2733", color: authMode === m ? "#14181f" : "#5a6070", border: "none", padding: "10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, cursor: "pointer", letterSpacing: "0.08em", fontWeight: 700 }}>
                    {m === "login" ? "ВХОД" : "РЕГИСТРАЦИЯ"}
                  </button>
                ))}
              </div>

              <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ЛОГИН</div>
              <input value={username} onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAuth()}
                placeholder="имя пользователя" autoFocus style={inputStyle} />

              {authMode === "register" && (
                <>
                  <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ПОЗЫВНОЙ АККАУНТА (общий для всех партий)</div>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAuth()}
                    placeholder="Как вас называть в личном кабинете…" style={inputStyle} />
                </>
              )}

              <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ПАРОЛЬ</div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAuth()}
                placeholder="••••••" style={inputStyle} />

              {authError && <div className="doc-font" style={{ color: "#e09090", fontSize: 13.5, marginBottom: 14 }}>{authError}</div>}

              <button onClick={handleAuth} disabled={authLoading || !username.trim() || !password}
                style={{ width: "100%", background: authLoading || !username.trim() || !password ? "#2a3040" : "#9c8347", color: authLoading || !username.trim() || !password ? "#5a6070" : "#1a1f2c", border: "none", borderRadius: 4, padding: "14px", fontFamily: "'PT Serif',serif", fontSize: 16, fontWeight: 700, cursor: authLoading || !username.trim() || !password ? "not-allowed" : "pointer", letterSpacing: "0.04em" }}>
                {authLoading ? "Проверка допуска…" : authMode === "login" ? "Войти →" : "Зарегистрироваться →"}
              </button>
            </div>
          ) : (
            /* ——— GAME SELECTION (after auth) ——— */
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "10px 14px" }}>
                <div>
                  <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.1em" }}>ДОПУСК ПОДТВЕРЖДЁН · </span>
                  {editingName ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input
                        autoFocus
                        value={nameInput}
                        onChange={e => { setNameInput(e.target.value); setNameError(null); }}
                        onKeyDown={e => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                        style={{ background: "#111827", border: "1px solid #9c8347", borderRadius: 3, color: "#e8d5a3", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, padding: "2px 6px", width: 140, outline: "none" }}
                        maxLength={40}
                      />
                      <button onClick={handleSaveName} disabled={nameLoading} style={{ background: "#9c8347", border: "none", borderRadius: 3, color: "#0d1117", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer", padding: "3px 7px", fontWeight: 700 }}>{nameLoading ? "…" : "OK"}</button>
                      <button onClick={() => { setEditingName(false); setNameError(null); }} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 3, color: "#4a5060", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer", padding: "3px 6px" }}>✕</button>
                      {nameError && <span style={{ fontSize: 9, color: "#e05050" }}>{nameError}</span>}
                    </span>
                  ) : (
                    <span>
                      <span className="doc-font" style={{ fontSize: 14, color: "#9c8347", fontWeight: 700 }}>{authUser.displayName}</span>
                      <button onClick={() => { setNameInput(authUser.displayName); setEditingName(true); setNameError(null); }} title="Изменить имя" style={{ background: "none", border: "none", color: "#4a5060", fontSize: 11, cursor: "pointer", padding: "0 4px", verticalAlign: "middle" }}>✏</button>
                    </span>
                  )}
                  <span className="mono-font" style={{ fontSize: 9, color: "#3a4050", marginLeft: 6 }}>@{authUser.username}</span>
                </div>
                <button onClick={onLogout} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 3, color: "#4a5060", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer", padding: "4px 8px" }}>ВЫЙТИ</button>
              </div>

              {myGamesLoading ? (
                <div className="mono-font" style={{ fontSize: 10, color: "#5a6070", marginBottom: 24 }}>Загрузка партий…</div>
              ) : (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>СОХРАНЁННЫЕ ПАРТИИ</div>
                    <div className="mono-font" style={{ fontSize: 9, color: myGames.length >= GAME_SLOT_LIMIT ? "#e09090" : "#5a6070" }}>
                      {myGames.length}/{GAME_SLOT_LIMIT} слотов
                    </div>
                  </div>
                  {myGames.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {myGames.map(g => (
                        <div key={g.id}
                          style={{ display: "flex", alignItems: "center", gap: 12, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, padding: "12px 14px" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = "#2a3040"}>
                          <div style={{ fontSize: 22, flexShrink: 0, cursor: "pointer" }} onClick={() => onResume(g)}>{COUNTRY_FLAG[g.country_id] || "🌐"}</div>
                          <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onResume(g)}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span className="doc-font" style={{ fontSize: 14, color: "#ece7d8", fontWeight: 700 }}>{g.country_name}</span>
                              {g.president_name && <span className="mono-font" style={{ fontSize: 9, color: "#9c8347" }}>· {g.president_name}</span>}
                              {g.assist_mode === "hardcore" ? (
                                <span className="mono-font" title="Режим «Сам по себе» — без игровых подсказок" style={{ fontSize: 8, color: "#b06a6a", border: "1px solid #4a2020", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.04em" }}>🎖 САМ ПО СЕБЕ</span>
                              ) : (
                                <span className="mono-font" title="Режим «С советниками» — кабинет подсказывает ходы" style={{ fontSize: 8, color: "#6a9c7a", border: "1px solid #244a30", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.04em" }}>💡 С СОВЕТНИКАМИ</span>
                              )}
                            </div>
                            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>
                              Ход {g.current_turn} · {new Date(g.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                              {g.status !== "active" && <span style={{ color: "#a8313a", marginLeft: 6 }}>{g.status}</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <div className="mono-font" style={{ fontSize: 11, color: "#9c8347", cursor: "pointer" }} onClick={() => onResume(g)}>Продолжить →</div>
                            <button
                              onClick={e => { e.stopPropagation(); onDeleteGame(g.id); }}
                              style={{ background: "none", border: "1px solid #3a2020", borderRadius: 3, color: "#6a3535", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer", padding: "3px 6px", lineHeight: 1 }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = "#a8313a"; e.currentTarget.style.color = "#e09090"; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = "#3a2020"; e.currentTarget.style.color = "#6a3535"; }}
                              title="Удалить партию">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mono-font" style={{ fontSize: 10, color: "#3a4050", padding: "10px 0" }}>Нет сохранённых партий</div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 28 }}>
                <div style={{ marginBottom: 28 }}>
                <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ИМЯ ПРЕЗИДЕНТА (для этой партии)</div>
                <input value={presidentName} onChange={e => setPresidentName(e.target.value)}
                  placeholder={authUser.displayName} maxLength={40} style={{ ...inputStyle, marginBottom: 4 }} />
                <div className="mono-font" style={{ fontSize: 9, color: "#3a4050" }}>
                  Своё на каждую партию — отдельно от логина @{authUser.username}. Если несколько партий, в Зале славы они не перепутаются.
                </div>
              </div>

              <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 12 }}>ВЫБЕРИТЕ СТРАНУ</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {COUNTRIES.map(c => (
                    <div key={c.id}
                      className={`c-card${!c.available ? " locked" : ""}${selectedCountry === c.id ? " selected" : ""}`}
                      onClick={() => c.available && setSelectedCountry(c.id)}
                      style={{ background: selectedCountry === c.id ? "#1a2a1a" : "#1f2733", border: `2px solid ${selectedCountry === c.id ? "#9c8347" : "#2a3040"}`, borderRadius: 6, padding: "14px", cursor: c.available ? "pointer" : "not-allowed", opacity: c.available ? 1 : 0.4, position: "relative" }}>
                      {!c.available && <div className="mono-font" style={{ position: "absolute", top: 8, right: 8, fontSize: 8, color: "#4a5060", background: "#14181f", padding: "2px 5px", borderRadius: 2 }}>СКОРО</div>}
                      <div style={{ fontSize: 26, marginBottom: 6 }}>{c.flag}</div>
                      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: DIFFICULTY_COLOR[c.difficulty] || "#9c8347", marginBottom: 6 }}>{c.difficulty.toUpperCase()}</div>
                      <div className="doc-font" style={{ fontSize: 12, color: "#a8a294", lineHeight: 1.4 }}>{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 28 }}>
                <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 12 }}>РЕЖИМ ИГРЫ</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { id: "advisor", icon: "💡", title: "С советниками", desc: "Кабинет министров подсказывает оптимальные ходы и путь к победе. Вы можете следовать советам — или полностью формулировать свои указы. Доступен ликбез по механикам." },
                    { id: "hardcore", icon: "🎖", title: "Сам по себе", desc: "Никаких игровых подсказок. Советники молчат. Кабинет и варианты указов остаются. До победы — военной или дипломатической — додумываетесь сами." },
                  ].map(m => {
                    const sel = selectedMode === m.id;
                    return (
                      <div key={m.id}
                        onClick={() => setSelectedMode(m.id)}
                        style={{ background: sel ? (m.id === "hardcore" ? "#2a1a1a" : "#1a2a1a") : "#1f2733", border: `2px solid ${sel ? (m.id === "hardcore" ? "#a8313a" : "#9c8347") : "#2a3040"}`, borderRadius: 6, padding: "14px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
                        onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = "#9c8347"; }}
                        onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = "#2a3040"; }}>
                        <div style={{ fontSize: 24, marginBottom: 6 }}>{m.icon}</div>
                        <div className="doc-font" style={{ fontSize: 14, color: sel ? "#ece7d8" : "#a8a294", fontWeight: 700, marginBottom: 4 }}>{m.title}</div>
                        <div className="doc-font" style={{ fontSize: 11.5, color: "#7a8290", lineHeight: 1.4 }}>{m.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {startError && <div className="doc-font" style={{ color: "#e09090", fontSize: 13.5, marginBottom: 14 }}>{startError}</div>}

              {myGames.length >= GAME_SLOT_LIMIT ? (
                <div className="mono-font" style={{ textAlign: "center", color: "#6a3535", fontSize: 10, border: "1px solid #3a2020", borderRadius: 4, padding: "14px", letterSpacing: "0.06em" }}>
                  ВСЕ {GAME_SLOT_LIMIT} СЛОТОВ ЗАНЯТЫ — УДАЛИТЕ ОДНУ ПАРТИЮ
                </div>
              ) : (
                <button onClick={handleStart} disabled={starting}
                  style={{ width: "100%", background: starting ? "#2a3040" : "#9c8347", color: starting ? "#5a6070" : "#1a1f2c", border: "none", borderRadius: 4, padding: "14px", fontFamily: "'PT Serif',serif", fontSize: 16, fontWeight: 700, cursor: starting ? "not-allowed" : "pointer", letterSpacing: "0.04em" }}>
                  {starting ? "Инициализация досье…" : "Принять командование →"}
                </button>
              )}
            </div>
          )}

          <button onClick={onLeaderboard}
            style={{ width: "100%", marginTop: 10, background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, cursor: "pointer", letterSpacing: "0.06em" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c8347"; e.currentTarget.style.color = "#9c8347"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a3040"; e.currentTarget.style.color = "#5a6070"; }}>
            ЗАЛА СЛАВЫ — ТОП ПРЕЗИДЕНТОВ
          </button>

          <div style={{ marginTop: 18, background: "#14181f", border: "1px solid #2a3040", borderRadius: 4, padding: "10px 14px" }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#3a4050", letterSpacing: "0.08em", marginBottom: 4 }}>ДИСКЛЕЙМЕР</div>
            <div className="doc-font" style={{ fontSize: 11, color: "#3a4556", lineHeight: 1.5 }}>
              Все персонажи, имена и события в игре являются вымышленными. Любое сходство с реальными лицами случайно.
              Игра создана в образовательных и развлекательных целях. Мнения, выраженные в игре, не отражают взгляды авторов.
            </div>
          </div>
          <div className="mono-font" onClick={handleSecretTap}
            style={{ textAlign: "center", fontSize: 9, color: "#2a3040", marginTop: 10, letterSpacing: "0.08em", userSelect: "none", cursor: "default" }}>
            ДАННЫЕ НА ИЮНЬ 2026 · ВСЕ СОВПАДЕНИЯ СЛУЧАЙНЫ{tapCount > 0 ? ` ·` + "·".repeat(tapCount) : ""}
          </div>
        </div>

        <div className="news-panel" style={{ flex: "0 0 380px", minWidth: 0 }}>
          <NewsVideoPanel />
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

const STAT_KEYS = ["economy", "military", "stability", "diplomacy", "approval"];
const STAT_NAMES_RU = { economy: "Экономика", military: "Армия", stability: "Стабильность", diplomacy: "Дипломатия", approval: "Рейтинг" };

function InterventionForm({ password, game, onDone, onRefresh }) {
  const [mode, setMode] = useState("event"); // "event" | "foreign" | "stats" | "initiative"
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [action, setAction] = useState("");
  const [secret, setSecret] = useState(false);
  const [immediate, setImmediate] = useState(true);
  const [statDeltas, setStatDeltas] = useState({ economy: 0, military: 0, stability: 0, diplomacy: 0, approval: 0 });
  const [statsAbsolute, setStatsAbsolute] = useState(() => {
    const s = game.stats || {};
    return { economy: s.economy ?? 50, military: s.military ?? 50, stability: s.stability ?? 50, diplomacy: s.diplomacy ?? 50, approval: s.approval ?? 50 };
  });
  const [initiative, setInitiative] = useState(game.initiative ?? 100);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const inp = { width: "100%", background: "#0d1118", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 10px", color: "#ece7d8", fontFamily: "'PT Serif',serif", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box" };
  const btnStyle = (active) => ({ background: active ? "#9c8347" : "#1f2733", color: active ? "#14181f" : "#9c8347", border: "1px solid #9c8347", borderRadius: 4, padding: "5px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer", marginRight: 4, marginBottom: 4 });
  const numInp = { width: 60, background: "#0d1118", border: "1px solid #2a3040", borderRadius: 4, padding: "4px 6px", color: "#ece7d8", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none", textAlign: "center" };

  async function send() {
    setSending(true); setError(null); setResult(null);
    try {
      if (mode === "event") {
        const nonZeroDeltas = Object.fromEntries(Object.entries(statDeltas).filter(([, v]) => v !== 0));
        const res = await sendAdminEvent(password, game.game_id, { text, source: source || "Внешний источник", statDeltas: nonZeroDeltas, secret, immediate });
        setResult(immediate ? `Применено немедленно.` : "Поставлено в очередь — сработает при следующем ходе.");
        setText(""); setSource("");
      } else if (mode === "foreign") {
        const res = await sendForeignAction(password, game.game_id, { country, action, secret, immediate });
        setResult(`ИИ: "${res.preview?.narrative?.slice(0, 100)}…"`);
        setCountry(""); setAction("");
      } else if (mode === "stats") {
        await adminSetStats(password, game.game_id, statsAbsolute);
        setResult("Показатели обновлены.");
      } else if (mode === "initiative") {
        await adminSetInitiative(password, game.game_id, initiative);
        setResult(`Инициатива установлена: ${initiative}`);
      }
      onRefresh?.();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  const canSend = mode === "event" ? !!text
    : mode === "foreign" ? (!!country && !!action)
    : mode === "stats" ? true
    : true;

  return (
    <div style={{ background: "#0d1118", border: "1px solid #2a3040", borderRadius: 6, padding: "14px", marginTop: 8 }}>
      <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 10 }}>
        ВМЕШАТЕЛЬСТВО: {game.player_name} ({game.country_id}) · ХОД {game.current_turn}
      </div>
      <div style={{ marginBottom: 12, flexWrap: "wrap", display: "flex" }}>
        <button style={btnStyle(mode === "event")} onClick={() => setMode("event")}>Событие</button>
        <button style={btnStyle(mode === "foreign")} onClick={() => setMode("foreign")}>Ход страны</button>
        <button style={btnStyle(mode === "stats")} onClick={() => setMode("stats")}>Статы</button>
        <button style={btnStyle(mode === "initiative")} onClick={() => setMode("initiative")}>Инициатива</button>
      </div>

      {mode === "event" && (
        <>
          <input style={inp} placeholder="Источник (напр. «Reuters», «ЦРУ»)…" value={source} onChange={e => setSource(e.target.value)} />
          <textarea style={{ ...inp, height: 70, resize: "vertical" }} placeholder="Текст события…" value={text} onChange={e => setText(e.target.value)} />
          <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>ДЕЛЬТЫ СТАТОВ (0 = без изменений):</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
            {STAT_KEYS.map(k => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono-font" style={{ fontSize: 9, color: "#8a8070", width: 80 }}>{STAT_NAMES_RU[k]}</span>
                <input type="number" style={numInp} min={-20} max={20} value={statDeltas[k]} onChange={e => setStatDeltas(p => ({ ...p, [k]: Number(e.target.value) }))} />
              </label>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} />
            <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Немедленно (иначе — при следующем ходе)</span>
          </label>
        </>
      )}

      {mode === "foreign" && (
        <>
          <input style={inp} placeholder="Страна-агент (напр. «США», «Китай»)…" value={country} onChange={e => setCountry(e.target.value)} />
          <textarea style={{ ...inp, height: 70, resize: "vertical" }} placeholder="Что делает эта страна (ИИ сгенерирует последствия)…" value={action} onChange={e => setAction(e.target.value)} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} />
            <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Применить немедленно</span>
          </label>
        </>
      )}

      {mode === "stats" && (
        <>
          <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 8 }}>УСТАНОВИТЬ АБСОЛЮТНЫЕ ЗНАЧЕНИЯ (0–100):</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 10 }}>
            {STAT_KEYS.map(k => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mono-font" style={{ fontSize: 9, color: "#8a8070", width: 80 }}>{STAT_NAMES_RU[k]}</span>
                <input type="number" style={numInp} min={0} max={100} value={statsAbsolute[k]} onChange={e => setStatsAbsolute(p => ({ ...p, [k]: Number(e.target.value) }))} />
              </label>
            ))}
          </div>
        </>
      )}

      {mode === "initiative" && (
        <div style={{ marginBottom: 12 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 8 }}>УСТАНОВИТЬ ИНИЦИАТИВУ (0–200):</div>
          <input type="number" style={{ ...numInp, width: 80 }} min={0} max={200} value={initiative} onChange={e => setInitiative(Number(e.target.value))} />
        </div>
      )}

      {(mode === "event" || mode === "foreign") && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <input type="checkbox" checked={secret} onChange={e => setSecret(e.target.checked)} />
          <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Скрытое (не в ленту)</span>
        </label>
      )}

      {error && <div style={{ color: "#e09090", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {result && <div style={{ color: "#7fae93", fontSize: 12, marginBottom: 8 }}>{result}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={send} disabled={sending || !canSend}
          style={{ background: "#a8313a", color: "#ece7d8", border: "none", borderRadius: 4, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: (!canSend || sending) ? 0.5 : 1 }}>
          {sending ? "Отправка…" : "Применить →"}
        </button>
        <button onClick={onDone} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 12px", color: "#5a6070", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ onClose }) {
  const [step, setStep] = useState("auth");
  const [tab, setTab] = useState("stats");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [expandedGame, setExpandedGame] = useState(null); // "intervene" | "detail"
  const [expandedGameMode, setExpandedGameMode] = useState("intervene");
  const [playerDetail, setPlayerDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function handleAuth() {
    setLoading(true); setError(null);
    try {
      const data = await fetchAdminStats(password);
      setStats(data);
      setStep("main");
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function loadGames() {
    setGamesLoading(true);
    try {
      const data = await fetchAdminGames(password);
      setGames(data.games || []);
    } catch (e) { setError(e.message); }
    finally { setGamesLoading(false); }
  }

  useEffect(() => {
    if (step === "main" && tab === "games") loadGames();
  }, [step, tab]);

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'PT Serif',Georgia,serif" };
  const panel = { background: "#14181f", border: "1px solid #9c8347", borderRadius: 8, padding: "24px 24px 20px", width: "min(95vw, 700px)", maxHeight: "88vh", overflowY: "auto", color: "#ece7d8", position: "relative" };
  const tabBtn = (t) => ({ background: tab === t ? "#9c8347" : "none", color: tab === t ? "#14181f" : "#9c8347", border: "1px solid #9c8347", borderRadius: 4, padding: "5px 14px", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, cursor: "pointer", marginRight: 6 });

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: "#5a6070", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>

        {step === "auth" && (
          <>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 16 }}>КОМАНДНЫЙ ЦЕНТР · ДОСТУП ОГРАНИЧЕН</div>
            <div className="doc-font" style={{ fontSize: 15, marginBottom: 16 }}>Введите пароль геймастера</div>
            <input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()}
              placeholder="Пароль…" style={{ width: "100%", background: "#1f2733", border: "1px solid #3a4156", borderRadius: 4, padding: "10px 12px", color: "#ece7d8", fontFamily: "'PT Serif',serif", fontSize: 14, outline: "none", marginBottom: 12 }} />
            {error && <div style={{ color: "#e09090", fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <button onClick={handleAuth} disabled={loading || !password}
              style={{ background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "10px 20px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {loading ? "Проверка…" : "Войти →"}
            </button>
          </>
        )}

        {step === "main" && (
          <>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 16 }}>КОМАНДНЫЙ ЦЕНТР ГЕЙМАСТЕРА</div>
            <div style={{ marginBottom: 18 }}>
              <button style={tabBtn("stats")} onClick={() => setTab("stats")}>Статистика</button>
              <button style={tabBtn("games")} onClick={() => setTab("games")}>Вмешательство</button>
            </div>

            {tab === "stats" && stats && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                  {[
                    { label: "Игроков", value: stats.users.total, sub: `+${stats.users.today} сегодня` },
                    { label: "Партий", value: stats.games.total, sub: `${stats.games.active} активных` },
                    { label: "Ходов", value: stats.turns.total, sub: "всего" },
                  ].map(({ label, value, sub }) => (
                    <div key={label} style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 12px", textAlign: "center" }}>
                      <div className="mono-font" style={{ fontSize: 24, fontWeight: 700, color: "#9c8347" }}>{value}</div>
                      <div className="mono-font" style={{ fontSize: 9, color: "#ece7d8", marginTop: 4 }}>{label}</div>
                      <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>{sub}</div>
                    </div>
                  ))}
                </div>
                <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 8 }}>ВСЕ ИГРОКИ</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {stats.players.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 12px" }}>
                      <div style={{ fontSize: 16, flexShrink: 0 }}>{COUNTRY_FLAG_MAP[p.country_id] || "🌐"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="doc-font" style={{ fontSize: 13, fontWeight: 700 }}>{p.display_name}</div>
                        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>{new Date(p.created_at).toLocaleString("ru-RU")} · ход {p.current_turn}</div>
                      </div>
                      {p.score != null && <div className="mono-font" style={{ fontSize: 13, fontWeight: 700, color: "#9c8347" }}>{p.score}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "games" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>АКТИВНЫЕ ПАРТИИ</div>
                  <button onClick={loadGames} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "4px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer" }}>↻ Обновить</button>
                </div>
                {gamesLoading && <div className="mono-font" style={{ fontSize: 11, color: "#5a6070" }}>Загрузка…</div>}
                {!gamesLoading && games.length === 0 && <div className="mono-font" style={{ fontSize: 11, color: "#5a6070" }}>Нет активных партий</div>}
                {games.map(g => {
                  const isOpen = expandedGame === g.game_id;
                  const modeBtn = (m, label) => (
                    <button onClick={e => { e.stopPropagation(); setExpandedGame(g.game_id); setExpandedGameMode(m);
                      if (m === "detail" && expandedGame !== g.game_id) {
                        setDetailLoading(true); setPlayerDetail(null);
                        fetchAdminPlayerDetail(password, g.game_id).then(d => setPlayerDetail(d)).finally(() => setDetailLoading(false));
                      }
                    }}
                    style={{ background: isOpen && expandedGameMode === m ? "#9c8347" : "none", color: isOpen && expandedGameMode === m ? "#14181f" : "#9c8347", border: "1px solid #9c8347", borderRadius: 4, padding: "3px 8px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer" }}>
                      {label}
                    </button>
                  );
                  return (
                    <div key={g.game_id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#1f2733", border: `1px solid ${isOpen ? "#9c8347" : "#2a3040"}`, borderRadius: 6, padding: "10px 14px", marginBottom: 6 }}>
                        <div style={{ fontSize: 18 }}>{COUNTRY_FLAG_MAP[g.country_id] || "🌐"}</div>
                        <div style={{ flex: 1 }}>
                          <div className="doc-font" style={{ fontSize: 14, fontWeight: 700 }}>{g.player_name}</div>
                          <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>ход {g.current_turn} · {new Date(g.created_at).toLocaleString("ru-RU")}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {modeBtn("detail", "📋 Досье")}
                          {modeBtn("intervene", "⚡ Вмешаться")}
                          {isOpen && <button onClick={() => setExpandedGame(null)} style={{ background: "none", border: "none", color: "#5a6070", fontSize: 16, cursor: "pointer" }}>×</button>}
                        </div>
                      </div>
                      {isOpen && expandedGameMode === "intervene" && (
                        <InterventionForm password={password} game={g} onDone={() => setExpandedGame(null)} onRefresh={loadGames} />
                      )}
                      {isOpen && expandedGameMode === "detail" && (
                        <div style={{ background: "#0d1118", border: "1px solid #2a3040", borderRadius: 6, padding: "14px", marginBottom: 8 }}>
                          {detailLoading && <div className="mono-font" style={{ fontSize: 11, color: "#5a6070" }}>Загрузка досье…</div>}
                          {playerDetail && (
                            <>
                              <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 10 }}>ДОСЬЕ: {playerDetail.game?.player_name}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                                {Object.entries(playerDetail.game?.stats || {}).filter(([k]) => k !== "initiative").map(([k, v]) => (
                                  <div key={k} style={{ display: "flex", justifyContent: "space-between", background: "#1f2733", padding: "4px 8px", borderRadius: 3 }}>
                                    <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>{k}</span>
                                    <span className="mono-font" style={{ fontSize: 9, color: v > 60 ? "#7fae93" : v > 30 ? "#9c8347" : "#e09090" }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>ИСТОРИЯ ХОДОВ ({playerDetail.turns?.length})</div>
                              {playerDetail.turns?.map(t => (
                                <div key={t.turn_n} style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 10px", marginBottom: 5 }}>
                                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                                    <span className="mono-font" style={{ fontSize: 9, color: "#9c8347" }}>ХОД {t.turn_n}</span>
                                    <span className="mono-font" style={{ fontSize: 8, color: "#5a6070", background: "#0d1118", padding: "1px 5px", borderRadius: 2 }}>
                                      {t.action_mode === "intel" ? "🕵️ Разведка" : t.action_mode === "military" ? "⚔️ Военная" : "📜 Указ"} · {t.action_type}
                                    </span>
                                    {t.advisor_objection && <span className="mono-font" style={{ fontSize: 8, color: "#e09090" }}>⚠ возражение</span>}
                                  </div>
                                  <div className="doc-font" style={{ fontSize: 12, color: "#ece7d8", marginBottom: 4 }}>"{t.player_input}"</div>
                                  <div className="doc-font" style={{ fontSize: 11, color: "#8a8270", fontStyle: "italic" }}>{t.narrative_text}</div>
                                  {t.advisor_objection && <div className="doc-font" style={{ fontSize: 11, color: "#e09090", marginTop: 4 }}>Советник: {t.advisor_objection}</div>}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
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

function loadActiveGame() {
  try { return JSON.parse(localStorage.getItem("activeGame") || "null"); } catch { return null; }
}
function saveActiveGame(game) {
  try {
    if (game) localStorage.setItem("activeGame", JSON.stringify(game));
    else localStorage.removeItem("activeGame");
  } catch {}
}

function Root() {
  const [game, setGame] = useState(loadActiveGame);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [myGames, setMyGames] = useState([]);
  const [myGamesLoading, setMyGamesLoading] = useState(false);

  // Verify existing token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthChecked(true); return; }
    fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.id) {
          setAuthUser({ userId: data.id, username: data.username, displayName: data.display_name });
          loadMyGames();
        } else {
          setToken(null);
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  async function loadMyGames() {
    setMyGamesLoading(true);
    try {
      const { games } = await fetchMyGames();
      setMyGames(games || []);
    } catch {}
    finally { setMyGamesLoading(false); }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyA") { e.preventDefault(); setShowAdmin(v => !v); }
    }
    window.addEventListener("keydown", onKey);
    if (new URLSearchParams(window.location.search).has("admin")) setShowAdmin(true);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleAuthSuccess(result) {
    setAuthUser({ userId: result.userId, username: result.username, displayName: result.displayName });
    loadMyGames();
  }

  function handleNameChanged(newName) {
    setAuthUser(u => (u ? { ...u, displayName: newName } : u));
  }

  function handleLogout() {
    setToken(null);
    setAuthUser(null);
    setMyGames([]);
    saveActiveGame(null);
    setGame(null);
  }

  function handleStart(id, playerName, countryId) {
    const g = { id, name: playerName, isNew: true };
    saveActiveGame(g);
    setGame(g);
    // refresh my games list in background
    loadMyGames();
  }

  function handleResume(g) {
    const entry = { id: g.id, name: authUser?.displayName || "Президент", isNew: false };
    saveActiveGame(entry);
    setGame(entry);
  }

  function handleNewGame() {
    saveActiveGame(null);
    setGame(null);
  }

  async function handleDeleteGame(gameId) {
    if (!confirm("Удалить эту партию? Прогресс будет потерян навсегда.")) return;
    try {
      await deleteGame(gameId);
      setMyGames(prev => prev.filter(g => g.id !== gameId));
    } catch (err) {
      alert(err.message);
    }
  }

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", background: "#1a1f2c", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#5a6070", letterSpacing: "0.1em" }}>ПРОВЕРКА ДОПУСКА…</div>
      </div>
    );
  }

  let screen;
  if (game) screen = <App gameId={game.id} playerName={game.name} onNewGame={handleNewGame} showWelcome={game.isNew === true} />;
  else if (showLeaderboard) screen = <LeaderboardPage onBack={() => setShowLeaderboard(false)} />;
  else screen = <StartScreen authUser={authUser} onAuthSuccess={handleAuthSuccess} onNameChanged={handleNameChanged} onStart={handleStart} myGames={myGames} myGamesLoading={myGamesLoading} onResume={handleResume} onDeleteGame={handleDeleteGame} onLeaderboard={() => setShowLeaderboard(true)} onAdminOpen={() => setShowAdmin(true)} onLogout={handleLogout} />;

  return (
    <>
      {screen}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
