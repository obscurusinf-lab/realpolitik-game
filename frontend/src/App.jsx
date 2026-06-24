import React, { useState, useEffect, useCallback } from "react";
import { Shield, Swords, Landmark, Globe2, ScrollText, TrendingDown, TrendingUp, Minus, ChevronRight, Lock, Send, AlertTriangle } from "lucide-react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { fetchGameState, previewTurn, confirmTurn, cancelTurn, consultAdvisors, fetchSuggestions, argueWithAdvisor } from "./api";

// ---------- Modal ----------
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#f5f1e6", borderRadius: 6, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
      >
        <div style={{ background: "#1a1f2c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

const statMeta = {
  economy: { label: "Экономика", icon: TrendingDown, color: "#9c8347" },
  military: { label: "Армия", icon: Swords, color: "#a8313a" },
  stability: { label: "Стабильность", icon: Shield, color: "#4a6b5c" },
  diplomacy: { label: "Дипломатия", icon: Globe2, color: "#5b6b8c" },
  approval: { label: "Поддержка", icon: Landmark, color: "#8c6b3a" },
};

function Bar({ value, color }) {
  return (
    <div style={{ height: 6, background: "#d8d2bf", borderRadius: 2, overflow: "hidden", position: "relative" }}>
      <div style={{ width: `${value}%`, height: "100%", background: color, transition: "width 0.6s cubic-bezier(.4,0,.2,1)" }} />
    </div>
  );
}

function TrendIcon({ trend }) {
  if (trend === "up") return <TrendingUp size={13} color="#4a6b5c" />;
  if (trend === "down") return <TrendingDown size={13} color="#a8313a" />;
  return <Minus size={13} color="#8a8472" />;
}

function PreviewCard({ preview, onConfirm, onCancel, confirming, gameId, onObjectionWithdrawn }) {
  if (!preview) return null;

  const [objection, setObjection] = useState(preview.advisorObjection || null);
  const [arguing, setArguing] = useState(false);
  const [argumentText, setArgumentText] = useState("");
  const [advisorReply, setAdvisorReply] = useState(null);
  const [sendingArg, setSendingArg] = useState(false);

  const deltas = Object.entries(preview.statDeltasPreview || {}).filter(([, d]) => d !== 0);

  async function handleArgue() {
    if (!argumentText.trim() || sendingArg) return;
    setSendingArg(true);
    try {
      const result = await argueWithAdvisor(gameId, argumentText.trim());
      setAdvisorReply(result.advisorResponse);
      if (result.withdrawn) {
        setObjection(null);
        setArguing(false);
        onObjectionWithdrawn?.();
      }
    } catch {
      setAdvisorReply("Советник не отреагировал на аргумент.");
    } finally {
      setSendingArg(false);
    }
  }

  return (
    <div style={{ background: "#14181f", borderTop: "2px solid #9c8347", padding: "14px 16px" }}>
      {/* Шаг */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <StepBadge n={1} done />
        <div style={{ height: 1, width: 20, background: "#9c8347" }} />
        <StepBadge n={2} active />
        <div className="mono-font" style={{ fontSize: 10, color: "#9c8347", letterSpacing: "0.08em", marginLeft: 6 }}>
          ПОДТВЕРДИТЕ ИЛИ ОТМЕНИТЕ РЕШЕНИЕ
        </div>
      </div>

      {/* Блок возражения / диалога */}
      {objection && (
        <div style={{ background: "#3a2424", border: "1px solid #a8313a", borderRadius: 4, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: arguing || advisorReply ? 12 : 0 }}>
            <AlertTriangle size={15} color="#e09090" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: "#e09090", marginBottom: 4 }}>ВОЗРАЖЕНИЕ СОВЕТНИКА</div>
              <div className="doc-font" style={{ fontSize: 13, color: "#ece7d8", lineHeight: 1.5 }}>{objection}</div>
            </div>
          </div>

          {/* Ответ советника на аргумент */}
          {advisorReply && (
            <div style={{ borderTop: "1px solid #5a2424", paddingTop: 10, marginBottom: 10 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#e09090", letterSpacing: "0.08em", marginBottom: 4 }}>ОТВЕТ СОВЕТНИКА</div>
              <div className="doc-font" style={{ fontSize: 13, color: "#ece7d8", lineHeight: 1.5 }}>{advisorReply}</div>
            </div>
          )}

          {/* Поле ввода аргумента */}
          {arguing ? (
            <div>
              <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", letterSpacing: "0.08em", marginBottom: 6 }}>ВАШ АРГУМЕНТ</div>
              <textarea
                value={argumentText}
                onChange={e => setArgumentText(e.target.value)}
                placeholder="Обоснуйте своё решение…"
                rows={2}
                disabled={sendingArg}
                style={{ width: "100%", resize: "none", background: "#2a1a1a", color: "#ece7d8", border: "1px solid #5a3030", borderRadius: 4, padding: "8px 10px", fontFamily: "'PT Serif',serif", fontSize: 13, marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleArgue}
                  disabled={sendingArg || !argumentText.trim()}
                  style={{ ...btnStyle("#9c8347", "#1a1f2c"), opacity: sendingArg || !argumentText.trim() ? 0.5 : 1 }}
                >
                  {sendingArg ? "Советник думает…" : "Отправить аргумент"}
                </button>
                <button onClick={() => { setArguing(false); setAdvisorReply(null); setArgumentText(""); }} disabled={sendingArg} style={btnStyle("#2a3040", "#a8a294")}>
                  Назад
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setArguing(true); setAdvisorReply(null); }}
              style={{ ...btnStyle("#5a2a2a", "#e09090"), marginTop: 4, fontSize: 12 }}
            >
              Возразить советнику
            </button>
          )}
        </div>
      )}

      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: "#9c8347", marginBottom: 4 }}>
        ПРОЕКТ РЕШЕНИЯ · ХОД {preview.turnNumber}
      </div>
      <div className="doc-font" style={{ fontSize: 13.5, color: "#ece7d8", lineHeight: 1.5, marginBottom: 10 }}>
        {preview.narrative}
      </div>

      <div style={{ background: "#1f2733", borderRadius: 4, padding: "8px 12px", marginBottom: 12 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 6 }}>ПРОГНОЗ ИЗМЕНЕНИЙ</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {deltas.length === 0
            ? <span className="mono-font" style={{ fontSize: 11, color: "#8a8472" }}>Без заметных изменений</span>
            : deltas.map(([stat, delta]) => (
              <span key={stat} className="mono-font" style={{ fontSize: 12, color: delta > 0 ? "#7fae93" : "#e09090" }}>
                {statMeta[stat]?.label ?? stat} {delta > 0 ? `+${delta}` : delta}
              </span>
            ))
          }
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onConfirm}
          disabled={confirming || sendingArg}
          style={{ ...btnStyle("#9c8347", "#1a1f2c"), flex: 1, opacity: confirming ? 0.6 : 1, fontWeight: 700 }}
        >
          {confirming ? "Выполняется…" : "✓ Подписать и огласить"}
        </button>
        <button onClick={onCancel} disabled={confirming || sendingArg} style={{ ...btnStyle("#2a3040", "#a8a294"), flexShrink: 0 }}>
          Отменить
        </button>
      </div>
    </div>
  );
}

