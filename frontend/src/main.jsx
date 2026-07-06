import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createGame, createUser, deleteGame, fetchLeaderboard, login, register, setToken, getToken, fetchMyGames, updateDisplayName } from "./api";
import { FeedbackModal } from "./FeedbackModal";

const API_BASE = import.meta.env.VITE_API_BASE || "https://realpolitik-game-production.up.railway.app";


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

function StartScreen({ authUser, onAuthSuccess, onNameChanged, onStart, myGames = [], myGamesLoading = false, onResume, onDeleteGame, onAdminOpen, onLogout, onLeaderboard }) {
  const [showFeedback, setShowFeedback] = useState(false);
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
  const [showInLeaderboard, setShowInLeaderboard] = useState(false);
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
      const { gameId } = await createGame(selectedCountry, selectedMode, presidentName.trim() || authUser.displayName, showInLeaderboard);
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

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={showInLeaderboard} onChange={e => setShowInLeaderboard(e.target.checked)}
                    style={{ marginTop: 2, accentColor: "#9c8347", cursor: "pointer", flexShrink: 0 }} />
                  <div>
                    <div className="mono-font" style={{ fontSize: 10, color: "#9c8347", letterSpacing: "0.06em", marginBottom: 2 }}>ДОБАВИТЬ В ЗАЛ СЛАВЫ</div>
                    <div className="doc-font" style={{ fontSize: 11, color: "#5a6070", lineHeight: 1.4 }}>Разрешить публикацию итогов этой партии в общем рейтинге. Имя президента и результат будут видны всем.</div>
                  </div>
                </label>
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

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => onLeaderboard?.()}
              style={{ flex: 1, background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, cursor: "pointer", letterSpacing: "0.06em" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c8347"; e.currentTarget.style.color = "#9c8347"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a3040"; e.currentTarget.style.color = "#5a6070"; }}>
              🏆 ЗАЛ СЛАВЫ
            </button>
            <button onClick={() => setShowFeedback(true)}
              style={{ flex: 1, background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, cursor: "pointer", letterSpacing: "0.06em" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c8347"; e.currentTarget.style.color = "#9c8347"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a3040"; e.currentTarget.style.color = "#5a6070"; }}>
              🐞 БАГ / ФИДБЕК
            </button>
          </div>

          <div style={{ marginTop: 18, background: "#2a2010", border: "1px solid #5a4520", borderRadius: 4, padding: "10px 14px" }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#c8a857", letterSpacing: "0.08em", marginBottom: 4 }}>⚠ АЛЬФА-ВЕРСИЯ</div>
            <div className="doc-font" style={{ fontSize: 11, color: "#a89868", lineHeight: 1.5 }}>
              Игра в активной разработке: возможны баги, дисбаланс и изменения механик задним числом. Прогресс партий может сбрасываться при крупных обновлениях.
              Нашли баг — нажмите «Сообщить о баге» выше.
            </div>
          </div>

          <div style={{ marginTop: 10, background: "#14181f", border: "1px solid #2a3040", borderRadius: 4, padding: "10px 14px" }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#3a4050", letterSpacing: "0.08em", marginBottom: 4 }}>ДИСКЛЕЙМЕР</div>
            <div className="doc-font" style={{ fontSize: 11, color: "#3a4556", lineHeight: 1.5 }}>
              Все персонажи, имена и события в игре являются вымышленными. Любое сходство с реальными лицами случайно.
              Игра создана в образовательных и развлекательных целях. Мнения, выраженные в игре, не отражают взгляды авторов.
            </div>
          </div>

          {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
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

const STAT_LABELS = { stability: "Стабильность", economy: "Экономика", military: "Армия", diplomacy: "Дипломатия", approval: "Рейтинг" };

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

  const maxScore = entries.length > 0 ? Math.max(...entries.map(e => e.score)) : 100;

  return (
    <div style={{ minHeight: "100vh", background: "#1a1f2c", padding: "24px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "6px 12px", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, cursor: "pointer" }}>← НАЗАД</button>
          <div className="mono-font" style={{ fontSize: 13, color: "#9c8347", letterSpacing: "0.1em" }}>🏆 ЗАЛ СЛАВЫ — ТОП ПРЕЗИДЕНТОВ</div>
        </div>

        {loading && <div className="mono-font" style={{ color: "#5a6070", fontSize: 11, textAlign: "center", padding: 40 }}>ЗАГРУЗКА…</div>}
        {error && <div className="doc-font" style={{ color: "#e09090", fontSize: 13, textAlign: "center", padding: 40 }}>{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="doc-font" style={{ color: "#5a6070", fontSize: 13, textAlign: "center", padding: 40, lineHeight: 1.6 }}>
            Зал Славы пуст.<br />
            <span style={{ fontSize: 11 }}>Включите «Добавить в Зал Славы» при создании партии — и ваш результат появится здесь.</span>
          </div>
        )}

        {entries.map((e, i) => {
          const flag = COUNTRY_FLAG[e.country_id] || "🌐";
          const pct = maxScore > 0 ? Math.round((e.score / maxScore) * 100) : 0;
          const breakdown = e.score_breakdown || {};
          return (
            <div key={e.game_id + e.turn_n} style={{ background: "#1f2733", border: `1px solid ${i === 0 ? "#9c8347" : "#2a3040"}`, borderRadius: 6, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 20, minWidth: 28 }}>{flag}</div>
                <div style={{ flex: 1 }}>
                  <div className="doc-font" style={{ fontSize: 14, fontWeight: 700, color: i === 0 ? "#9c8347" : "#ece7d8" }}>
                    {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : `${i + 1}. `}{e.player_name}
                  </div>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>{e.country_name} · ход {e.turn_n}</div>
                </div>
                <div className="mono-font" style={{ fontSize: 18, color: "#9c8347", fontWeight: 700 }}>{e.score}</div>
              </div>
              <div style={{ background: "#14181f", borderRadius: 3, height: 4, marginBottom: 8 }}>
                <div style={{ background: "#9c8347", height: 4, borderRadius: 3, width: `${pct}%`, transition: "width 0.4s" }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(STAT_LABELS).map(([k, label]) => (
                  breakdown[k] !== undefined ? (
                    <div key={k} className="mono-font" style={{ fontSize: 9, color: "#5a6070", background: "#14181f", borderRadius: 3, padding: "2px 6px" }}>
                      {label} {breakdown[k]}
                    </div>
                  ) : null
                ))}
              </div>
            </div>
          );
        })}

        <div className="mono-font" style={{ fontSize: 9, color: "#2a3040", textAlign: "center", marginTop: 16 }}>
          Показаны только партии с включённой публикацией
        </div>
      </div>
    </div>
  );
}

function loadSessions() {
  try { return JSON.parse(localStorage.getItem("savedSessions") || "[]"); } catch { return []; }
}
function saveSessions(sessions) {
  try { localStorage.setItem("savedSessions", JSON.stringify(sessions)); } catch {}
}

const COUNTRY_FLAG_MAP = { RU: "🇷🇺", US: "🇺🇸", CN: "🇨🇳", UA: "🇺🇦", DE: "🇩🇪", TR: "🇹🇷" };

const STAT_KEYS = ["economy", "military", "stability", "diplomacy", "approval"];
const STAT_NAMES_RU = { economy: "Экономика", military: "Армия", stability: "Стабильность", diplomacy: "Дипломатия", approval: "Рейтинг" };

// ─── ADMIN PANEL ────────────────────────────────────────────────────────────

const ADMIN_BASE = `${API_BASE}/admin`;
const adm = (pwd, path, opts = {}) =>
  fetch(`${ADMIN_BASE}${path}`, { ...opts, headers: { "x-admin-password": pwd, "Content-Type": "application/json", ...(opts.headers || {}) } });

const STATUS_LABEL = { new: "Новый", in_review: "В работе", resolved: "Решён", wontfix: "Не баг" };
const STATUS_COLOR = { new: "#e09090", in_review: "#9c8347", resolved: "#7fae93", wontfix: "#3a4156" };
const ACTION_MODE_ICON = { intel: "🕵️", military: "⚔️", diplomacy_op: "🤝", decree_fast: "📜", decree_reform: "📜", decree_program: "📜", decree: "📜", crisis: "⚡", regroup: "🔄" };

function StatBar({ label, value }) {
  const color = value > 60 ? "#7fae93" : value > 35 ? "#9c8347" : "#e09090";
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>{label}</span>
        <span className="mono-font" style={{ fontSize: 9, color }}>{value}</span>
      </div>
      <div style={{ height: 3, background: "#2a3040", borderRadius: 2 }}>
        <div style={{ height: 3, borderRadius: 2, background: color, width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

const UA_ACTION_TYPE_LABEL = {
  drone_strike: "Удар дронами", rail_sabotage: "Диверсия на ж/д", counterattack: "Контрнаступление",
  donbass_breakthrough: "Прорыв в Донбассе", dnipro_push: "Удары по Днепру", black_sea_strike: "Удар в Чёрном море",
  diplomatic_offensive: "Дипломатическое наступление", info_warfare: "Информационная война",
  sanctions_push: "Давление санкциями", grain_corridor_pressure: "Зерновой коридор",
  weapons_delivery: "Поставки оружия", foreign_volunteers: "Иностранные добровольцы",
  partisan_resistance: "Партизанское сопротивление", war_crimes_tribunal: "Трибунал по военным преступлениям",
  pow_exchange_pr: "PR обмена пленными", soldier_leaks: "Утечка о потерях",
};
const UA_DELTA_KEYS = [
  "economy", "military", "stability", "diplomacy", "approval", "peace_progress",
  "army_morale", "readiness", "kharkiv_control", "kherson_control", "zaporizhzhia_control", "donetsk_control", "luhansk_control",
];
const UA_DELTA_LABEL = {
  economy: "Экономика", military: "Армия", stability: "Стабильность", diplomacy: "Дипломатия", approval: "Рейтинг",
  peace_progress: "Мирный трек", army_morale: "Боевой дух", readiness: "Готовность",
  kharkiv_control: "Харьков", kherson_control: "Херсон", zaporizhzhia_control: "Запорожье",
  donetsk_control: "Донецк", luhansk_control: "Луганск",
};
const ADVISOR_LABEL = { defense: "Белоев (оборона)", foreign: "Лавин (МИД)", finance: "Силин (финансы)", security: "Патров (СБ)", press: "Пестов (пресс)" };

function InterventionPanel({ pwd, gameId, gameName, countryId, currentTurn, stats, initiative, onRefresh }) {
  const [mode, setMode] = useState("event");
  const [text, setText] = useState(""); const [source, setSource] = useState("");
  const [country, setCountry] = useState(""); const [action, setAction] = useState("");
  const [secret, setSecret] = useState(false); const [immediate, setImmediate] = useState(true);
  const [statDeltas, setStatDeltas] = useState({ economy: 0, military: 0, stability: 0, diplomacy: 0, approval: 0 });
  const [statsAbs, setStatsAbs] = useState({ economy: stats?.economy ?? 50, military: stats?.military ?? 50, stability: stats?.stability ?? 50, diplomacy: stats?.diplomacy ?? 50, approval: stats?.approval ?? 50 });
  const [initVal, setInitVal] = useState(initiative ?? 100);
  const [uaActionType, setUaActionType] = useState("drone_strike");
  const [uaTitle, setUaTitle] = useState(""); const [uaText, setUaText] = useState("");
  const [uaDeltas, setUaDeltas] = useState(() => Object.fromEntries(UA_DELTA_KEYS.map(k => [k, 0])));
  const [advisorId, setAdvisorId] = useState("finance");
  const [advisorNote, setAdvisorNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); const [error, setError] = useState(null);

  const inp = { width: "100%", background: "#0d1118", border: "1px solid #2a3040", borderRadius: 4, padding: "7px 10px", color: "#ece7d8", fontFamily: "'PT Serif',serif", fontSize: 13, outline: "none", marginBottom: 7, boxSizing: "border-box" };
  const numInp = { width: 56, background: "#0d1118", border: "1px solid #2a3040", borderRadius: 4, padding: "4px 6px", color: "#ece7d8", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none", textAlign: "center" };
  const mBtn = (m, lbl) => (
    <button key={m} onClick={() => setMode(m)}
      style={{ background: mode === m ? "#9c8347" : "none", color: mode === m ? "#14181f" : "#9c8347", border: "1px solid #9c8347", borderRadius: 4, padding: "4px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer" }}>
      {lbl}
    </button>
  );

  async function send() {
    setSending(true); setError(null); setResult(null);
    try {
      if (mode === "event") {
        const deltas = Object.fromEntries(Object.entries(statDeltas).filter(([, v]) => v !== 0));
        await adm(pwd, `/games/${gameId}/event`, { method: "POST", body: JSON.stringify({ text, source: source || "Внешний источник", statDeltas: deltas, secret, immediate }) });
        setResult(immediate ? "Применено немедленно." : "В очереди — сработает при следующем ходе."); setText(""); setSource("");
      } else if (mode === "foreign") {
        const r = await adm(pwd, `/games/${gameId}/foreign-action`, { method: "POST", body: JSON.stringify({ country, action, secret, immediate }) });
        const d = await r.json();
        setResult(`ИИ: "${(d.preview?.narrative || "").slice(0, 120)}…"`); setCountry(""); setAction("");
      } else if (mode === "stats") {
        await adm(pwd, `/games/${gameId}/set-stats`, { method: "POST", body: JSON.stringify({ stats: statsAbs }) });
        setResult("Показатели обновлены.");
      } else if (mode === "initiative") {
        await adm(pwd, `/games/${gameId}/set-initiative`, { method: "POST", body: JSON.stringify({ initiative: initVal }) });
        setResult(`Инициатива: ${initVal}`);
      } else if (mode === "ukraine") {
        const deltas = Object.fromEntries(Object.entries(uaDeltas).filter(([, v]) => v !== 0));
        await adm(pwd, `/games/${gameId}/ukraine-action`, { method: "POST", body: JSON.stringify({ action_type: uaActionType, title: uaTitle, text: uaText, deltas }) });
        setResult("В очереди — сработает как ход Украины на следующем ходу игрока."); setUaTitle(""); setUaText("");
      } else if (mode === "advisor") {
        await adm(pwd, `/games/${gameId}/advisor-note`, { method: "POST", body: JSON.stringify({ advisorId, text: advisorNote }) });
        setResult(advisorNote.trim() ? `Заметка для «${ADVISOR_LABEL[advisorId]}» сохранена.` : `Заметка для «${ADVISOR_LABEL[advisorId]}» очищена.`);
      }
      onRefresh?.();
    } catch (e) { setError(e.message); } finally { setSending(false); }
  }

  const canSend = mode === "event" ? !!text
    : mode === "foreign" ? (!!country && !!action)
    : mode === "ukraine" ? (!!uaTitle && !!uaText)
    : true;

  return (
    <div style={{ background: "#0d1118", border: "1px solid #3a4156", borderRadius: 6, padding: 14, marginTop: 8 }}>
      <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 10 }}>⚡ ВМЕШАТЕЛЬСТВО · {gameName} ({countryId}) · ХОД {currentTurn}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["event","Событие"],["foreign","Ход страны"],["stats","Статы"],["initiative","Инициатива"],["ukraine","Украина"],["advisor","Советник"]].map(([m,l]) => mBtn(m,l))}
      </div>
      {mode === "event" && <>
        <input style={inp} placeholder="Источник…" value={source} onChange={e => setSource(e.target.value)} />
        <textarea style={{ ...inp, height: 70, resize: "vertical" }} placeholder="Текст события…" value={text} onChange={e => setText(e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", marginBottom: 8 }}>
          {STAT_KEYS.map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", width: 78 }}>{STAT_NAMES_RU[k]}</span>
              <input type="number" style={numInp} min={-20} max={20} value={statDeltas[k]} onChange={e => setStatDeltas(p => ({ ...p, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} />
          <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Немедленно</span>
        </label>
      </>}
      {mode === "foreign" && <>
        <input style={inp} placeholder="Страна-агент…" value={country} onChange={e => setCountry(e.target.value)} />
        <textarea style={{ ...inp, height: 70, resize: "vertical" }} placeholder="Действие страны (ИИ сгенерирует последствия)…" value={action} onChange={e => setAction(e.target.value)} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} />
          <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Немедленно</span>
        </label>
      </>}
      {mode === "stats" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 10 }}>
          {STAT_KEYS.map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", width: 78 }}>{STAT_NAMES_RU[k]}</span>
              <input type="number" style={numInp} min={0} max={100} value={statsAbs[k]} onChange={e => setStatsAbs(p => ({ ...p, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      )}
      {mode === "initiative" && (
        <div style={{ marginBottom: 10 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>Инициатива (0–200):</div>
          <input type="number" style={{ ...numInp, width: 80 }} min={0} max={200} value={initVal} onChange={e => setInitVal(Number(e.target.value))} />
        </div>
      )}
      {mode === "ukraine" && <>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>
          Действие ставится в очередь и сработает как ход Украины на следующем ходу игрока (заменяет собой ИИ/случайный выбор на этот раз).
        </div>
        <select style={{ ...inp, cursor: "pointer" }} value={uaActionType} onChange={e => setUaActionType(e.target.value)}>
          {Object.entries(UA_ACTION_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input style={inp} placeholder="Заголовок новости…" value={uaTitle} onChange={e => setUaTitle(e.target.value)} />
        <textarea style={{ ...inp, height: 70, resize: "vertical" }} placeholder="Текст новости от лица Украины…" value={uaText} onChange={e => setUaText(e.target.value)} />
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 4 }}>Дельты статов (опционально, 0 = не трогать):</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", marginBottom: 8 }}>
          {UA_DELTA_KEYS.map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", width: 78 }}>{UA_DELTA_LABEL[k]}</span>
              <input type="number" style={numInp} min={-40} max={40} value={uaDeltas[k]} onChange={e => setUaDeltas(p => ({ ...p, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      </>}
      {mode === "advisor" && <>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 6 }}>
          Переопределяет рекомендацию министра на карточке советников — держится, пока не смените текст или не очистите (пустое поле = очистить).
        </div>
        <select style={{ ...inp, cursor: "pointer" }} value={advisorId} onChange={e => setAdvisorId(e.target.value)}>
          {Object.entries(ADVISOR_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <textarea style={{ ...inp, height: 90, resize: "vertical" }} placeholder="Текст рекомендации от лица министра… (пусто — очистить заметку)" value={advisorNote} onChange={e => setAdvisorNote(e.target.value)} />
      </>}
      {(mode === "event" || mode === "foreign") && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
          <input type="checkbox" checked={secret} onChange={e => setSecret(e.target.checked)} />
          <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Скрытое (не в ленту)</span>
        </label>
      )}
      {error && <div style={{ color: "#e09090", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {result && <div style={{ color: "#7fae93", fontSize: 12, marginBottom: 8 }}>{result}</div>}
      <button onClick={send} disabled={sending || !canSend}
        style={{ background: "#a8313a", color: "#ece7d8", border: "none", borderRadius: 4, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: (!canSend || sending) ? 0.5 : 1 }}>
        {sending ? "Отправка…" : "Применить →"}
      </button>
    </div>
  );
}

// ── Вкладка «Игроки» ────────────────────────────────────────────────────────
function useAdminMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

function AdminTabPlayers({ pwd }) {
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // userId
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedGame, setExpandedGame] = useState(null); // gameId
  const [interveneGame, setInterveneGame] = useState(null); // gameId
  const isMobile = useAdminMobile();

  useEffect(() => {
    adm(pwd, "/users").then(r => r.json()).then(d => setUsers(d.users || [])).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  function openUser(userId) {
    setSelected(userId); setDetail(null); setDetailLoading(true); setExpandedGame(null); setInterveneGame(null);
    adm(pwd, `/users/${userId}`).then(r => r.json()).then(d => setDetail(d)).catch(e => setError(e.message)).finally(() => setDetailLoading(false));
  }

  if (loading) return <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", padding: 20 }}>Загрузка…</div>;
  if (error) return <div style={{ color: "#e09090", fontSize: 13, padding: 20 }}>{error}</div>;

  return (
    <div style={{ display: "flex", gap: 0, height: "100%" }}>
      {/* Список игроков — на мобильном скрыт, когда выбран игрок */}
      {(!isMobile || !selected) && (
      <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0, borderRight: isMobile ? "none" : "1px solid #2a3040", overflowY: "auto", height: "100%" }}>
        <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", padding: "10px 14px 6px", letterSpacing: "0.1em" }}>
          ВСЕГО: {users.length}
        </div>
        {users.map(u => (
          <div key={u.id} onClick={() => openUser(u.id)}
            style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1a1f2c", background: selected === u.id ? "#1f2a1a" : "transparent",
              borderLeft: selected === u.id ? "3px solid #9c8347" : "3px solid transparent" }}
            onMouseEnter={e => { if (selected !== u.id) e.currentTarget.style.background = "#1f2733"; }}
            onMouseLeave={e => { if (selected !== u.id) e.currentTarget.style.background = "transparent"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span title={u.online ? "Онлайн сейчас" : "Не в сети"}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: u.online ? "#5ac97f" : "#3a4156", flexShrink: 0,
                    boxShadow: u.online ? "0 0 5px #5ac97f" : "none" }} />
                <div className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#ece7d8" }}>{u.display_name}</div>
              </div>
              {u.games_active > 0 && <div style={{ fontSize: 9, background: "#2a3a1a", color: "#7fae93", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>active</div>}
            </div>
            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2 }}>
              @{u.username || "anon"} · {u.games_total} парт. · {u.max_turn || 0} ходов макс
            </div>
            {u.last_active && <div className="mono-font" style={{ fontSize: 8, color: "#3a4156", marginTop: 1 }}>
              {new Date(u.last_active).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>}
          </div>
        ))}
      </div>
      )}

      {/* Детальный вид — на мобильном показан только когда выбран игрок */}
      {(!isMobile || selected) && (
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 20px", height: "100%", width: isMobile ? "100%" : undefined }}>
        {isMobile && selected && (
          <button onClick={() => setSelected(null)}
            style={{ background: "none", border: "none", color: "#9c8347", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: "12px 14px", cursor: "pointer" }}>
            ← Все игроки
          </button>
        )}
        {!selected && (
          <div className="mono-font" style={{ fontSize: 11, color: "#3a4156", padding: 30, textAlign: "center" }}>← Выберите игрока</div>
        )}
        {detailLoading && <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", padding: 20 }}>Загрузка досье…</div>}
        {detail && (
          <>
            {/* Шапка игрока */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a3040", background: "#0d1118" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="doc-font" style={{ fontSize: 18, fontWeight: 700, color: "#ece7d8" }}>{detail.user.display_name}</div>
                  <div className="mono-font" style={{ fontSize: 10, color: "#5a6070", marginTop: 2 }}>
                    @{detail.user.username || "anon"} · {new Date(detail.user.created_at).toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <div className="mono-font" style={{ fontSize: 22, fontWeight: 700, color: "#9c8347" }}>{detail.games.length} парт.</div>
              </div>
            </div>

            {/* Партии */}
            <div style={{ padding: "12px 20px" }}>
              {detail.games.length === 0 && <div className="mono-font" style={{ fontSize: 11, color: "#3a4156" }}>Нет партий</div>}
              {detail.games.map(g => {
                const isOpen = expandedGame === g.id;
                const isIntervene = interveneGame === g.id;
                const stats = g.stats || {};
                const CORE = ["economy","military","stability","diplomacy","approval"];
                return (
                  <div key={g.id} style={{ background: "#1a1f2c", border: `1px solid ${isOpen ? "#9c8347" : "#2a3040"}`, borderRadius: 6, marginBottom: 10 }}>
                    {/* Строка партии */}
                    <div style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
                      onClick={() => { setExpandedGame(isOpen ? null : g.id); setInterveneGame(null); }}>
                      <div style={{ fontSize: 20 }}>{COUNTRY_FLAG_MAP[g.country_id] || "🌐"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          <div className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#ece7d8" }}>
                            {g.president_name || detail.user.display_name}
                          </div>
                          <div className="mono-font" style={{ fontSize: 8, color: g.status === "active" ? "#7fae93" : "#3a4156", background: "#0d1118", borderRadius: 3, padding: "1px 5px" }}>
                            {g.status}
                          </div>
                          {g.score != null && <div className="mono-font" style={{ fontSize: 9, color: "#9c8347" }}>★ {g.score}</div>}
                        </div>
                        <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginTop: 2 }}>
                          ход {g.current_turn} · {g.country_name} · {g.assist_mode} · {new Date(g.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        {g.status === "active" && (
                          <button onClick={e => { e.stopPropagation(); setInterveneGame(isIntervene ? null : g.id); setExpandedGame(isIntervene ? expandedGame : g.id); }}
                            style={{ background: isIntervene ? "#a8313a" : "none", color: isIntervene ? "#ece7d8" : "#a8313a", border: "1px solid #a8313a", borderRadius: 4, padding: "3px 8px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, cursor: "pointer" }}>
                            ⚡
                          </button>
                        )}
                        <span style={{ color: "#5a6070", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: "1px solid #2a3040", padding: "12px 14px" }}>
                        {/* Интервенция */}
                        {isIntervene && (
                          <InterventionPanel pwd={pwd} gameId={g.id} gameName={detail.user.display_name} countryId={g.country_id}
                            currentTurn={g.current_turn} stats={g.stats} initiative={g.stats?.initiative}
                            onRefresh={() => adm(pwd, `/users/${detail.user.id}`).then(r => r.json()).then(d => setDetail(d))} />
                        )}

                        {/* Мини-статы */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginTop: 10, marginBottom: 12 }}>
                          {CORE.map(k => <StatBar key={k} label={STAT_NAMES_RU[k] || k} value={stats[k] ?? 0} />)}
                        </div>
                        {stats.peace_progress != null && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                              <span className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>Мирный трек</span>
                              <span className="mono-font" style={{ fontSize: 9, color: "#5b6b8c" }}>{stats.peace_progress}%</span>
                            </div>
                            <div style={{ height: 3, background: "#2a3040", borderRadius: 2 }}>
                              <div style={{ height: 3, borderRadius: 2, background: "#5b6b8c", width: `${Math.min(100, stats.peace_progress)}%` }} />
                            </div>
                          </div>
                        )}

                        {/* Ходы */}
                        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 8 }}>ИСТОРИЯ ХОДОВ ({g.turns.length})</div>
                        {g.turns.length === 0 && <div className="mono-font" style={{ fontSize: 10, color: "#3a4156" }}>Ходов ещё нет</div>}
                        {g.turns.map(t => (
                          <div key={t.turn_n} style={{ background: "#0d1118", border: "1px solid #1a1f2c", borderRadius: 4, padding: "8px 10px", marginBottom: 5 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
                              <span className="mono-font" style={{ fontSize: 9, color: "#9c8347", minWidth: 44 }}>ХОД {t.turn_n}</span>
                              <span className="mono-font" style={{ fontSize: 8, color: "#5a6070", background: "#1a1f2c", padding: "1px 5px", borderRadius: 2 }}>
                                {ACTION_MODE_ICON[t.action_mode] || "📜"} {t.action_mode} · {t.action_type || "—"}
                              </span>
                              {t.advisor_objection && <span className="mono-font" style={{ fontSize: 8, color: "#e09090" }}>⚠ возражение</span>}
                            </div>
                            <div className="doc-font" style={{ fontSize: 12, color: "#c8c0a8", marginBottom: 3 }}>«{t.player_input}»</div>
                            <div className="doc-font" style={{ fontSize: 11, color: "#6a6258", fontStyle: "italic", lineHeight: 1.4 }}>{t.narrative_text}</div>
                            {t.advisor_objection && <div className="doc-font" style={{ fontSize: 10, color: "#a84040", marginTop: 3 }}>Советник: {t.advisor_objection}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}

// ── Вкладка «Партии» ─────────────────────────────────────────────────────────
function AdminTabGames({ pwd }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [intervene, setIntervene] = useState(null);

  function load() {
    setLoading(true);
    adm(pwd, "/games").then(r => r.json()).then(d => setGames(d.games || [])).catch(e => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  if (loading) return <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", padding: 20 }}>Загрузка…</div>;
  if (error) return <div style={{ color: "#e09090", padding: 20 }}>{error}</div>;

  return (
    <div style={{ padding: "12px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>АКТИВНЫЕ ПАРТИИ · {games.length}</div>
        <button onClick={load} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "4px 10px", fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>↻</button>
      </div>
      {games.length === 0 && <div className="mono-font" style={{ fontSize: 11, color: "#3a4156" }}>Нет активных партий</div>}
      {games.map(g => {
        const isOpen = expanded === g.game_id;
        const stats = g.stats || {};
        const CORE = ["economy","military","stability","diplomacy","approval"];
        return (
          <div key={g.game_id} style={{ background: "#1a1f2c", border: `1px solid ${isOpen ? "#9c8347" : "#2a3040"}`, borderRadius: 6, marginBottom: 8 }}>
            <div style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
              onClick={() => { setExpanded(isOpen ? null : g.game_id); setIntervene(null); }}>
              <div style={{ fontSize: 18 }}>{COUNTRY_FLAG_MAP[g.country_id] || "🌐"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span title={g.online ? "Онлайн сейчас" : "Не в сети"}
                    style={{ width: 7, height: 7, borderRadius: "50%", background: g.online ? "#5ac97f" : "#3a4156", flexShrink: 0,
                      boxShadow: g.online ? "0 0 5px #5ac97f" : "none" }} />
                  <div className="doc-font" style={{ fontSize: 13, fontWeight: 700 }}>{g.player_name}</div>
                </div>
                <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginTop: 2 }}>ход {g.current_turn} · {new Date(g.created_at).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button onClick={e => { e.stopPropagation(); setIntervene(intervene === g.game_id ? null : g.game_id); setExpanded(g.game_id); }}
                  style={{ background: intervene === g.game_id ? "#a8313a" : "none", color: intervene === g.game_id ? "#ece7d8" : "#a8313a", border: "1px solid #a8313a", borderRadius: 4, padding: "3px 8px", fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>⚡</button>
                <span style={{ color: "#5a6070", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{ borderTop: "1px solid #2a3040", padding: "12px 14px" }}>
                {intervene === g.game_id && (
                  <InterventionPanel pwd={pwd} gameId={g.game_id} gameName={g.player_name} countryId={g.country_id}
                    currentTurn={g.current_turn} stats={stats} initiative={g.initiative} onRefresh={load} />
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginTop: 10 }}>
                  {CORE.map(k => <StatBar key={k} label={STAT_NAMES_RU[k] || k} value={stats[k] ?? 0} />)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Вкладка «Репорты» ────────────────────────────────────────────────────────
function AdminTabFeedback({ pwd }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [updating, setUpdating] = useState(null); // id

  function load() {
    setLoading(true);
    const qs = filter !== "all" ? `?status=${filter}` : "";
    adm(pwd, `/feedback${qs}`).then(r => r.json()).then(d => setItems(d.items || [])).finally(() => setLoading(false));
  }
  useEffect(load, [filter]);

  async function setStatus(id, status) {
    setUpdating(id);
    await adm(pwd, `/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    setUpdating(null);
  }

  const FILTERS = [["all","Все"],["new","Новые"],["in_review","В работе"],["resolved","Решённые"],["wontfix","Не баг"]];

  return (
    <div style={{ padding: "12px 20px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ background: filter === v ? "#9c8347" : "none", color: filter === v ? "#14181f" : "#9c8347", border: "1px solid #9c8347", borderRadius: 4, padding: "4px 10px", fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>
            {l}
          </button>
        ))}
        <button onClick={load} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "4px 10px", fontFamily: "monospace", fontSize: 9, cursor: "pointer", marginLeft: "auto" }}>↻</button>
      </div>
      {loading && <div className="mono-font" style={{ fontSize: 11, color: "#5a6070" }}>Загрузка…</div>}
      {!loading && items.length === 0 && <div className="mono-font" style={{ fontSize: 11, color: "#3a4156" }}>Нет репортов</div>}
      {items.map(item => (
        <div key={item.id} style={{ background: "#1a1f2c", border: `1px solid ${STATUS_COLOR[item.status] || "#2a3040"}40`, borderLeft: `3px solid ${STATUS_COLOR[item.status] || "#2a3040"}`, borderRadius: 6, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 12 }}>
            <div>
              <span className="mono-font" style={{ fontSize: 9, color: STATUS_COLOR[item.status], background: "#0d1118", borderRadius: 3, padding: "2px 6px" }}>
                {STATUS_LABEL[item.status] || item.status}
              </span>
              {item.user_name && <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginLeft: 8 }}>{item.user_name} (@{item.username})</span>}
              {item.page && <span className="mono-font" style={{ fontSize: 9, color: "#3a4156", marginLeft: 8 }}>{item.page}</span>}
            </div>
            <div className="mono-font" style={{ fontSize: 8, color: "#3a4156", whiteSpace: "nowrap" }}>
              {new Date(item.created_at).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
            </div>
          </div>
          <div className="doc-font" style={{ fontSize: 13, color: "#ece7d8", lineHeight: 1.5, marginBottom: 8, whiteSpace: "pre-wrap" }}>{item.message}</div>
          {item.contact && (
            <div className="mono-font" style={{ fontSize: 10, color: "#5a6070", marginBottom: 8 }}>Контакт: {item.contact}</div>
          )}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.entries(STATUS_LABEL).map(([s, l]) => s !== item.status && (
              <button key={s} onClick={() => setStatus(item.id, s)} disabled={updating === item.id}
                style={{ background: "none", border: `1px solid ${STATUS_COLOR[s]}`, borderRadius: 4, color: STATUS_COLOR[s], padding: "3px 8px", fontFamily: "monospace", fontSize: 8, cursor: "pointer", opacity: updating === item.id ? 0.5 : 1 }}>
                → {l}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Вкладка «Статистика» ─────────────────────────────────────────────────────
function AdminTabStats({ pwd }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adm(pwd, "/stats").then(r => r.json()).then(d => setStats(d)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", padding: 20 }}>Загрузка…</div>;
  if (!stats) return null;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Игроков", value: stats.users?.total, sub: `+${stats.users?.today} сегодня` },
          { label: "Партий", value: stats.games?.total, sub: `${stats.games?.active} активных` },
          { label: "Ходов", value: stats.turns?.total, sub: "всего" },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, padding: "16px 12px", textAlign: "center" }}>
            <div className="mono-font" style={{ fontSize: 28, fontWeight: 700, color: "#9c8347" }}>{value}</div>
            <div className="mono-font" style={{ fontSize: 9, color: "#ece7d8", marginTop: 4 }}>{label}</div>
            <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10 }}>ПОСЛЕДНИЕ ПАРТИИ</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {(stats.players || []).map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 12px" }}>
            <div style={{ fontSize: 16 }}>{COUNTRY_FLAG_MAP[p.country_id] || "🌐"}</div>
            <div style={{ flex: 1 }}>
              <div className="doc-font" style={{ fontSize: 13, fontWeight: 700 }}>{p.display_name}</div>
              <div className="mono-font" style={{ fontSize: 8, color: "#5a6070" }}>{new Date(p.created_at).toLocaleString("ru-RU")} · ход {p.current_turn} · {p.status}</div>
            </div>
            {p.score != null && <div className="mono-font" style={{ fontSize: 13, color: "#9c8347", fontWeight: 700 }}>★ {p.score}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Главная админ-панель (полноэкранная страница) ────────────────────────────
function AdminPanel({ onClose }) {
  const [step, setStep] = useState("auth");
  const [tab, setTab] = useState("players");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const isMobile = useAdminMobile();

  async function handleAuth() {
    setAuthLoading(true); setAuthError(null);
    try {
      const r = await adm(password, "/stats");
      if (!r.ok) throw new Error("Неверный пароль");
      setStep("main");
    } catch (e) { setAuthError(e.message); } finally { setAuthLoading(false); }
  }

  const TABS = [["players","👥 Игроки"],["games","🎮 Партии"],["feedback","🐞 Репорты"],["stats","📊 Статистика"]];
  const TABS_MOBILE = [["players","👥"],["games","🎮"],["feedback","🐞"],["stats","📊"]];

  if (step === "auth") return (
    <div style={{ position: "fixed", inset: 0, background: "#1a1f2c", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'PT Serif',Georgia,serif" }}>
      <div style={{ background: "#14181f", border: "1px solid #9c8347", borderRadius: 8, padding: "32px 28px", width: "min(95vw,400px)", color: "#ece7d8" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 8, right: 12, background: "none", border: "none", color: "#5a6070", fontSize: 22, cursor: "pointer" }}>×</button>
        <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#9c8347", marginBottom: 16 }}>КОМАНДНЫЙ ЦЕНТР · ДОСТУП ОГРАНИЧЕН</div>
        <div className="doc-font" style={{ fontSize: 15, marginBottom: 16 }}>Пароль геймастера</div>
        <input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()}
          placeholder="Пароль…" style={{ width: "100%", background: "#1f2733", border: "1px solid #3a4156", borderRadius: 4, padding: "10px 12px", color: "#ece7d8", fontFamily: "'PT Serif',serif", fontSize: 14, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
        {authError && <div style={{ color: "#e09090", fontSize: 13, marginBottom: 10 }}>{authError}</div>}
        <button onClick={handleAuth} disabled={authLoading || !password}
          style={{ background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "10px 20px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {authLoading ? "Проверка…" : "Войти →"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d1118", zIndex: 9999, display: "flex", flexDirection: "column", fontFamily: "'PT Serif',Georgia,serif" }}>
      {/* Шапка */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: "1px solid #2a3040", background: "#14181f", flexShrink: 0 }}>
        {!isMobile && (
          <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.15em", color: "#9c8347", padding: "0 20px", borderRight: "1px solid #2a3040", height: 42, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
            ⚙ КОМАНДНЫЙ ЦЕНТР
          </div>
        )}
        <div style={{ display: "flex", flex: 1, overflowX: isMobile ? "auto" : "visible" }}>
          {(isMobile ? TABS_MOBILE : TABS).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: tab === t ? "#1a1f2c" : "none", color: tab === t ? "#9c8347" : "#5a6070", border: "none", borderBottom: tab === t ? "2px solid #9c8347" : "2px solid transparent", padding: isMobile ? "0 14px" : "0 18px", height: 42, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", fontSize: isMobile ? 13 : 10, cursor: "pointer", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: "#5a6070", fontSize: 22, cursor: "pointer", padding: "0 16px", height: 42, lineHeight: 1, flexShrink: 0 }}>
          ×
        </button>
      </div>

      {/* Контент */}
      <div style={{ flex: 1, overflowY: "auto", color: "#ece7d8" }}>
        {tab === "players"  && <AdminTabPlayers  pwd={password} />}
        {tab === "games"    && <AdminTabGames    pwd={password} />}
        {tab === "feedback" && <AdminTabFeedback pwd={password} />}
        {tab === "stats"    && <AdminTabStats    pwd={password} />}
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
  const [showAdmin, setShowAdmin] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
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
  if (showLeaderboard) screen = <LeaderboardPage onBack={() => setShowLeaderboard(false)} />;
  else if (game) screen = <App gameId={game.id} playerName={game.name} onNewGame={handleNewGame} showWelcome={game.isNew === true} />;
  else screen = <StartScreen authUser={authUser} onAuthSuccess={handleAuthSuccess} onNameChanged={handleNameChanged} onStart={handleStart} myGames={myGames} myGamesLoading={myGamesLoading} onResume={handleResume} onDeleteGame={handleDeleteGame} onAdminOpen={() => setShowAdmin(true)} onLogout={handleLogout} onLeaderboard={() => setShowLeaderboard(true)} />;

  return (
    <>
      {screen}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