function StepBadge({ n, done, active }) {
  const bg = done ? "#9c8347" : active ? "#9c8347" : "#2a3040";
  const color = done || active ? "#1a1f2c" : "#5a6070";
  return (
    <div style={{ width: 22, height: 22, borderRadius: "50%", background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
      {done ? "✓" : n}
    </div>
  );
}

function btnStyle(bg, color) {
  return { background: bg, color, border: "none", borderRadius: 4, padding: "7px 12px", fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: "pointer" };
}

export default function App({ gameId, playerName, onNewGame }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loaded, setLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [draftInput, setDraftInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [turnError, setTurnError] = useState(null);

  const [advisors, setAdvisors] = useState(null);
  const [consulting, setConsulting] = useState(false);
  const [advisorError, setAdvisorError] = useState(null);

  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const data = await fetchGameState(gameId);
      setState(data);
      setLoadError(null);
    } catch (err) {
      // Игра не найдена — сохранённый gameId устарел, предлагаем начать заново
      if (err.message.includes("404") || err.message.includes("not found")) {
        onNewGame?.();
        return;
      }
      setLoadError(err.message);
    } finally {
      setLoaded(true);
    }
  }, [gameId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  async function handlePreview() {
    if (!draftInput.trim() || previewing) return;
    setPreviewing(true);
    setTurnError(null);
    try {
      const result = await previewTurn(gameId, draftInput);
      setPreview(result);
    } catch (err) {
      setTurnError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    setTurnError(null);
    try {
      await confirmTurn(gameId);
      setPreview(null);
      setDraftInput("");
      await loadState();
    } catch (err) {
      setTurnError(err.message);
      // Если confirm упал из-за рассинхрона (409), preview уже не валиден — сбрасываем
      if (err.message.includes("Call /turns/preview")) {
        setPreview(null);
      }
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelTurn(gameId);
    } finally {
      setPreview(null);
    }
  }

  async function handleLoadSuggestions() {
    if (loadingSuggestions) return;
    setLoadingSuggestions(true);
    try {
      const result = await fetchSuggestions(gameId);
      setSuggestions(result.suggestions || []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function handleConsult() {
    if (consulting) return;
    setConsulting(true);
    setAdvisorError(null);
    try {
      const result = await consultAdvisors(gameId, draftInput);
      setAdvisors(result.advisors);
    } catch (err) {
      setAdvisorError(err.message);
    } finally {
      setConsulting(false);
    }
  }

  if (!loaded) return <CenteredMessage text="Загрузка партии…" />;
  if (loadError || !state) return <CenteredMessage text={`Не удалось загрузить партию: ${loadError || "нет данных"}`} isError />;

  const tabs = [
    { id: "overview", label: "Обстановка", icon: Globe2 },
    { id: "map", label: "Карта", icon: Globe2 },
    { id: "stats", label: "Показатели", icon: Shield },
    { id: "world", label: "Мир", icon: Globe2 },
    { id: "advisors", label: "Советники", icon: ChevronRight },
    { id: "policies", label: "Политики", icon: ChevronRight },
    { id: "relations", label: "Отношения", icon: Landmark },
    { id: "newsfeed", label: "Лента", icon: ScrollText },
    { id: "log", label: "Журнал", icon: ScrollText },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#1a1f2c", fontFamily: "'Georgia','Times New Roman',serif", color: "#ece7d8" }}>
      {showWelcome && state && (
        <WelcomeModal state={state} playerName={playerName} onClose={() => setShowWelcome(false)} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .doc-font { font-family: 'PT Serif', Georgia, serif; }
        .mono-font { font-family: 'JetBrains Mono', monospace; }
        .tab-btn:focus-visible, button:focus-visible { outline: 2px solid #9c8347; outline-offset: 2px; }
        .scroll-hide::-webkit-scrollbar { height: 4px; }
        .scroll-hide::-webkit-scrollbar-thumb { background: #3a4156; }
      `}</style>

      <div style={{ background: "linear-gradient(180deg,#14181f 0%,#1a1f2c 100%)", borderBottom: "2px solid #9c8347", padding: "18px 20px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.15em", color: "#9c8347", marginBottom: 4 }}>
              СОВЕРШЕННО СЕКРЕТНО · ЭКЗ. №1
            </div>
            <h1 className="doc-font" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.04em" }}>REALPOLITIK</h1>
            <div className="mono-font" style={{ fontSize: 11, color: "#a8a294", marginTop: 2 }}>
              {state.date} · Ход №{state.turn}{playerName ? ` · ${playerName}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <Lock size={20} color="#9c8347" />
            {onNewGame && (
              <button
                onClick={() => { if (window.confirm("Начать новую партию? Текущий прогресс останется в базе.")) onNewGame(); }}
                style={{ background: "transparent", border: "1px solid #3a4156", borderRadius: 3, color: "#5a6070", fontFamily: "monospace", fontSize: 9, letterSpacing: "0.06em", padding: "3px 7px", cursor: "pointer" }}
              >
                НОВАЯ ПАРТИЯ
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="scroll-hide" style={{ display: "flex", gap: 2, padding: "10px 16px 0", overflowX: "auto", background: "#1a1f2c" }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              className="tab-btn"
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "9px 14px",
                background: active ? "#ece7d8" : "transparent", color: active ? "#1a1f2c" : "#a8a294",
                border: "none", borderRadius: "6px 6px 0 0", fontFamily: "'PT Serif',serif",
                fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ background: "#ece7d8", color: "#262420", minHeight: "60vh", padding: "20px 16px 32px" }}>
        {tab === "overview" && <OverviewTab state={state} />}
        {tab === "map" && <MapTab state={state} />}
        {tab === "stats" && <StatsTab state={state} />}
        {tab === "world" && <WorldTab state={state} />}
        {tab === "advisors" && (
          <AdvisorsTab
            advisors={advisors}
            consulting={consulting}
            advisorError={advisorError}
            draftInput={draftInput}
            onConsult={handleConsult}
            onSelectAdvice={(text) => { setDraftInput(text); setTab("overview"); }}
          />
        )}
        {tab === "policies" && <PoliciesTab state={state} />}
        {tab === "relations" && <RelationsTab state={state} />}
        {tab === "newsfeed" && <NewsfeedTab state={state} />}
        {tab === "log" && <LogTab state={state} />}
      </div>

      {preview ? (
        <PreviewCard preview={preview} onConfirm={handleConfirm} onCancel={handleCancel} confirming={confirming} gameId={gameId} onObjectionWithdrawn={() => {}} />
      ) : (
        <div style={{ background: "#14181f", borderTop: "2px solid #9c8347", padding: "14px 16px" }}>
          {/* Шаг 1 из 2 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <StepBadge n={1} active />
            <div style={{ height: 1, width: 20, background: "#3a4156" }} />
            <StepBadge n={2} />
            <div className="mono-font" style={{ fontSize: 10, color: "#9c8347", letterSpacing: "0.08em", marginLeft: 6 }}>
              СФОРМУЛИРУЙТЕ РЕШЕНИЕ И НАЖМИТЕ «РАССМОТРЕТЬ»
            </div>
          </div>

          {turnError && (
            <div className="doc-font" style={{ color: "#e09090", fontSize: 12.5, marginBottom: 8 }}>
              Ошибка: {turnError}
            </div>
          )}

          {/* Подсказки */}
          {suggestions && suggestions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 6 }}>ВАРИАНТЫ УКАЗОВ — нажмите чтобы выбрать:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setDraftInput(s); setSuggestions(null); }}
                    style={{
                      background: "#1f2733", color: "#ece7d8", border: "1px solid #3a4156",
                      borderRadius: 4, padding: "7px 10px", fontFamily: "'PT Serif',serif",
                      fontSize: 12.5, cursor: "pointer", textAlign: "left", lineHeight: 1.4,
                    }}
                  >
                    {s}
                  </button>
                ))}
                <button onClick={() => setSuggestions(null)} style={{ background: "transparent", border: "none", color: "#5a6070", fontFamily: "monospace", fontSize: 10, cursor: "pointer", textAlign: "left", padding: "2px 0" }}>
                  скрыть
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              placeholder="Опишите ваше решение как президента…"
              rows={2}
              disabled={previewing}
              style={{ flex: 1, resize: "none", background: "#ece7d8", color: "#262420", border: "1px solid #3a4156", borderRadius: 4, padding: "8px 10px", fontFamily: "'PT Serif',serif", fontSize: 13.5 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={handlePreview}
                disabled={previewing || !draftInput.trim()}
                style={{ ...btnStyle("#9c8347", "#1a1f2c"), padding: "8px 14px", opacity: previewing || !draftInput.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}
              >
                <Send size={13} />
                {previewing ? "Анализ…" : "Рассмотреть →"}
              </button>
              <button
                onClick={handleLoadSuggestions}
                disabled={loadingSuggestions}
                style={{ ...btnStyle("#2a3040", "#a8a294"), padding: "6px 14px", opacity: loadingSuggestions ? 0.6 : 1, fontSize: 11.5 }}
              >
                {loadingSuggestions ? "Загрузка…" : "💡 Подсказки"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mono-font" style={{ textAlign: "center", fontSize: 10, letterSpacing: "0.1em", color: "#5a5f6e", padding: "10px 0 16px", background: "#1a1f2c" }}>
        ГЕЙММАСТЕР: CLAUDE SONNET 4.6 · ПАНЕЛЬ ОБНОВЛЯЕТСЯ ПО ХОДАМ
      </div>
    </div>
  );
}

const ADVISOR_TONE_COLOR = {
  supportive: "#4a6b5c",
  cautious: "#9c8347",
  critical: "#a8313a",
  alarmed: "#c0392b",
};

const ADVISOR_TONE_LABEL = {
  supportive: "поддерживает",
  cautious: "осторожен",
  critical: "критикует",
  alarmed: "бьёт тревогу",
};

const DIRECTION_LABEL = {
  military_offensive: "наступление",
  military_defensive: "оборона",
  diplomacy_outreach: "дипломатия",
  diplomacy_confrontation: "конфронтация",
  economic_stimulus: "стимул экономики",
  economic_austerity: "режим экономии",
  domestic_repression: "закручивание гаек",
  domestic_liberalization: "либерализация",
  info_narrative: "информационная работа",
  intelligence_covert: "спецоперация",
  peace_initiative: "мирная инициатива",
  null_action: "бездействие",
};

function AdvisorsTab({ advisors, consulting, advisorError, draftInput, onConsult, onSelectAdvice }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={onConsult}
          disabled={consulting}
          style={{
            background: consulting ? "#5a5040" : "#9c8347",
            color: "#1a1f2c",
            border: "none",
            borderRadius: 4,
            padding: "9px 18px",
            fontFamily: "'PT Serif',serif",
            fontSize: 13.5,
            cursor: consulting ? "default" : "pointer",
            opacity: consulting ? 0.7 : 1,
          }}
        >
          {consulting ? "Советники совещаются…" : draftInput.trim() ? "Запросить совет по черновику" : "Запросить общий совет"}
        </button>
        {draftInput.trim() && !consulting && (
          <div className="doc-font" style={{ marginTop: 8, fontSize: 12, color: "#5c5648", fontStyle: "italic" }}>
            Советники прочитают ваш черновик: «{draftInput.slice(0, 80)}{draftInput.length > 80 ? "…" : ""}»
          </div>
        )}
        {advisorError && (
          <div className="doc-font" style={{ marginTop: 8, fontSize: 12.5, color: "#a8313a" }}>
            Ошибка: {advisorError}
          </div>
        )}
      </div>

      {!advisors && !consulting && (
        <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>
          Нажмите кнопку, чтобы получить мнения советников. Можно сначала написать черновик решения внизу экрана — советники отреагируют на него.
        </div>
      )}

      {advisors && (
        <div style={{ display: "grid", gap: 14 }}>
          {advisors.map((adv) => {
            const toneColor = ADVISOR_TONE_COLOR[adv.tone] || "#8a8472";
            return (
              <div
                key={adv.id}
                style={{
                  background: "#f5f1e6",
                  border: `1px solid #d8d2bf`,
                  borderLeft: `4px solid ${toneColor}`,
                  borderRadius: 4,
                  padding: "13px 14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div className="doc-font" style={{ fontSize: 15, fontWeight: 700 }}>{adv.name}</div>
                    <div className="mono-font" style={{ fontSize: 10, color: "#8a8472", letterSpacing: "0.06em" }}>{adv.role?.toUpperCase()}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span
                      className="mono-font"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.06em",
                        padding: "2px 7px",
                        borderRadius: 3,
                        background: toneColor + "22",
                        color: toneColor,
                      }}
                    >
                      {(ADVISOR_TONE_LABEL[adv.tone] || adv.tone)?.toUpperCase()}
                    </span>
                    {adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                      <span className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>
                        → {DIRECTION_LABEL[adv.suggested_direction] || adv.suggested_direction}
                      </span>
                    )}
                  </div>
                </div>
                <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.55, color: "#3a362e", marginBottom: 10 }}>
                  {adv.recommendation}
                </div>
                {adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                  <button
                    onClick={() => onSelectAdvice(adv.recommendation)}
                    style={{
                      background: "#9c8347", color: "#1a1f2c", border: "none",
                      borderRadius: 3, padding: "5px 12px",
                      fontFamily: "'PT Serif',serif", fontSize: 12,
                      cursor: "pointer", fontWeight: 700,
                    }}
                  >
                    Принять совет →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STAT_LABEL = { economy: "Экономика", military: "Армия", stability: "Стабильность", diplomacy: "Дипломатия", approval: "Одобрение" };
const STAT_COLOR = { economy: "#9c8347", military: "#a8313a", stability: "#4a6b5c", diplomacy: "#5b6b8c", approval: "#8c6b3a" };

function statLevel(v) {
  if (v >= 70) return { label: "Высокий", color: "#7fae93" };
  if (v >= 45) return { label: "Средний", color: "#c8a96a" };
  return { label: "Критический", color: "#e09090" };
}

const COUNTRY_ACCUSATIVE = { "Россия": "Россию", "США": "США", "Китай": "Китай", "Украина": "Украину", "Германия": "Германию", "Турция": "Турцию" };

function WelcomeModal({ state, playerName, onClose }) {
  const stats = state?.stats || {};
  const countryName = state?.countryName || "страну";
  const countryAcc = COUNTRY_ACCUSATIVE[countryName] || countryName;
  const context = state?.contextSummary || null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ background: "#14181f", border: "1px solid #3a4156", borderTop: "3px solid #9c8347", borderRadius: 6, maxWidth: 600, width: "100%", maxHeight: "92vh", overflow: "auto", boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>

        {/* Шапка */}
        <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid #2a3040", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#a8313a", marginBottom: 3 }}>СОВЕРШЕННО СЕКРЕТНО · ЭКЗ. №1</div>
            <div className="mono-font" style={{ fontSize: 12, color: "#9c8347", letterSpacing: "0.12em", fontWeight: 700 }}>ВВОДНЫЙ БРИФИНГ</div>
          </div>
          <div className="mono-font" style={{ fontSize: 11, color: "#3a4156", letterSpacing: "0.1em" }}>REALPOLITIK</div>
        </div>

        <div style={{ padding: "22px 22px 28px" }}>

          {/* Личное дело */}
          <div style={{ borderLeft: "3px solid #9c8347", paddingLeft: 16, marginBottom: 24 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 8 }}>ЛИЧНОЕ ДЕЛО</div>
            <div className="doc-font" style={{ fontSize: 22, fontWeight: 700, color: "#ece7d8", marginBottom: 6 }}>
              {playerName || "Президент"}
            </div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#a8a294", lineHeight: 1.6 }}>
              Верховный главнокомандующий. Возглавил {countryAcc} в переломный момент истории. Все стратегические решения — в ваших руках. Советники готовы к докладу.
            </div>
          </div>

          {/* Контекст страны */}
          {context && (
            <div style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "14px 16px", marginBottom: 22 }}>
              <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 8 }}>ГЕОПОЛИТИЧЕСКИЙ КОНТЕКСТ · {countryName.toUpperCase()}</div>
              <div className="doc-font" style={{ fontSize: 13, color: "#c8c4b8", lineHeight: 1.65 }}>{context}</div>
            </div>
          )}

          {/* Показатели */}
          <div style={{ marginBottom: 24 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 12 }}>ОПЕРАТИВНАЯ СВОДКА</div>
            <div style={{ display: "grid", gap: 9 }}>
              {Object.entries(stats).map(([key, value]) => {
                const lvl = statLevel(value);
                const color = STAT_COLOR[key] || "#9c8347";
                return (
                  <div key={key} style={{ background: "#1f2733", borderRadius: 4, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                      <span className="doc-font" style={{ fontSize: 13.5, fontWeight: 700, color: "#ece7d8" }}>
                        {STAT_LABEL[key] || key}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="mono-font" style={{ fontSize: 9, color: lvl.color, letterSpacing: "0.08em" }}>{lvl.label.toUpperCase()}</span>
                        <span className="mono-font" style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
                      </div>
                    </div>
                    <div style={{ height: 5, background: "#2a3040", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Цель */}
          <div style={{ border: "1px solid #9c8347", borderRadius: 4, padding: "14px 16px", marginBottom: 24 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 10 }}>ЦЕЛЬ ОПЕРАЦИИ</div>
            <div className="doc-font" style={{ fontSize: 14, color: "#ece7d8", lineHeight: 1.65, marginBottom: 14 }}>
              Управляйте страной <strong style={{ color: "#9c8347" }}>20 ходов</strong>, не допустив коллапса. Итоговый рейтинг — взвешенная сумма всех показателей в конце партии. Лучшие результаты попадают в таблицу лидеров.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { cond: "Стабильность → 0", res: "Коллапс", color: "#a8313a" },
                { cond: "20 ходов пройдено", res: "Финальный счёт", color: "#5b6b8c" },
                { cond: "Рейтинг > 75", res: "Победа", color: "#4a6b5c" },
              ].map(({ cond, res, color }) => (
                <div key={cond} style={{ background: "#1f2733", borderRadius: 3, padding: "8px 10px", borderTop: `2px solid ${color}` }}>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 3 }}>{cond}</div>
                  <div className="mono-font" style={{ fontSize: 10, color, fontWeight: 700 }}>→ {res}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Инструкция */}
          <div style={{ marginBottom: 26 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 12 }}>КАК ИГРАТЬ</div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                ["1", "Читайте «Обстановку»", "Очаги напряжённости кликабельны — открываются с подробностями. Вкладка «Мир» показывает ходы других стран."],
                ["2", "Запрашивайте совет", "Вкладка «Советники» → «Запросить совет». Можно с черновиком решения — каждый советник реагирует по-своему. Нажмите «Принять совет» чтобы взять рекомендацию за основу."],
                ["3", "Формулируйте указ", "Напишите решение в поле внизу или нажмите «💡 Подсказки» для вариантов под текущую ситуацию."],
                ["4", "«Рассмотреть →»", "ИИ-геймместер оценит последствия, покажет прогноз изменений и возможное возражение советника."],
                ["5", "«Подписать и огласить»", "Ход применяется. Мир реагирует — смотрите «Лента» и «Мир» после каждого хода."],
              ].map(([n, title, desc]) => (
                <div key={n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#2a3040", border: "1px solid #9c8347", color: "#9c8347", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{n}</div>
                  <div>
                    <div className="doc-font" style={{ fontSize: 13.5, fontWeight: 700, color: "#ece7d8", marginBottom: 2 }}>{title}</div>
                    <div className="doc-font" style={{ fontSize: 12.5, color: "#7a7a6e", lineHeight: 1.5 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ width: "100%", background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "14px", fontFamily: "'PT Serif',serif", fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
          >
            Приступить к работе →
          </button>
        </div>
      </div>
    </div>
  );
}

function CenteredMessage({ text, isError }) {
  return (
    <div style={{ minHeight: "100vh", background: "#1a1f2c", color: isError ? "#e09090" : "#a8a294", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'PT Serif',serif", fontSize: 14, padding: 20, textAlign: "center" }}>
      {text}
    </div>
  );
}

// Map country name (from topojson) → relation lookup key
const COUNTRY_NAME_MAP = {
  "Russia": "Россия", "United States of America": "США", "China": "Китай",
  "Ukraine": "Украина", "Germany": "Германия", "France": "Франция",
  "United Kingdom": "Великобритания", "Turkey": "Турция", "Iran": "Иран",
  "Israel": "Израиль", "Belarus": "Беларусь", "Poland": "Польша",
  "India": "Индия", "Japan": "Япония", "South Korea": "Южная Корея",
  "North Korea": "Северная Корея", "Saudi Arabia": "Саудовская Аравия",
  "Brazil": "Бразилия", "Kazakhstan": "Казахстан", "Georgia": "Грузия",
  "Sweden": "Швеция", "Finland": "Финляндия", "Norway": "Норвегия",
  "Romania": "Румыния", "Serbia": "Сербия", "Hungary": "Венгрия",
  "Azerbaijan": "Азербайджан", "Armenia": "Армения", "Uzbekistan": "Узбекистан",
  "Syria": "Сирия", "Iraq": "Ирак", "Pakistan": "Пакистан",
  "Afghanistan": "Афганистан", "Libya": "Ливия", "Egypt": "Египет",
  "Ethiopia": "Эфиопия", "Nigeria": "Нигерия", "South Africa": "ЮАР",
  "Venezuela": "Венесуэла", "Cuba": "Куба", "Argentina": "Аргентина",
  "Mexico": "Мексика", "Canada": "Канада", "Australia": "Австралия",
  "Indonesia": "Индонезия", "Vietnam": "Вьетнам", "Thailand": "Таиланд",
  "Mongolia": "Монголия",
};

// Статичная база данных по странам
const COUNTRY_INFO = {
  "США": { capital: "Вашингтон", gov: "Президентская республика", flag: "🇺🇸", desc: "Единственная сверхдержава. Доминирует в НАТО, контролирует мировые финансы через доллар. Крупнейшая экономика и военный бюджет мира." },
  "Китай": { capital: "Пекин", gov: "Однопартийная республика", flag: "🇨🇳", desc: "Вторая экономика мира, стремительно наращивает военную мощь. Конкурирует с США за мировое лидерство, претендует на Тайвань." },
  "Германия": { capital: "Берлин", gov: "Федеративная республика", flag: "🇩🇪", desc: "Локомотив ЕС. Крупнейший экономический партнёр России в Европе до 2022 г., теперь лидирует в санкционной политике и военной поддержке Украины." },
  "Франция": { capital: "Париж", gov: "Президентская республика", flag: "🇫🇷", desc: "Ядерная держава, постоянный член СБ ООН. Активно продвигает европейскую стратегическую автономию, поддерживает Украину." },
  "Великобритания": { capital: "Лондон", gov: "Конституционная монархия", flag: "🇬🇧", desc: "Постоянный член СБ ООН, ядерная держава. Один из главных поставщиков оружия Украине, лидирует в санкционном давлении на Россию." },
  "Украина": { capital: "Киев", gov: "Президентская республика", flag: "🇺🇦", desc: "В состоянии вооружённого конфликта с Россией с февраля 2022 г. Получает масштабную военную и финансовую помощь Запада." },
  "Беларусь": { capital: "Минск", gov: "Президентская республика", flag: "🇧🇾", desc: "Ближайший союзник России. Предоставила территорию для наступления в феврале 2022 г., находится под западными санкциями." },
  "Польша": { capital: "Варшава", gov: "Парламентская республика", flag: "🇵🇱", desc: "Крупнейший сухопутный плацдарм НАТО на восточном фланге. Один из главных поставщиков помощи Украине." },
  "Турция": { capital: "Анкара", gov: "Президентская республика", flag: "🇹🇷", desc: "Многовекторный игрок. Член НАТО, но сохраняет отношения с Россией, выступает посредником в переговорах." },
  "Иран": { capital: "Тегеран", gov: "Исламская республика", flag: "🇮🇷", desc: "Поставляет России дроны-камикадзе. Противостоит США и Израилю, развивает ядерную программу." },
  "Израиль": { capital: "Иерусалим", gov: "Парламентская республика", flag: "🇮🇱", desc: "Ближневосточная ядерная держава. Ведёт операции против ХАМАС и Хезболлы, балансирует между Западом и Россией." },
  "Индия": { capital: "Нью-Дели", gov: "Федеративная республика", flag: "🇮🇳", desc: "Крупнейший покупатель российской нефти после введения санкций. Проводит стратегически независимую политику." },
  "Япония": { capital: "Токио", gov: "Конституционная монархия", flag: "🇯🇵", desc: "Союзник США в АТР. Ввела масштабные санкции против России, активно вооружается на фоне угроз КНДР и Китая." },
  "Южная Корея": { capital: "Сеул", gov: "Президентская республика", flag: "🇰🇷", desc: "Союзник США. Крупный производитель оружия, оказывает косвенную помощь Украине через третьи страны." },
  "Северная Корея": { capital: "Пхеньян", gov: "Тоталитарная монархия", flag: "🇰🇵", desc: "Поставляет России боеприпасы и военнослужащих. Ядерная держава, изолированная от мировой экономики." },
  "Саудовская Аравия": { capital: "Эр-Рияд", gov: "Абсолютная монархия", flag: "🇸🇦", desc: "Крупнейший экспортёр нефти, лидер ОПЕК+. Проводит политику диверсификации, нормализует отношения с Ираном при посредничестве Китая." },
  "Казахстан": { capital: "Астана", gov: "Президентская республика", flag: "🇰🇿", desc: "Крупнейший партнёр России в Центральной Азии. После 2022 г. дистанцируется от Москвы, привлекает западные инвестиции." },
  "Азербайджан": { capital: "Баку", gov: "Президентская республика", flag: "🇦🇿", desc: "Контролирует нефтегазовые маршруты в обход России. В 2023 г. установил контроль над Нагорным Карабахом." },
  "Сирия": { capital: "Дамаск", gov: "Переходная власть", flag: "🇸🇾", desc: "Россия потеряла военные базы после падения режима Асада в конце 2024 г. Страна переходит под новое управление." },
  "Иран": { capital: "Тегеран", gov: "Исламская республика", flag: "🇮🇷", desc: "Поставляет России дроны-камикадзе Shahed. Противостоит США и Израилю, развивает ядерную программу." },
  "Бразилия": { capital: "Бразилиа", gov: "Президентская республика", flag: "🇧🇷", desc: "Крупнейшая экономика Латинской Америки. Придерживается нейтралитета в конфликте, участвует в БРИКС." },
  "Финляндия": { capital: "Хельсинки", gov: "Парламентская республика", flag: "🇫🇮", desc: "Вступила в НАТО в 2023 г. Имеет самую длинную границу с Россией среди стран альянса — 1340 км." },
  "Швеция": { capital: "Стокгольм", gov: "Конституционная монархия", flag: "🇸🇪", desc: "Вступила в НАТО в 2024 г., завершив 200 лет нейтралитета. Поставляет Украине современное вооружение." },
  "Монголия": { capital: "Улан-Батор", gov: "Парламентская республика", flag: "🇲🇳", desc: "Зажата между Россией и Китаем. Не арестовала Путина по ордеру МУС во время его визита в 2024 г." },
  "Армения": { capital: "Ереван", gov: "Парламентская республика", flag: "🇦🇲", desc: "Дистанцируется от России после поражения в Карабахе в 2023 г. Подала заявку на вступление в ЕС." },
  "Узбекистан": { capital: "Ташкент", gov: "Президентская республика", flag: "🇺🇿", desc: "Проводит многовекторную политику. Крупнейшая экономика Центральной Азии, привлекает инвестиции из России и Китая." },
  "Канада": { capital: "Оттава", gov: "Конституционная монархия", flag: "🇨🇦", desc: "Член НАТО. Активно поддерживает Украину, имеет крупную украинскую диаспору." },
  "Австралия": { capital: "Канберра", gov: "Конституционная монархия", flag: "🇦🇺", desc: "Союзник США. Участник AUKUS, противодействует росту влияния Китая в АТР." },
  "Индонезия": { capital: "Джакарта", gov: "Президентская республика", flag: "🇮🇩", desc: "Крупнейшая мусульманская страна. Придерживается нейтралитета, крупный покупатель российского оружия." },
  "Пакистан": { capital: "Исламабад", gov: "Президентская республика", flag: "🇵🇰", desc: "Ядерная держава. Балансирует между США, Китаем и Россией, имеет глубокие противоречия с Индией." },
  "Ирак": { capital: "Багдад", gov: "Федеративная республика", flag: "🇮🇶", desc: "Нефтяная монархия под влиянием Ирана. Американские войска постепенно выводятся по договорённостям 2024 г." },
  "Египет": { capital: "Каир", gov: "Президентская республика", flag: "🇪🇬", desc: "Крупнейшая арабская страна. Балансирует между Россией и Западом, крупнейший покупатель российского зерна." },
  "Куба": { capital: "Гавана", gov: "Социалистическая республика", flag: "🇨🇺", desc: "Традиционный союзник России. Принимает российских военных специалистов, находится под американскими санкциями." },
  "Венесуэла": { capital: "Каракас", gov: "Президентская республика", flag: "🇻🇪", desc: "Союзник России и Китая. Крупные запасы нефти, авторитарный режим, глубокий экономический кризис." },
};

function GeoMap({ hotspots, activeHotspotIdx, onMarkerClick, onCountryClick, relations = [], scale = 120 }) {
  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  function getCountryFill(geoName) {
    const ruName = COUNTRY_NAME_MAP[geoName];
    if (!ruName) return "#1f2d3d";
    const rel = relations.find(r => r.name === ruName || r.country === ruName);
    if (!rel) return "#1f2d3d";
    if (rel.value >= 60) return "#1a3a2a";
    if (rel.value >= 30) return "#1f2d3d";
    if (rel.value >= 0)  return "#2a2535";
    return "#3a1f1f";
  }

  return (
    <ComposableMap
      projectionConfig={{ scale, center: [20, 10] }}
      style={{ width: "100%", height: "auto", background: "transparent" }}
    >
      <Geographies geography={GEO_URL}>
        {({ geographies }) =>
          geographies.map(geo => {
            const fill = getCountryFill(geo.properties.name);
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                onClick={() => onCountryClick && onCountryClick(geo.properties.name)}
                style={{
                  default: { fill, stroke: "#2a3a4d", strokeWidth: 0.4, outline: "none" },
                  hover:   { fill: "#2e4a60", stroke: "#3a5a70", strokeWidth: 0.5, outline: "none", cursor: "pointer" },
                  pressed: { fill, outline: "none" },
                }}
              />
            );
          })
        }
      </Geographies>
      {hotspots.map((spot, i) => {
        const coords = resolveCoords(spot);
        if (!coords) return null;
        const active = i === activeHotspotIdx;
        return (
          <Marker key={i} coordinates={coords}>
            <g onClick={() => onMarkerClick(i)} style={{ cursor: "pointer" }}>
              {active && <circle r={14} fill="#e05060" fillOpacity={0.15} />}
              {active && <circle r={10} fill="#e05060" fillOpacity={0.2} />}
              <circle r={active ? 7 : 5} fill={active ? "#ff3a50" : "#e05060"} />
              <circle r={active ? 3 : 2} fill="#ffffff" />
            </g>
          </Marker>
        );
      })}
    </ComposableMap>
  );
}

// Fallback coords for regions without lat/lon (used until AI generates them)
const REGION_COORDS = {
  "украина": [31.2, 48.4], "ukraine": [31.2, 48.4],
  "россия": [60.0, 55.0], "russia": [60.0, 55.0],
  "китай": [104.0, 35.0], "china": [104.0, 35.0],
  "сша": [-98.0, 38.0], "usa": [-98.0, 38.0], "us": [-98.0, 38.0],
  "ближний восток": [45.0, 29.0], "middle east": [45.0, 29.0],
  "европа": [15.0, 50.0], "europe": [15.0, 50.0],
  "нато": [10.0, 52.0],
  "африка": [25.0, 5.0], "africa": [25.0, 5.0],
  "иран": [53.0, 32.0], "iran": [53.0, 32.0],
  "израиль": [34.8, 31.5], "israel": [34.8, 31.5],
  "тайвань": [121.0, 23.5], "taiwan": [121.0, 23.5],
  "балтия": [24.0, 57.0], "балтийское": [24.0, 57.0],
  "арктика": [0.0, 80.0], "arctic": [0.0, 80.0],
  "кавказ": [44.0, 42.0], "caucasus": [44.0, 42.0],
  "сирия": [38.0, 35.0], "syria": [38.0, 35.0],
  "беларусь": [28.0, 53.5],
};

function resolveCoords(spot) {
  if (typeof spot.lat === "number" && typeof spot.lon === "number") return [spot.lon, spot.lat];
  const key = (spot.region || "").toLowerCase();
  for (const [k, v] of Object.entries(REGION_COORDS)) {
    if (key.includes(k)) return v;
  }
  return null;
}

function OverviewTab({ state }) {
  const [modal, setModal] = useState(null);
  const hotspots = state.overview?.hotspots ?? [];

  return (
    <div>
      {modal && (
        <Modal title={modal.region.toUpperCase() + " · ПОДРОБНЕЕ"} onClose={() => setModal(null)}>
          <div className="mono-font" style={{ fontSize: 10, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 10 }}>
            ХОД {state.overview?.turn ?? state.turn}
          </div>
          <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
            {modal.region}
          </div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.65, color: "#3a362e" }}>
            {modal.text}
          </div>
        </Modal>
      )}

      <div style={{ borderLeft: "3px solid #a8313a", paddingLeft: 12, marginBottom: 14 }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a8313a", marginBottom: 4 }}>
          ГЛАВНОЕ СЕЙЧАС · ХОД {state.overview?.turn ?? state.turn}
        </div>
        <p className="doc-font" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
          {state.overview?.headline ?? state.log?.[state.log.length - 1]?.body}
        </p>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {hotspots.map((item) => (
          <div
            key={item.region}
            onClick={() => setModal(item)}
            style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4, padding: "10px 12px", cursor: "pointer", transition: "border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#d8d2bf"}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.08em", color: "#8c6b3a", marginBottom: 3 }}>
                  {item.region.toUpperCase()}
                </div>
                <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                  {item.text.length > 120 ? item.text.slice(0, 120) + "…" : item.text}
                </div>
              </div>
              <span style={{ color: "#9c8347", marginLeft: 10, flexShrink: 0, fontSize: 16, marginTop: 2 }}>›</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MapTab({ state }) {
  const [activeHotspotIdx, setActiveHotspotIdx] = useState(null);
  const [hotspotModal, setHotspotModal] = useState(null);
  const [countryModal, setCountryModal] = useState(null);
  const hotspots = state.overview?.hotspots ?? [];
  const relations = state.relations ?? [];

  function handleMarkerClick(idx) {
    setActiveHotspotIdx(idx === activeHotspotIdx ? null : idx);
    setHotspotModal(hotspots[idx]);
    setCountryModal(null);
  }

  function handleCountryClick(geoName) {
    const ruName = COUNTRY_NAME_MAP[geoName] || geoName;
    const rel = relations.find(r => r.name === ruName || r.country === ruName);
    const info = COUNTRY_INFO[ruName] || null;
    setCountryModal({ name: ruName, rel, info });
    setHotspotModal(null);
    setActiveHotspotIdx(null);
  }

  function relColor(v) {
    if (v >= 60) return "#7fae93";
    if (v >= 30) return "#9c8347";
    if (v >= 0)  return "#a8a294";
    return "#e09090";
  }
  function relLabel(v) {
    if (v >= 70) return "Союзник";
    if (v >= 40) return "Партнёр";
    if (v >= 10) return "Нейтрал";
    if (v >= -20) return "Напряжённость";
    return "Враждебность";
  }

  return (
    <div style={{ background: "#14181f", margin: "-20px -16px -32px", padding: "14px 14px 20px", minHeight: "60vh" }}>
      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#a8313a", marginBottom: 10 }}>
        КАРТА МИРА · ХОД {state.overview?.turn ?? state.turn}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Карта */}
        <div style={{ flex: "1 1 0", minWidth: 0, background: "#0d1420", borderRadius: 6, overflow: "hidden", position: "relative" }}>
          <GeoMap
            hotspots={hotspots}
            activeHotspotIdx={activeHotspotIdx}
            onMarkerClick={handleMarkerClick}
            onCountryClick={handleCountryClick}
            relations={relations}
            scale={110}
          />
          <div className="mono-font" style={{ position: "absolute", bottom: 5, left: 8, fontSize: 8, color: "#2a3a4d" }}>
            клик по стране или маркеру
          </div>
        </div>

        {/* Боковая панель */}
        <div style={{ width: 140, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>

          {/* Инфо о стране */}
          {countryModal && (
            <div style={{ background: "#1a2333", border: "1px solid #3a5a70", borderRadius: 5, padding: "10px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                {countryModal.info?.flag && <span style={{ fontSize: 18 }}>{countryModal.info.flag}</span>}
                <div className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#ece7d8", lineHeight: 1.2 }}>{countryModal.name}</div>
              </div>
              {countryModal.info && (
                <>
                  <div className="mono-font" style={{ fontSize: 9, color: "#4a6070", marginBottom: 2 }}>
                    🏛 {countryModal.info.capital} · {countryModal.info.gov}
                  </div>
                  <div className="doc-font" style={{ fontSize: 11, color: "#c8c0b0", lineHeight: 1.45, marginBottom: 8, marginTop: 4 }}>
                    {countryModal.info.desc}
                  </div>
                </>
              )}
              {countryModal.rel ? (
                <>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 4, letterSpacing: "0.06em" }}>ТЕКУЩИЕ ОТНОШЕНИЯ</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ flex: 1, height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (countryModal.rel.value + 100) / 2))}%`, background: relColor(countryModal.rel.value), borderRadius: 2 }} />
                    </div>
                    <span className="mono-font" style={{ fontSize: 10, color: relColor(countryModal.rel.value), flexShrink: 0 }}>
                      {countryModal.rel.value > 0 ? "+" : ""}{countryModal.rel.value}
                    </span>
                  </div>
                  <div className="mono-font" style={{ fontSize: 9, color: relColor(countryModal.rel.value), marginBottom: 6 }}>
                    {relLabel(countryModal.rel.value)}
                    {countryModal.rel.trend === "up" ? " ↑" : countryModal.rel.trend === "down" ? " ↓" : ""}
                  </div>
                  {countryModal.rel.note && (
                    <div className="doc-font" style={{ fontSize: 11, color: "#a0a898", lineHeight: 1.5, borderTop: "1px solid #2a3a4d", paddingTop: 6 }}>
                      {countryModal.rel.note}
                    </div>
                  )}
                </>
              ) : !countryModal.info ? (
                <div className="mono-font" style={{ fontSize: 9, color: "#4a5060" }}>Нет данных</div>
              ) : null}
              <button onClick={() => setCountryModal(null)} style={{ marginTop: 8, background: "none", border: "none", color: "#4a5060", cursor: "pointer", fontSize: 10, padding: 0 }}>✕ закрыть</button>
            </div>
          )}

          {/* Инфо о хотспоте */}
          {hotspotModal && (
            <div style={{ background: "#2a1a1a", border: "1px solid #5a2a2a", borderRadius: 5, padding: "10px 10px" }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 4 }}>ОЧАГ</div>
              <div className="doc-font" style={{ fontSize: 12, fontWeight: 700, color: "#ece7d8", marginBottom: 6, lineHeight: 1.3 }}>{hotspotModal.region}</div>
              <div className="doc-font" style={{ fontSize: 11, color: "#c8c0b0", lineHeight: 1.45 }}>{hotspotModal.text}</div>
              <button onClick={() => { setHotspotModal(null); setActiveHotspotIdx(null); }} style={{ marginTop: 8, background: "none", border: "none", color: "#4a5060", cursor: "pointer", fontSize: 10, padding: 0 }}>✕ закрыть</button>
            </div>
          )}

          {/* Список очагов */}
          <div style={{ background: "#1a1f2c", border: "1px solid #2a3040", borderRadius: 5, padding: "8px 10px" }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 8 }}>КОНФЛИКТЫ</div>
            {hotspots.length === 0 ? (
              <div className="mono-font" style={{ fontSize: 9, color: "#3a4050" }}>Нет данных</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {hotspots.map((h, i) => (
                  <div
                    key={i}
                    onClick={() => handleMarkerClick(i)}
                    style={{
                      display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer",
                      padding: "4px 6px", borderRadius: 3,
                      background: activeHotspotIdx === i ? "#3a1a1a" : "transparent",
                      border: `1px solid ${activeHotspotIdx === i ? "#6a2a2a" : "transparent"}`,
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: activeHotspotIdx === i ? "#ff3a50" : "#e05060", flexShrink: 0, marginTop: 3 }} />
                    <div className="doc-font" style={{ fontSize: 11, color: activeHotspotIdx === i ? "#ece7d8" : "#a8a090", lineHeight: 1.3 }}>
                      {h.region.length > 22 ? h.region.slice(0, 22) + "…" : h.region}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsTab({ state }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {Object.entries(state.stats).map(([key, value]) => {
        const meta = statMeta[key];
        const Icon = meta.icon;
        return (
          <div key={key}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Icon size={15} color={meta.color} />
                <span className="doc-font" style={{ fontSize: 14, fontWeight: 700 }}>{meta.label}</span>
              </div>
              <span className="mono-font" style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{value}</span>
            </div>
            <Bar value={value} color={meta.color} />
          </div>
        );
      })}
    </div>
  );
}

function PoliciesTab({ state }) {
  if (!state.policies?.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>Активных политик пока нет.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {[...state.policies].reverse().map((policy, i) => (
        <div key={i} style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4, padding: "13px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <span className="doc-font" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{policy.title}</span>
            <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 3, background: policy.status === "pilot" ? "#e8dcc0" : "#dce5dc", color: policy.status === "pilot" ? "#8c6b3a" : "#4a6b5c", flexShrink: 0, marginLeft: 8, whiteSpace: "nowrap" }}>
              {policy.status === "pilot" ? "ПИЛОТ" : "АКТИВНО"}
            </span>
          </div>
          <div className="mono-font" style={{ fontSize: 10, color: "#8a8472", marginBottom: 8 }}>ВВЕДЕНО НА ХОДЕ {policy.turn}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {policy.items.map((item, j) => (
              <li key={j} className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 5 }}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RelationsTab({ state }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {state.relations.map((r) => (
        <div key={r.name} style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4, padding: "11px 13px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span className="doc-font" style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TrendIcon trend={r.trend} />
              <span className="mono-font" style={{ fontSize: 13, fontWeight: 700 }}>{r.value}</span>
            </div>
          </div>
          <Bar value={r.value} color={r.value > 60 ? "#4a6b5c" : r.value > 30 ? "#9c8347" : "#a8313a"} />
          <div className="doc-font" style={{ fontSize: 12.5, color: "#5c5648", marginTop: 6, lineHeight: 1.4 }}>{r.note}</div>
        </div>
      ))}
    </div>
  );
}

const DIRECTION_COLOR = { hostile: "#a8313a", neutral: "#9c8347", cooperative: "#4a6b5c" };
const STANCE_LABEL = { hostile: "враждебно", neutral: "нейтрально", cooperative: "дружественно" };

function WorldTab({ state }) {
  const [modal, setModal] = useState(null);
  const worldMoves = (state.newsfeed || []).filter(i => i.type === "world_move");

  if (!worldMoves.length) {
    return (
      <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>
        Ходы других стран появятся после вашего первого хода.
      </div>
    );
  }

  // Группируем по ходу
  const byTurn = {};
  for (const m of [...worldMoves].reverse()) {
    if (!byTurn[m.turn]) byTurn[m.turn] = [];
    byTurn[m.turn].push(m);
  }

  return (
    <div>
      {modal && (
        <Modal title={modal.source.toUpperCase() + " · ХОД " + modal.turn} onClose={() => setModal(null)}>
          <div className="doc-font" style={{ fontSize: 15, lineHeight: 1.65, color: "#3a362e", marginBottom: 14 }}>
            {modal.text}
          </div>
          {modal.reactions?.length > 0 && (
            <div style={{ borderTop: "1px solid #d8d2bf", paddingTop: 12 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8, letterSpacing: "0.06em" }}>ОЦЕНКА АНАЛИТИКОВ</div>
              {modal.reactions.map((r, i) => (
                <div key={i} className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, color: "#5c5648", fontStyle: "italic" }}>
                  «{r.text}»
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      <div style={{ display: "grid", gap: 20 }}>
        {Object.entries(byTurn).map(([turn, moves]) => (
          <div key={turn}>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#8a8472", marginBottom: 8, borderBottom: "1px solid #d8d2bf", paddingBottom: 4 }}>
              ХОД {turn} — ДЕЙСТВИЯ ДРУГИХ ГОСУДАРСТВ
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {moves.map((move, i) => {
                const dirColor = DIRECTION_COLOR[move.reactions?.[0]?.tone === "neg" ? "hostile" : move.reactions?.[0]?.tone === "pos" ? "cooperative" : "neutral"] || DIRECTION_COLOR.neutral;
                return (
                  <div
                    key={i}
                    onClick={() => setModal(move)}
                    style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderLeft: `4px solid ${dirColor}`, borderRadius: 4, padding: "10px 12px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#d8d2bf"}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div className="mono-font" style={{ fontSize: 10, color: dirColor, letterSpacing: "0.06em", marginBottom: 3 }}>
                          {move.source.toUpperCase()}
                        </div>
                        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.4 }}>
                          {move.text.length > 100 ? move.text.slice(0, 100) + "…" : move.text}
                        </div>
                      </div>
                      <span style={{ color: "#9c8347", marginLeft: 10, flexShrink: 0, fontSize: 16 }}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const NEWSFEED_TYPE = {
  decree:   { icon: "📜", color: "#a8313a", label: "УКАЗ" },
  news:     { icon: "📰", color: "#5b6b8c", label: "НОВОСТИ" },
  reaction: { icon: "🌐", color: "#4a6b5c", label: "РЕАКЦИЯ" },
};

function NewsfeedTab({ state }) {
  if (!state.newsfeed?.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>Лента пуста.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {[...state.newsfeed].reverse().map((item, i) => {
        const meta = NEWSFEED_TYPE[item.type] || NEWSFEED_TYPE.news;
        return (
          <div key={i} style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ padding: "10px 13px", borderLeft: `3px solid ${meta.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: meta.color }}>
                  {meta.icon} {item.source.toUpperCase()} · {meta.label}
                </span>
                <span className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>ХОД {item.turn}</span>
              </div>
              <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.45 }}>{item.text}</div>
            </div>
            {item.reactions?.length > 0 && (
              <div style={{ background: "#ebe5d4", padding: "8px 13px 10px" }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 6, letterSpacing: "0.05em" }}>КОММЕНТАРИИ</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {item.reactions.map((r, j) => (
                    <div key={j} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: r.tone === "pos" ? "#4a6b5c" : r.tone === "neg" ? "#a8313a" : "#8c6b3a" }} />
                      <div>
                        <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: "#5b6b8c" }}>{r.user}</span>
                        <span className="doc-font" style={{ fontSize: 12.5, color: "#3a362e", lineHeight: 1.4 }}> {r.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LogTab({ state }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {[...state.log].reverse().map((entry, i) => (
        <div key={i} style={{ position: "relative", paddingLeft: 18 }}>
          <div style={{ position: "absolute", left: 0, top: 4, width: 8, height: 8, borderRadius: "50%", background: entry.turn === 0 ? "#9c8347" : "#a8313a" }} />
          <div className="mono-font" style={{ fontSize: 10, color: "#8a8472", marginBottom: 2 }}>ХОД {entry.turn}</div>
          <div className="doc-font" style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{entry.title}</div>
          <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, color: "#3a362e" }}>{entry.body}</div>
        </div>
      ))}
    </div>
  );
}
