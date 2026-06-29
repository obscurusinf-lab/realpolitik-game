import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Shield, Swords, Landmark, Globe2, ScrollText, TrendingDown, TrendingUp, Minus, ChevronRight, Lock, Send, AlertTriangle } from "lucide-react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { fetchGameState, previewTurn, confirmTurn, cancelTurn, consultAdvisors, fetchSuggestions, argueWithAdvisor, skipTurn, regroupTurn, endMonth, fetchStatHistory, fetchPolicyNews, cancelPolicy, fetchLegacy, sendWorldResponse, sendUkraineResponse, respondToUkraineEvent, issueBonds, repayBonds } from "./api";

// ---------- EndTurnScreen ----------
function EndTurnScreen({ prevState, turnResult, gameId, onDone, fromTurn }) {
  const [phase, setPhase] = useState(0); // 0=action, 1=stats, 2=world, 3=done
  const [worldItems, setWorldItems] = useState([]);
  const [worldMoves, setWorldMoves] = useState([]);
  const [polling, setPolling] = useState(true);
  const [newState, setNewState] = useState(null);
  const pollRef = useRef(null);
  const isNuclearTurn = turnResult?.gmActionType === "nuclear_strike";

  // Показываем фазы с задержкой
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1200);
    const t2 = setTimeout(() => setPhase(2), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const [ukraineItems, setUkraineItems] = useState([]);

  // Polling game state пока не появятся world reactions
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = isNuclearTurn ? 24 : 12;
    async function poll() {
      try {
        const s = await fetchGameState(gameId);
        setNewState(s);
        const baseTurn = fromTurn ?? (prevState?.turn ?? 0);
        const reactions = (s.newsfeed || []).filter(n => (n.type === "reaction" || n.type === "nuclear_reaction") && n.turn > baseTurn);
        const moves = (s.newsfeed || []).filter(n => n.type === "world_move" && n.turn > baseTurn);
        const ukraine = (s.newsfeed || []).filter(n => n.type === "ukraine_action" && n.turn > baseTurn);
        if (reactions.length > 0 || moves.length > 0 || ukraine.length > 0 || attempts >= maxAttempts) {
          setWorldItems(reactions);
          setWorldMoves(moves);
          setUkraineItems(ukraine);
          setPolling(false);
          setPhase(3);
          clearInterval(pollRef.current);
        }
      } catch {}
      attempts++;
    }
    poll();
    pollRef.current = setInterval(poll, 2500);
    return () => clearInterval(pollRef.current);
  }, [gameId]);

  const ACTION_MODE_LABEL = { decree: "📜 УКАЗ", intel: "🕵️ РАЗВЕДЫВАТЕЛЬНАЯ ОПЕРАЦИЯ", military: "⚔️ ВОЕННАЯ ОПЕРАЦИЯ" };
  const statLabel = { stability: "Стабильность", economy: "Экономика", military: "Армия", diplomacy: "Дипломатия", approval: "Рейтинг" };

  const statDeltas = turnResult?.statDeltasPreview || {};
  const prevStats = prevState?.stats || {};

  const overlayStyle = {
    position: "fixed", inset: 0, background: "#0a0d12", zIndex: 8000,
    fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
    overflowY: "auto", padding: "32px 16px 48px",
  };

  return (
    <div style={overlayStyle}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .et-fade { animation: fadeIn 0.5s ease forwards; }
        @keyframes pulse { 0%,100% { opacity:.6 } 50% { opacity:1 } }
        .et-pulse { animation: pulse 1.2s infinite; }
      `}</style>

      <div style={{ maxWidth: 560, width: "100%" }}>
        {/* Шапка */}
        <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#a8313a", marginBottom: 6, textAlign: "center" }}>СВОДКА ХОДА · ХОД {(fromTurn ?? prevState?.turn ?? 0) + 1}</div>
        <div className="doc-font" style={{ fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 28, letterSpacing: "0.02em" }}>РЕЗУЛЬТАТЫ ХОДА</div>

        {/* Фаза 1: твоё действие */}
        <div className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderLeft: "3px solid #9c8347", borderRadius: 6, padding: "16px 18px", marginBottom: 14 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 8, letterSpacing: "0.1em" }}>{ACTION_MODE_LABEL[turnResult?.actionMode] || "📜 УКАЗ"}</div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.6 }}>{turnResult?.narrative}</div>
        </div>

        {/* Фаза 2: изменения статов */}
        {phase >= 1 && (
          <div className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 18px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10, letterSpacing: "0.1em" }}>ИЗМЕНЕНИЯ ПОКАЗАТЕЛЕЙ</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {Object.entries(statLabel).map(([k, label]) => {
                const d = statDeltas[k] ?? 0;
                const prev = prevStats[k] ?? 50;
                const next = Math.max(0, Math.min(100, prev + d));
                const color = d > 0 ? "#7fae93" : d < 0 ? "#e09090" : "#5a6070";
                return (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1f2733", padding: "6px 10px", borderRadius: 4 }}>
                    <span className="mono-font" style={{ fontSize: 10, color: "#a8a294" }}>{label}</span>
                    <span className="mono-font" style={{ fontSize: 11, color, fontWeight: 700 }}>
                      {prev} → {next} {d !== 0 && `(${d > 0 ? "+" : ""}${d})`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Фаза 3: мировые события */}
        {phase >= 2 && (
          <div className="et-fade">
            {polling && (
              <div className="mono-font et-pulse" style={{ fontSize: 11, color: "#5a6070", textAlign: "center", padding: "20px 0" }}>
                Анализируем реакцию мировых держав…
              </div>
            )}

            {/* Действия Украины — всегда присутствуют */}
            {!polling && ukraineItems.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", marginBottom: 10, letterSpacing: "0.1em" }}>🇺🇦 ДЕЙСТВИЯ УКРАИНЫ</div>
                {ukraineItems.map((item, i) => (
                  <div key={i} className="et-fade" style={{ background: "#1a0a0a", border: "1px solid #5a1a1a", borderLeft: "3px solid #a8313a", borderRadius: 6, padding: "12px 16px", marginBottom: 8 }}>
                    <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", marginBottom: 4 }}>{item.source?.toUpperCase()}</div>
                    <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.55, color: "#d0b0b0" }}>{item.text}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Удары и действия третьих сторон */}
            {!polling && worldMoves.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8c4a2a", marginBottom: 10, letterSpacing: "0.1em" }}>⚡ ДЕЙСТВИЯ МИРОВЫХ ИГРОКОВ</div>
                {worldMoves.map((item, i) => {
                  const analystNote = item.reactions?.[0];
                  const delta = analystNote?.stat_delta || {};
                  return (
                    <div key={i} className="et-fade" style={{ background: "#1a0e0a", border: "1px solid #6a3020", borderLeft: "3px solid #8c4a2a", borderRadius: 6, padding: "12px 16px", marginBottom: 8 }}>
                      <div className="mono-font" style={{ fontSize: 9, color: "#8c4a2a", marginBottom: 4 }}>{item.source?.toUpperCase()}</div>
                      <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.55, color: "#d0a090" }}>{item.text}</div>
                      <StatDeltaBadges delta={delta} />
                      {analystNote?.text && (
                        <div className="doc-font" style={{ fontSize: 12, color: "#906050", marginTop: 6, fontStyle: "italic" }}>{analystNote.text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Реакции стран */}
            {!polling && worldItems.length > 0 && (
              <div>
                <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10, letterSpacing: "0.1em" }}>РЕАКЦИЯ МИРА</div>
                {worldItems.map((item, i) => (
                  <div key={i} className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderLeft: "3px solid #3a4a60", borderRadius: 6, padding: "12px 16px", marginBottom: 8 }}>
                    <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 4 }}>{item.source?.toUpperCase()}</div>
                    <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.55 }}>{item.text}</div>
                  </div>
                ))}
              </div>
            )}

            {!polling && worldItems.length === 0 && worldMoves.length === 0 && ukraineItems.length === 0 && (
              <div className="doc-font" style={{ fontSize: 12, color: "#4a5060", textAlign: "center", padding: "16px 0", fontStyle: "italic" }}>Мировые реакции ещё формируются или отсутствуют.</div>
            )}
          </div>
        )}

        {/* Кнопка "Следующий ход" */}
        {phase >= 2 && !polling && (
          <div className="et-fade" style={{ marginTop: 24, textAlign: "center" }}>
            <button
              onClick={() => onDone(newState, worldItems, ukraineItems)}
              style={{ background: "#9c8347", color: "#0a0d12", border: "none", borderRadius: 6, padding: "14px 36px", fontFamily: "'PT Serif',serif", fontSize: 16, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
            >
              {ukraineItems.length > 0 ? "Ответить Украине →" : worldItems.length > 0 ? "Ответить на реакции →" : "Следующий ход →"}
            </button>
          </div>
        )}
        {phase >= 2 && polling && (
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button onClick={() => onDone(newState, [], [])} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 6, padding: "10px 24px", fontFamily: "'PT Serif',serif", fontSize: 13, color: "#5a6070", cursor: "pointer" }}>
              Пропустить →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- NuclearAftermathScreen ----------
const ESCALATION_COLOR = { 1: "#9c8347", 2: "#c84a30", 3: "#ff2020" };
const ESCALATION_LABEL = { 1: "ОСУЖДЕНИЕ", 2: "УЛЬТИМАТУМ", 3: "☢ УГРОЗА ОТВЕТНОГО УДАРА" };

function NuclearAftermathScreen({ reactions, onDone }) {
  const [revealed, setRevealed] = useState(1);
  const [done, setDone] = useState(false);

  // Автоматически раскрываем реакции одну за другой
  useEffect(() => {
    if (revealed >= reactions.length) { setTimeout(() => setDone(true), 800); return; }
    const delay = revealed < 4 ? 1200 : revealed < 8 ? 900 : 600;
    const t = setTimeout(() => setRevealed(r => r + 1), delay);
    return () => clearTimeout(t);
  }, [revealed, reactions.length]);

  const escalation3 = reactions.filter(r => r.escalation >= 3);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#050005", zIndex: 8500,
      fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8",
      display: "flex", flexDirection: "column", alignItems: "center",
      overflowY: "auto", padding: "0 0 60px",
    }}>
      <style>{`
        @keyframes nk-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        .nk-item { animation: nk-in 0.5s ease forwards; }
        @keyframes nk-flicker { 0%,100%{opacity:1} 48%{opacity:0.85} 50%{opacity:0.4} 52%{opacity:0.9} }
        .nk-flicker { animation: nk-flicker 3s infinite; }
        @keyframes nk-red { 0%,100%{background:#050005} 50%{background:#150005} }
        .nk-bg { animation: nk-red 4s infinite; }
      `}</style>

      {/* Шапка */}
      <div className="nk-bg" style={{ width: "100%", padding: "28px 20px 20px", textAlign: "center", borderBottom: "1px solid #3a0010", marginBottom: 0 }}>
        <div className="nk-flicker" style={{ fontSize: 40, marginBottom: 8 }}>☢</div>
        <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.3em", color: "#a8313a", marginBottom: 6 }}>
          ГЛОБАЛЬНАЯ ЯДЕРНАЯ ТРЕВОГА · УРОВЕНЬ DEFCON 1
        </div>
        <div className="doc-font" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, color: "#ff4040", maxWidth: 480, margin: "0 auto" }}>
          МИР ПОГРУЖАЕТСЯ В ПУЧИНУ ХАОСА
        </div>
        <div className="doc-font" style={{ fontSize: 13, color: "#8a6060", marginTop: 8, fontStyle: "italic" }}>
          Впервые с 1945 года ядерное оружие применено в боевых условиях
        </div>
      </div>

      {/* Лента реакций */}
      <div style={{ maxWidth: 580, width: "100%", padding: "20px 16px 0" }}>
        {reactions.slice(0, revealed).map((r, i) => {
          const esc = r.escalation || 1;
          const color = ESCALATION_COLOR[esc] || "#9c8347";
          return (
            <div key={i} className="nk-item" style={{
              background: esc === 3 ? "#1a0000" : "#0d0508",
              border: `1px solid ${esc === 3 ? "#a8313a" : "#2a1020"}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 5, padding: "12px 14px", marginBottom: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div className="mono-font" style={{ fontSize: 9, color, letterSpacing: "0.08em", fontWeight: 700 }}>
                  {r.source?.toUpperCase()}
                </div>
                <div className="mono-font" style={{ fontSize: 8, color, opacity: 0.8, letterSpacing: "0.06em" }}>
                  {ESCALATION_LABEL[esc]}
                </div>
              </div>
              <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.6, color: esc === 3 ? "#ffb0b0" : "#d8c8c8" }}>
                {r.text}
              </div>
            </div>
          );
        })}

        {/* Индикатор загрузки следующей реакции */}
        {!done && revealed < reactions.length && (
          <div className="mono-font" style={{ fontSize: 10, color: "#5a2030", textAlign: "center", padding: "8px 0", letterSpacing: "0.1em" }}>
            ПОСТУПАЮТ НОВЫЕ ДАННЫЕ…
          </div>
        )}

        {/* Итоговое предупреждение если есть угрозы ответного удара */}
        {done && escalation3.length > 0 && (
          <div className="nk-item" style={{ background: "#1a0000", border: "2px solid #a8313a", borderRadius: 6, padding: "16px 18px", marginTop: 8, marginBottom: 16, textAlign: "center" }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.2em", marginBottom: 8 }}>
              ☢ УГРОЗА ТОТАЛЬНОЙ ЯДЕРНОЙ ВОЙНЫ
            </div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#ffb0b0", lineHeight: 1.6 }}>
              {escalation3.length} {escalation3.length === 1 ? "держава угрожает" : "держав угрожают"} ядерным ответным ударом.
              Мир балансирует на грани взаимного гарантированного уничтожения.
            </div>
          </div>
        )}

        {done && (
          <div className="nk-item" style={{ textAlign: "center", marginTop: 12 }}>
            <button
              onClick={onDone}
              style={{ background: "#a8313a", color: "#fff", border: "none", borderRadius: 5, padding: "13px 36px", fontFamily: "'PT Serif',serif", fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
            >
              Принять последствия →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- NuclearConfirmScreen ----------
function NuclearConfirmScreen({ onConfirm, onCancel, confirming, error }) {
  const [code, setCode] = useState("");
  const REQUIRED = "ПОДТВЕРЖДАЮ";
  const ready = code.trim().toUpperCase() === REQUIRED;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0d0000", zIndex: 9000,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8", padding: "24px 20px",
    }}>
      <style>{`
        @keyframes nuke-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(1.04)} }
        .nuke-alert { animation: nuke-pulse 1.4s ease-in-out infinite; }
      `}</style>

      <div className="nuke-alert" style={{ fontSize: 48, marginBottom: 12 }}>☢</div>
      <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.3em", color: "#a8313a", marginBottom: 8 }}>
        УРОВЕНЬ УГРОЗЫ: МАКСИМАЛЬНЫЙ
      </div>
      <div className="doc-font" style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, textAlign: "center", color: "#ff4040" }}>
        ПРИМЕНЕНИЕ ЯДЕРНОГО ОРУЖИЯ
      </div>

      <div style={{ maxWidth: 440, background: "#1a0000", border: "1px solid #a8313a", borderRadius: 6, padding: "18px 20px", marginBottom: 24 }}>
        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.7, color: "#d8c8c8" }}>
          Вы отдаёте приказ о применении ядерного оружия. Это действие необратимо.
          Сотни тысяч людей погибнут в течение минут. Международное сообщество немедленно
          введёт санкции. Вероятен ядерный ответный удар. Страна станет изгоем на десятилетия.
        </div>
        <div style={{ marginTop: 14, padding: "10px 14px", background: "#2a0000", borderRadius: 4, borderLeft: "3px solid #a8313a" }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 4 }}>
            СОВЕТНИК МИНИСТЕРСТВА ОБОРОНЫ:
          </div>
          <div className="doc-font" style={{ fontSize: 12.5, color: "#c0a8a8", fontStyle: "italic" }}>
            «Господин президент, прошу вас ещё раз взвесить это решение. После нажатия кнопки обратного пути не будет.»
          </div>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 380, marginBottom: 16 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.1em", marginBottom: 8 }}>
          ДЛЯ ПОДТВЕРЖДЕНИЯ ВВЕДИТЕ: <span style={{ color: "#a8313a" }}>{REQUIRED}</span>
        </div>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Введите код подтверждения…"
          autoFocus
          style={{
            width: "100%", background: "#1a0000", color: "#ff8080", border: `2px solid ${ready ? "#a8313a" : "#3a2020"}`,
            borderRadius: 4, padding: "10px 14px", fontFamily: "'JetBrains Mono',monospace",
            fontSize: 14, letterSpacing: "0.06em", outline: "none",
          }}
        />
      </div>

      {error && (
        <div style={{ width: "100%", maxWidth: 380, marginBottom: 12, background: "#2a0000", border: "1px solid #a8313a", borderRadius: 4, padding: "10px 14px" }}>
          <div className="doc-font" style={{ fontSize: 12.5, color: "#ff8080" }}>⚠ {error}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 380 }}>
        <button
          onClick={onConfirm}
          disabled={!ready || confirming}
          style={{
            flex: 1, background: ready && !confirming ? "#a8313a" : "#3a1a1a", color: ready && !confirming ? "#fff" : "#5a3030",
            border: "none", borderRadius: 4, padding: "12px", fontFamily: "'PT Serif',serif",
            fontSize: 15, fontWeight: 700, cursor: ready && !confirming ? "pointer" : "not-allowed", letterSpacing: "0.04em",
          }}
        >
          {confirming ? "☢ Удар наносится…" : "☢ ПУСК"}
        </button>
        <button
          onClick={onCancel}
          disabled={confirming}
          style={{ flex: 1, background: "none", border: "1px solid #3a2020", borderRadius: 4, padding: "12px", fontFamily: "'PT Serif',serif", fontSize: 15, color: "#8a6060", cursor: confirming ? "not-allowed" : "pointer", opacity: confirming ? 0.4 : 1 }}
        >
          Отменить
        </button>
      </div>
    </div>
  );
}

// ---------- DiplomaticResponseScreen ----------
const ALLY_SOURCES = ["Беларусь","Казахстан","Северная Корея","КНДР","Кыргызстан","Таджикистан","Куба","Никарагуа","Сирия","Иран","Венесуэла"];
const NEUTRAL_SOURCES = ["Индия","Китай","ОАЭ","Турция","ЮАР","Бразилия","Венгрия","Пакистан","Египет","Саудовская Аравия"];

function classifySource(source) {
  if (!source) return "hostile";
  if (ALLY_SOURCES.some(a => source.includes(a))) return "ally";
  if (NEUTRAL_SOURCES.some(n => source.includes(n))) return "neutral";
  return "hostile";
}

// Определяем тему реакции по ключевым словам в тексте
function detectReactionTheme(text = "") {
  const t = text.toLowerCase();
  if (t.includes("санкц") || t.includes("заморозил") || t.includes("банк") || t.includes("торговл")) return "sanctions";
  if (t.includes("войск") || t.includes("военн") || t.includes("наступлени") || t.includes("оружи")) return "military";
  if (t.includes("перегово") || t.includes("мирн") || t.includes("примирени") || t.includes("диалог")) return "peace";
  if (t.includes("поддержк") || t.includes("солидарн") || t.includes("сотрудничеств")) return "support";
  if (t.includes("осуди") || t.includes("осужда") || t.includes("недопустим") || t.includes("требу")) return "condemnation";
  return "generic";
}

const RESPONSE_OPTIONS = {
  ally: {
    support:      [{ label: "Выразить взаимную солидарность и предложить расширить сотрудничество", type: "cooperate" }, { label: "Скоординировать совместные действия на ближайший период", type: "cooperate" }, { label: "Поблагодарить и обсудить экономические преференции", type: "cooperate" }],
    generic:      [{ label: "Выразить признательность и углубить союзные связи", type: "cooperate" }, { label: "Предложить встречу на высшем уровне для координации", type: "cooperate" }, { label: "Принять поддержку и скоординировать информационную повестку", type: "cooperate" }],
  },
  neutral: {
    peace:        [{ label: "Поддержать инициативу и предложить переговорную платформу", type: "cooperate" }, { label: "Принять к сведению и выразить готовность к диалогу", type: "deescalate" }, { label: "Вежливо отклонить, сославшись на собственный мирный план", type: "ignore" }],
    sanctions:    [{ label: "Предложить двустороннее соглашение в обход санкционного давления", type: "cooperate" }, { label: "Выразить обеспокоенность через дипломатические каналы", type: "deescalate" }, { label: "Жёстко отвергнуть — это вмешательство во внутренние дела", type: "confront" }],
    military:     [{ label: "Разъяснить оборонительный характер операций через МИД", type: "deescalate" }, { label: "Предложить гарантии безопасности в обмен на нейтралитет", type: "cooperate" }, { label: "Проигнорировать — их позиция ситуативная и нестабильная", type: "ignore" }],
    generic:      [{ label: "Направить дипломатического представителя для выяснения позиции", type: "deescalate" }, { label: "Предложить взаимовыгодное сотрудничество как альтернативу", type: "cooperate" }, { label: "Принять к сведению без официальной реакции", type: "ignore" }],
  },
  hostile: {
    sanctions:    [{ label: "Задействовать ответные меры — симметричные контрсанкции", type: "confront" }, { label: "Направить ноту протеста через дипломатические каналы", type: "deescalate" }, { label: "Проигнорировать — демонстрация стойкости важнее реакции", type: "ignore" }],
    military:     [{ label: "Созвать экстренное совещание и подготовить ответные меры", type: "confront" }, { label: "Выразить обеспокоенность через нейтральную третью сторону", type: "deescalate" }, { label: "Продолжать курс — их позиция не меняет наши планы", type: "ignore" }],
    condemnation: [{ label: "Дать жёсткий публичный ответ через государственные СМИ", type: "confront" }, { label: "Направить официальное опровержение в их посольство", type: "deescalate" }, { label: "Проигнорировать провокацию — ответ только усилит их позицию", type: "ignore" }],
    peace:        [{ label: "Выдвинуть встречные условия и занять переговорную позицию", type: "deescalate" }, { label: "Жёстко отклонить — их мирная инициатива неприемлема", type: "confront" }, { label: "Изучить предложение через закрытые каналы", type: "cooperate" }],
    generic:      [{ label: "Выразить официальный протест через посольство", type: "confront" }, { label: "Инициировать дипломатический диалог для деэскалации", type: "deescalate" }, { label: "Проигнорировать — ответ придаст им излишний вес", type: "ignore" }],
  },
};

const OUTCOME_LABELS = {
  positive: { text: "Дипломатический успех", color: "#4a9c6a" },
  mixed:    { text: "Смешанный результат", color: "#9c8347" },
  negative: { text: "Осложнение отношений", color: "#a8313a" },
  neutral:  { text: "Без изменений", color: "#5a6070" },
};

function DiplomaticResponseScreen({ reactions, onRespond, onSkip, gameId }) {
  const [idx, setIdx] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [effectResult, setEffectResult] = useState(null); // { delta, outcome, label }

  const reaction = reactions[idx];
  if (!reaction && !effectResult) { onSkip(); return null; }

  const stance = classifySource(reaction?.source);
  const theme = detectReactionTheme(reaction?.text);
  const optionSet = RESPONSE_OPTIONS[stance]?.[theme] || RESPONSE_OPTIONS[stance]?.generic || RESPONSE_OPTIONS.hostile.generic;

  async function handleChoice(responseType) {
    if (choosing) return;
    setChoosing(true);
    try {
      const result = await sendWorldResponse(gameId, responseType, reaction?.source);
      setEffectResult({ delta: result.delta || {}, outcome: result.outcome || "neutral", responseType });
    } catch {
      setEffectResult({ delta: {}, outcome: "neutral", responseType });
    }
  }

  function handleNext() {
    if (effectResult) onRespond(effectResult.responseType, reaction);
    setEffectResult(null);
    setChoosing(false);
    if (idx + 1 < reactions.length) setIdx(i => i + 1);
    else onSkip();
  }

  const overlayStyle = {
    position: "fixed", inset: 0, background: "#0a0d12", zIndex: 8100,
    fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
    overflowY: "auto", padding: "32px 16px 48px",
  };

  const stanceColor = stance === "ally" ? "#4a9c6a" : stance === "neutral" ? "#9c8347" : "#a8313a";
  const stanceLabel = stance === "ally" ? "СОЮЗНИК" : stance === "neutral" ? "НЕЙТРАЛЬНЫЙ" : "ПРОТИВНИК";

  return (
    <div style={overlayStyle}>
      <div style={{ maxWidth: 520, width: "100%" }}>
        <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#a8313a", marginBottom: 6, textAlign: "center" }}>
          ДИПЛОМАТИЧЕСКИЙ ОТВЕТ · {idx + 1} / {reactions.length}
        </div>
        <div className="doc-font" style={{ fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 20 }}>РЕАКЦИЯ МИРА</div>

        {/* Карточка реакции */}
        <div style={{ background: "#14181f", border: `1px solid ${stance === "ally" ? "#3a6a4a" : stance === "neutral" ? "#4a3a20" : "#3a2a2a"}`, borderLeft: `3px solid ${stanceColor}`, borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
          <div className="mono-font" style={{ fontSize: 9, color: stanceColor, marginBottom: 6, letterSpacing: "0.1em" }}>
            {reaction?.source?.toUpperCase()} · {stanceLabel}
          </div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.6 }}>{reaction?.text}</div>
        </div>

        {/* Результат выбора */}
        {effectResult && (() => {
          const out = OUTCOME_LABELS[effectResult.outcome] || OUTCOME_LABELS.neutral;
          const deltas = Object.entries(effectResult.delta).filter(([,v]) => v !== 0);
          const STAT_RU = { diplomacy: "Дипломатия", approval: "Рейтинг", economy: "Экономика", stability: "Стабильность", military: "Армия" };
          return (
            <div style={{ background: "#1a2010", border: `1px solid ${out.color}`, borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
              <div className="mono-font" style={{ fontSize: 9, color: out.color, marginBottom: 8, letterSpacing: "0.1em" }}>{out.text}</div>
              {deltas.length > 0 ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {deltas.map(([k, v]) => (
                    <span key={k} className="mono-font" style={{ fontSize: 11, color: v > 0 ? "#7fae93" : "#e09090" }}>
                      {STAT_RU[k] || k}: {v > 0 ? "+" : ""}{v}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="doc-font" style={{ fontSize: 12, color: "#5a6070", fontStyle: "italic" }}>Без немедленных изменений показателей.</div>
              )}
              <button
                onClick={handleNext}
                style={{ marginTop: 12, background: "#9c8347", color: "#0a0d12", border: "none", borderRadius: 5, padding: "10px 24px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {idx + 1 < reactions.length ? "Следующая реакция →" : "Продолжить →"}
              </button>
            </div>
          );
        })()}

        {/* Варианты ответа */}
        {!effectResult && (
          <>
            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10, letterSpacing: "0.08em" }}>ВЫБЕРИТЕ ОТВЕТНУЮ ПОЗИЦИЮ:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {optionSet.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleChoice(opt.type)}
                  disabled={choosing}
                  style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13.5, color: choosing ? "#4a5060" : "#ece7d8", cursor: choosing ? "default" : "pointer", textAlign: "left", lineHeight: 1.45 }}
                  onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#9c8347")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a3040")}
                >
                  <span style={{ color: "#9c8347", marginRight: 8 }}>{i + 1}.</span>{opt.label}
                </button>
              ))}
              {/* Всегда доступно: принять к сведению */}
              <button
                onClick={() => handleChoice("ignore")}
                disabled={choosing}
                style={{ background: "none", border: "1px solid #2a3040", borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13, color: "#5a6070", cursor: choosing ? "default" : "pointer", textAlign: "left" }}
                onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#5a6070")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a3040")}
              >
                Принять к сведению
              </button>
            </div>
          </>
        )}

        <button onClick={onSkip} style={{ marginTop: effectResult ? 0 : 8, background: "none", border: "none", color: "#3a4050", fontFamily: "monospace", fontSize: 10, cursor: "pointer", display: "block", width: "100%", textAlign: "center" }}>
          Пропустить все реакции →
        </button>
      </div>
    </div>
  );
}

// ---------- UkraineResponseScreen ----------
const UA_OUTCOME_LABELS = {
  positive: { text: "Контрмеры сработали", color: "#4a9c6a" },
  mixed:    { text: "Смешанный результат", color: "#9c8347" },
  negative: { text: "Ситуация осложнилась", color: "#a8313a" },
  neutral:  { text: "Без изменений", color: "#5a6070" },
};

const STAT_RU = { diplomacy: "Дипломатия", approval: "Рейтинг", economy: "Экономика", stability: "Стабильность", military: "Армия", army_morale: "Мораль армии", peace_progress: "Мирный трек" };

function UkraineResponseScreen({ items, onDone, gameId }) {
  const [idx, setIdx] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [effectResult, setEffectResult] = useState(null);

  const item = items[idx];
  if (!item) { onDone(); return null; }

  // Варианты ответа сохранены в reactions как JSON-объект
  const meta = (() => { try { return typeof item.reactions === "string" ? JSON.parse(item.reactions) : item.reactions; } catch { return {}; } })();
  const responses = meta?.responses || [
    { label: "Принять защитные меры", type: "defend" },
    { label: "Нанести ответный удар", type: "retaliate" },
    { label: "Принять потери и продолжить курс", type: "accept" },
  ];

  async function handleChoice(responseType, actionType) {
    if (choosing) return;
    setChoosing(true);
    try {
      const result = await sendUkraineResponse(gameId, responseType, actionType || meta?.type);
      setEffectResult({ delta: result.delta || {}, outcome: result.outcome || "neutral", outcomeText: result.outcomeText || "" });
    } catch {
      setEffectResult({ delta: {}, outcome: "neutral", outcomeText: "" });
    }
  }

  function handleNext() {
    setEffectResult(null);
    setChoosing(false);
    if (idx + 1 < items.length) setIdx(i => i + 1);
    else onDone();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0d0608", zIndex: 8200,
      fontFamily: "'PT Serif',Georgia,serif", color: "#ece7d8",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
      overflowY: "auto", padding: "32px 16px 48px",
    }}>
      <style>{`@keyframes ua-pulse { 0%,100%{border-color:#5a1a1a} 50%{border-color:#a8313a} } .ua-pulse { animation: ua-pulse 2s infinite; }`}</style>
      <div style={{ maxWidth: 520, width: "100%" }}>
        <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#a8313a", marginBottom: 6, textAlign: "center" }}>
          🇺🇦 ОТВЕТНЫЕ ДЕЙСТВИЯ УКРАИНЫ · {idx + 1} / {items.length}
        </div>
        <div className="doc-font" style={{ fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 20 }}>ДЕЙСТВИЕ ПРОТИВНИКА</div>

        {/* Карточка действия */}
        <div className="ua-pulse" style={{ background: "#1a0808", border: "1px solid #5a1a1a", borderLeft: "3px solid #a8313a", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", marginBottom: 6, letterSpacing: "0.1em" }}>
            {item.source?.toUpperCase()}
          </div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.6, color: "#e0c0c0" }}>{item.text}</div>
        </div>

        {/* Результат выбора */}
        {effectResult && (() => {
          const out = UA_OUTCOME_LABELS[effectResult.outcome] || UA_OUTCOME_LABELS.neutral;
          const deltas = Object.entries(effectResult.delta).filter(([,v]) => v !== 0);
          return (
            <div style={{ background: "#0e1a10", border: `1px solid ${out.color}`, borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
              <div className="mono-font" style={{ fontSize: 9, color: out.color, marginBottom: 8, letterSpacing: "0.1em" }}>{out.text}</div>
              {effectResult.outcomeText && (
                <div className="doc-font" style={{ fontSize: 13, color: "#c0d0b0", lineHeight: 1.55, marginBottom: 8 }}>{effectResult.outcomeText}</div>
              )}
              {deltas.length > 0 ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {deltas.map(([k, v]) => (
                    <span key={k} className="mono-font" style={{ fontSize: 11, color: v > 0 ? "#7fae93" : "#e09090" }}>
                      {STAT_RU[k] || k}: {v > 0 ? "+" : ""}{v}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="doc-font" style={{ fontSize: 12, color: "#5a6070", fontStyle: "italic" }}>Без немедленных изменений показателей.</div>
              )}
              <button
                onClick={handleNext}
                style={{ marginTop: 12, background: "#a8313a", color: "#fff", border: "none", borderRadius: 5, padding: "10px 24px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {idx + 1 < items.length ? "Следующее действие →" : "Продолжить →"}
              </button>
            </div>
          );
        })()}

        {/* Варианты ответа */}
        {!effectResult && (
          <>
            <div className="mono-font" style={{ fontSize: 9, color: "#7a4040", marginBottom: 10, letterSpacing: "0.08em" }}>ВЫБЕРИТЕ ОТВЕТНЫЕ МЕРЫ:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {responses.map((r, i) => (
                <button
                  key={i}
                  onClick={() => handleChoice(r.type, meta?.type)}
                  disabled={choosing}
                  style={{ background: "#1a0e0e", border: "1px solid #3a1a1a", borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13.5, color: choosing ? "#4a3030" : "#e8d8d8", cursor: choosing ? "default" : "pointer", textAlign: "left", lineHeight: 1.45 }}
                  onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#a8313a")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#3a1a1a")}
                >
                  <span style={{ color: "#a8313a", marginRight: 8 }}>{i + 1}.</span>{r.label}
                </button>
              ))}
              <button
                onClick={() => handleChoice("accept", meta?.type)}
                disabled={choosing}
                style={{ background: "none", border: "1px solid #2a1a1a", borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13, color: "#6a4040", cursor: choosing ? "default" : "pointer", textAlign: "left" }}
                onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#6a3030")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a1a1a")}
              >
                Принять ситуацию и продолжить курс
              </button>
            </div>
          </>
        )}

        <button onClick={onDone} style={{ marginTop: 8, background: "none", border: "none", color: "#3a2020", fontFamily: "monospace", fontSize: 10, cursor: "pointer", display: "block", width: "100%", textAlign: "center" }}>
          Пропустить все →
        </button>
      </div>
    </div>
  );
}

// ---------- Стратегический расчёт следующего хода ----------
// Зеркалит выигрышную стратегию из теста (test-win.js):
// 1) Казна вперёд оружия — на старте укрепить экономику (буфер на всю кампанию)
// 2) Ритм: наступление → перегруппировка → наступление (инициатива стоит 55)
// 3) Не входить в финальный удар с экономикой ниже 43 (удар стоит ~5 eco)
// 4) Возвращает один рекомендуемый ход с пояснением логики
function computeStrategicMove(stats, turn) {
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const init = stats.initiative ?? 100;
  const don = stats.donetsk_control ?? 78;
  const luh = stats.luhansk_control ?? 96;
  const zap = stats.zaporizhzhia_control ?? 68;
  const khe = stats.kherson_control ?? 58;
  const kha = stats.kharkiv_control ?? 12;

  const targets = () => {
    const t = [];
    if (don < 100) t.push("Донецк");
    if (luh < 100) t.push("Луганск");
    if (zap < 85) t.push("Запорожье");
    if (khe < 65) t.push("Херсон");
    if (kha < 50 && t.length < 2) t.push("Харьков");
    return t.slice(0, 2).join(" и ") || "оставшиеся направления";
  };

  // Близко к победе: армия сильна, ЛНР/ДНР почти под контролем, 2 из 3 регионов на подходе
  const almostWon = mil >= 85 && don >= 90 && luh >= 98 &&
    ([zap >= 80, khe >= 60, kha >= 45].filter(Boolean).length >= 2);

  // 1) Первый ход — экономический буфер. Армия раскачается наступлениями,
  //    а казна, заложенная сейчас, переживёт всю кампанию.
  if (turn <= 1) {
    return {
      priority: 9, icon: "🏛", strategic: true,
      title: "Шаг 1: казна вперёд оружия",
      why: "Войну проигрывают в бюджете, а не на фронте. Каждое наступление съедает экономику — заложите подушку сейчас, пока есть инициатива. Армию раскачаете самими наступлениями.",
      mode: "decree_fast",
      example: "Оптимизировать оборонный бюджет — льготы оборонным предприятиям и поддержка потребительского рынка",
      effect: "экономика +3, стабильность +2, рейтинг +2",
    };
  }

  // 2) Финальная фаза — почти победа
  if (almostWon) {
    if (eco >= 43 && init >= 55) {
      return {
        priority: 9, icon: "🏁", strategic: true,
        title: "ФИНАЛЬНЫЙ УДАР — добить",
        why: `Все условия сошлись: армия ${mil}, экономика ${eco} (выше порога), инициатива ${init}. Бросайте всё на ${targets()} — это победный ход.`,
        mode: "military",
        example: `Финальное наступление на ${targets()} — все резервы, авиация, артиллерия`,
        effect: "территории +5..+10 → ПОБЕДА",
      };
    }
    if (eco < 43) {
      return {
        priority: 9, icon: "💰", strategic: true,
        title: "Буфер экономики перед финалом",
        why: `До победы один удар, но экономика ${eco} — а удар стоит ~5 очков. Ударить сейчас = коллапс в момент триумфа (так проигрывают, захватив всё). Сначала поднимите казну до 43+.`,
        mode: "decree_fast",
        example: "Экстренный бюджетный манёвр — поддержать экономику перед решающей операцией",
        effect: "экономика +3",
      };
    }
    // init < 55
    return {
      priority: 9, icon: "⚙", strategic: true,
      title: "Перегруппировка перед финалом",
      why: `До победы один удар, но инициативы (${init}) не хватает на наступление (нужно 55). Экономика в норме — спокойно отведите войска и накопите инициативу для решающего удара.`,
      mode: "regroup",
      example: null,
      effect: "инициатива +75, мораль +3..+5",
    };
  }

  // 3) Армия слаба для победного темпа — реформа (редко, если просела)
  if (mil < 68) {
    return {
      priority: 9, icon: "🪖", strategic: true,
      title: "Укрепить армию",
      why: `Армия ${mil} — для уверенного наступления нужно 68+. Одна реформа окупится двумя наступлениями.`,
      mode: "decree_reform",
      example: "Реформировать систему боевой подготовки, снабжения и ротации войск",
      effect: "армия +4..+6, мораль +2..+4",
    };
  }

  // 4) Инициатива кончилась — перегруппировка вместо пропуска
  if (init < 55) {
    return {
      priority: 9, icon: "⚙", strategic: true,
      title: "Перегруппировка — копим инициативу",
      why: `Инициатива ${init}, на наступление нужно 55. Перегруппировка восстанавливает +75 и поднимает мораль — но разведка Киева видит паузу и ударит, будьте готовы защищаться.`,
      mode: "regroup",
      example: null,
      effect: "инициатива +75, мораль +3..+5",
    };
  }

  // 5) Экономика проседает — подлатать до того, как станет критично
  if (eco < 42) {
    return {
      priority: 9, icon: "💸", strategic: true,
      title: "Поддержать экономику",
      why: `Экономика ${eco} приближается к опасной зоне. Залатайте сейчас — не дайте наступлениям утащить её ниже порога победы (36).`,
      mode: "decree_fast",
      example: "Перераспределить резервные фонды на поддержку рынка и оборонных предприятий",
      effect: "экономика +3, стабильность +2",
    };
  }

  // 6) По умолчанию — наступать, пока есть инициатива и здоровая казна
  return {
    priority: 9, icon: "⚔️", strategic: true,
    title: "Наступать — есть инициатива и казна",
    why: `Армия ${mil}, инициатива ${init}, экономика ${eco}. Условия для наступления. Цель: Донецк 100%, Луганск 100% + 2 из 3 регионов (Запорожье 85%, Херсон 65%, Харьков 50%).`,
    mode: "military",
    example: `Скоординированное наступление — приоритет ${targets()}`,
    effect: "территории +5..+10",
  };
}

// ---------- Кабинет министров: доклады по всем направлениям одновременно ----------
// Каждый министр оценивает свою сферу и даёт совет независимо.
// status: "ok" | "warn" | "crit". Если совет есть — карточка кликабельна.
function generateCabinetBriefing(stats, turn) {
  if (!stats) return [];
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const stab = stats.stability ?? 50;
  const appr = stats.approval ?? 50;
  const dip = stats.diplomacy ?? 50;
  const peace = stats.peace_progress ?? 0;
  const init = stats.initiative ?? 100;
  const morale = stats.army_morale ?? 60;
  const ready = stats.readiness ?? 70;
  const don = stats.donetsk_control ?? 78;
  const luh = stats.luhansk_control ?? 96;
  const zap = stats.zaporizhzhia_control ?? 68;
  const khe = stats.kherson_control ?? 58;
  const kha = stats.kharkiv_control ?? 12;

  const milTargets = () => {
    const t = [];
    if (don < 100) t.push("Донецк");
    if (luh < 100) t.push("Луганск");
    if (zap < 85) t.push("Запорожье");
    if (khe < 65) t.push("Херсон");
    if (kha < 50 && t.length < 2) t.push("Харьков");
    return t.slice(0, 2).join(" и ") || "оставшиеся направления";
  };

  const advisors = [];

  // --- МИНИСТР ОБОРОНЫ ---
  {
    const regionsDone = [zap >= 85, khe >= 65, kha >= 50].filter(Boolean).length;
    let status = "ok", read, action = null;
    if (mil < 68) {
      status = "crit";
      read = `Армия ${mil} — слаба для наступления. Нужна реформа, нужно 68+.`;
      action = { mode: "decree_reform", example: "Реформировать боевую подготовку, снабжение и ротацию войск", effect: "армия +4..+6" };
    } else if (don >= 100 && luh >= 100 && regionsDone >= 2 && mil >= 85) {
      status = "ok";
      read = `Все территориальные цели достигнуты, армия ${mil}. Готовы к решающему удару.`;
      if (init >= 55) action = { mode: "military", example: `Финальное наступление на ${milTargets()}`, effect: "→ ПОБЕДА" };
    } else {
      status = "warn";
      read = `Армия ${mil}, мораль ${morale}, готовность ${ready}. ДНР ${don}%, ЛНР ${luh}%, регионов 2/3: ${regionsDone}. Продолжать наступление.`;
      if (init >= 55) action = { mode: "military", example: `Наступление — приоритет ${milTargets()}`, effect: "территории +5..+10" };
      else action = { mode: "regroup", example: null, effect: "инициатива +75" };
    }
    advisors.push({ domain: "Оборона", icon: "⚔️", status, read, action,
      metric: `арм ${mil} · мрл ${morale} · гтв ${ready}` });
  }

  // --- МИНИСТР ЭКОНОМИКИ ---
  {
    let status = "ok", read, action = null;
    if (eco < 36) {
      status = "crit";
      read = `Экономика ${eco} — на грани коллапса (ниже 30 = поражение). Срочно влить ресурсы.`;
      action = { mode: "decree_fast", example: "Экстренный бюджетный манёвр — резервы на рынок и оборонку", effect: "экономика +3" };
    } else if (eco < 43) {
      status = "warn";
      read = `Экономика ${eco} — буфера мало. Каждое наступление стоит ~5 очков. Подлатать до 43+.`;
      action = { mode: "decree_fast", example: "Поддержать потребительский рынок и оборонные предприятия", effect: "экономика +3, стабильность +2" };
    } else {
      read = `Экономика ${eco} — здоровый буфер. Можно вести наступления без риска коллапса.`;
    }
    advisors.push({ domain: "Экономика", icon: "💰", status, read, action,
      metric: `эко ${eco}` });
  }

  // --- МИНИСТР ИНОСТРАННЫХ ДЕЛ ---
  {
    let status = "ok", read, action = null;
    if (dip < 22) {
      status = "crit";
      read = `Дипломатия ${dip} — угроза полной изоляции (ниже 15 = поражение). Срочно искать союзников.`;
      action = { mode: "diplomacy_op", example: "Экстренный визит в Пекин — общая позиция против санкций", effect: "дипломатия +3..+5" };
    } else if (dip < 35) {
      status = "warn";
      read = `Дипломатия ${dip} проседает. На атаки Киева отвечайте «защитой», а не «контрударом» — иначе рухнет.`;
      action = { mode: "diplomacy_op", example: "Переговоры через нейтральных посредников — снизить давление", effect: "дипломатия +3..+5" };
    } else {
      read = `Дипломатия ${dip} — устойчиво. Мирный трек ${peace} (для мирной победы нужно 100).`;
    }
    advisors.push({ domain: "Дипломатия", icon: "🤝", status, read, action,
      metric: `дип ${dip} · мир ${peace}` });
  }

  // --- МИНИСТР ВНУТРЕННИХ ДЕЛ (стабильность + рейтинг) ---
  {
    let status = "ok", read, action = null;
    if (stab < 32 || appr < 38) {
      status = "crit";
      read = `Стабильность ${stab}, рейтинг ${appr} — риск волнений/переворота. Срочно укрепить тыл.`;
      action = { mode: "decree_fast", example: "Повысить выплаты семьям военных и пенсионерам, усилить порядок", effect: "рейтинг +3, стабильность +2" };
    } else if (stab < 52 || appr < 52) {
      status = "warn";
      read = `Стабильность ${stab}, рейтинг ${appr} — ниже победного порога (52). Для победы нужно поднять.`;
      action = { mode: "decree_fast", example: "Социальный пакет — выплаты и поддержка населения", effect: "рейтинг +2..+3, стабильность +2" };
    } else {
      read = `Стабильность ${stab}, рейтинг ${appr} — выше порога победы. Тыл крепок.`;
    }
    advisors.push({ domain: "Внутр. политика", icon: "🛡", status, read, action,
      metric: `стб ${stab} · рйт ${appr}` });
  }

  // --- НАЧАЛЬНИК ГЕНШТАБА (инициатива) ---
  {
    let status = "ok", read, action = null;
    if (init < 55) {
      status = "warn";
      read = `Инициатива ${init} — на наступление нужно 55. Перегруппировка восстановит +75, но Киев ударит по паузе.`;
      action = { mode: "regroup", example: null, effect: "инициатива +75, мораль +3..+5" };
    } else {
      read = `Инициатива ${init} — хватает на наступление (стоит 55).`;
    }
    advisors.push({ domain: "Генштаб", icon: "⚙", status, read, action,
      metric: `инц ${init}` });
  }

  return advisors;
}

// ---------- SmartHintsPanel ----------
function generateSmartHints(stats, turn) {
  if (!stats) return [];
  const mil = stats.military ?? 50;
  const eco = stats.economy ?? 50;
  const stab = stats.stability ?? 50;
  const appr = stats.approval ?? 50;
  const dip = stats.diplomacy ?? 50;
  const peace = stats.peace_progress ?? 0;
  const init = stats.initiative ?? 100;
  const don = stats.donetsk_control ?? 78;
  const luh = stats.luhansk_control ?? 96;
  const zap = stats.zaporizhzhia_control ?? 68;
  const khe = stats.kherson_control ?? 58;
  const kha = stats.kharkiv_control ?? 12;

  const hints = [];

  // --- РЕКОМЕНДУЕМЫЙ ХОД ПО СТРАТЕГИИ (приоритет 9) ---
  // Главная подсказка — оптимальный ход по выигрышной военной стратегии.
  hints.push(computeStrategicMove(stats, turn));

  // --- КРИТИЧЕСКИЕ УГРОЗЫ (приоритет 10) ---
  if (appr < 38) hints.push({
    priority: 10, icon: "📊", urgency: true,
    title: "Рейтинг опасно низкий",
    why: `Рейтинг ${appr}. При падении ниже 30 — переворот и поражение.`,
    mode: "decree_fast",
    example: "Объявить о повышении выплат семьям военнослужащих и пенсионерам",
    effect: "рейтинг +3..+5",
  });
  if (eco < 36) hints.push({
    priority: 10, icon: "💸", urgency: true,
    title: "Экономика на грани коллапса",
    why: `Экономика ${eco}. При падении ниже 30 — экономическая катастрофа.`,
    mode: "decree_program",
    example: "Запустить программу импортозамещения и поддержки стратегических отраслей",
    effect: "экономика +3..+5",
  });
  if (stab < 32) hints.push({
    priority: 10, icon: "⚠️", urgency: true,
    title: "Нестабильность — риск волнений",
    why: `Стабильность ${stab}. При падении ниже 25 — народные волнения.`,
    mode: "decree_fast",
    example: "Ввести усиленный режим безопасности и подавить антивоенные выступления",
    effect: "стабильность +2..+4",
  });
  if (dip < 22) hints.push({
    priority: 10, icon: "🚫", urgency: true,
    title: "Дипломатическая изоляция",
    why: `Дипломатия ${dip}. При падении ниже 15 — полная изоляция, поражение.`,
    mode: "diplomacy_op",
    example: "Экстренный визит в Пекин — договориться о совместной позиции против санкций",
    effect: "дипломатия +3..+5",
  });

  // --- ВОЕННЫЙ ПУТЬ К ПОБЕДЕ ---
  if (mil >= 68 && init >= 55) {
    const needMore = [don < 100, luh < 100].filter(Boolean).length + [zap < 85, khe < 65, kha < 50].filter(Boolean).length;
    if (needMore > 0) hints.push({
      priority: 8, icon: "⚔️",
      title: "Армия готова — наступать",
      why: `Армия ${mil}, инициатива ${init}. Наступление двигает территориальный контроль. Нужно: Донецк 100%, Луганск 100%, + 2 из 3 регионов.`,
      mode: "military",
      example: "Начать скоординированное наступление по всей линии фронта с акцентом на Донецк",
      effect: `территории +5..+10`,
    });
  }
  if (mil < 65) hints.push({
    priority: 5, icon: "🪖",
    title: "Укрепить армию перед наступлением",
    why: `Армия ${mil}. Для успешного наступления и военной победы нужно 70+.`,
    mode: "decree_reform",
    example: "Реформировать систему боевой подготовки и снабжения войск",
    effect: "армия +4..+6, мораль +2..+4",
  });

  // --- МИРНЫЙ ПУТЬ К ПОБЕДЕ ---
  if (peace < 30 && turn >= 4) hints.push({
    priority: 4, icon: "🕊",
    title: "Мирный трек деградирует",
    why: `Мирный трек ${peace}. Без дипломатии он падает −4 каждый ход. Для мирной победы нужно 100+.`,
    mode: "diplomacy_op",
    example: "Провести закрытые переговоры через турецких посредников — предложить план перемирия",
    effect: "мирный трек +4..+8",
  });

  // --- ИНИЦИАТИВА ---
  if (init < 30 && hints.length < 4) hints.push({
    priority: 7, icon: "⚙",
    title: "Инициатива на исходе — перегруппировка",
    why: `Инициатива ${init}. Перегруппировка восстанавливает +75 инициативы: армия отдыхает, мораль и готовность растут.`,
    mode: "regroup",
    example: null,
    effect: "инициатива +75, мораль +3..+5",
  });

  // --- РАЗВЕДКА ---
  if (mil >= 55 && hints.length < 4 && appr < 55) hints.push({
    priority: 3, icon: "🕵️",
    title: "Разведывательная операция",
    why: "Тайная операция может получить компромат на противника или укрепить военный потенциал.",
    mode: "intel",
    example: "Провести операцию по сбору разведданных о западных поставках оружия Украине",
    effect: "случайный исход: армия +2..+5 или дипломатия −2..−5",
  });

  // Дедупликация по режиму — если стратегический ход уже покрывает режим
  // (military/regroup/decree_reform и т.п.), не показываем дубль реактивной подсказки.
  const sorted = hints.sort((a, b) => b.priority - a.priority);
  const seenModes = new Set();
  const deduped = sorted.filter(h => {
    if (seenModes.has(h.mode)) return false;
    seenModes.add(h.mode);
    return true;
  });
  return deduped.slice(0, 4);
}

const MODE_LABELS = { military: "⚔️ военная", decree_fast: "📜 быстрый", decree_reform: "📋 реформа", decree_program: "🏛 программа", diplomacy_op: "🤝 дипломатия", intel: "🕵️ разведка", regroup: "⚙ перегруппировка" };

// Что даёт каждый тип действия: цена инициативы, длительность эффекта, риск.
const ACTION_MODE_INFO = {
  decree_fast:    { cost: 20, money: 3,  duration: "эффект ~2 хода",  risk: "низкий риск",       riskColor: "#5a9c6a", desc: "Быстрый указ — дёшево и сразу. Разовые меры: льготы, выплаты, объявления. Слабее реформы, но почти без штрафов." },
  decree_reform:  { cost: 35, money: 8,  duration: "эффект ~5 ходов", risk: "средний эффект",    riskColor: "#9c8347", desc: "Системная реформа — сильнее и дольше быстрого указа, но дороже по инициативе и деньгам, эффект разворачивается не сразу." },
  decree_program: { cost: 55, money: 15, duration: "эффект ~10 ходов",risk: "долго, но дорого",  riskColor: "#c89347", desc: "Крупная программа — самый длительный эффект (~10 ходов), но самая дорогая по инициативе и деньгам. Выгодна в долгую." },
  intel:          { cost: 20, money: 5,  duration: "разовый исход",   risk: "СЛУЧАЙНЫЙ исход",   riskColor: "#c0653a", desc: "Разведоперация — азартна: успех укрепляет армию/мораль, провал бьёт по дипломатии (−3..−5) и репутации. Чем сильнее армия — тем выше шанс успеха." },
  diplomacy_op:   { cost: 35, money: 5,  duration: "двигает мирный трек", risk: "роняет военный темп", riskColor: "#9c8347", desc: "Дипломатическая операция — главный двигатель мирного трека, недорогая по деньгам. Но мирные шаги Киев может использовать для вероломства." },
  military:       { cost: 55, money: 20, duration: "двигает территории", risk: "роняет мир/экономику", riskColor: "#a8313a", desc: "Военная операция — продвигает контроль над территориями, но самая дорогая (инициатива + деньги), бьёт по экономике и мирному треку." },
};
const STATUS_COLORS = { ok: "#3a9c6a", warn: "#c8a347", crit: "#a8313a" };
const STATUS_DOTS = { ok: "🟢", warn: "🟡", crit: "🔴" };

function SmartHintsPanel({ stats, turn, onSelectHint, onClose }) {
  const hints = generateSmartHints(stats, turn);
  const cabinet = generateCabinetBriefing(stats, turn);
  if (hints.length === 0 && cabinet.length === 0) return null;

  // Рекомендуемый ход = верхняя подсказка (стратегическая или аварийная)
  const headline = hints[0];
  // Доклады кабинета сортируем: критичные → предупреждения → норма
  const order = { crit: 0, warn: 1, ok: 2 };
  const sortedCabinet = [...cabinet].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div style={{ background: "#0e1520", border: "1px solid #2a3a50", borderRadius: 6, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", letterSpacing: "0.12em" }}>💡 СОВЕТНИК — ПОДСКАЗКИ ПО ВСЕМ НАПРАВЛЕНИЯМ</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#3a4050", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Рекомендуемый ход — итоговая рекомендация председателя */}
      {headline && (
        <div
          onClick={() => onSelectHint(headline)}
          style={{
            background: headline.urgency ? "#1a0c0c" : "#0c1a12",
            border: `1px solid ${headline.urgency ? "#5a1a1a" : "#1f5a3a"}`,
            borderLeft: `3px solid ${headline.urgency ? "#a8313a" : "#3a9c6a"}`,
            borderRadius: 5, padding: "8px 10px", cursor: "pointer", marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                <span>{headline.icon}</span>
                <span className="mono-font" style={{ fontSize: 10, color: headline.urgency ? "#e09090" : "#7ad8a0", fontWeight: 700 }}>{headline.title}</span>
                <span className="mono-font" style={{ fontSize: 8, color: headline.urgency ? "#a8313a" : "#3a9c6a", background: headline.urgency ? "#2a0808" : "#082a18", padding: "1px 5px", borderRadius: 2 }}>{headline.urgency ? "СРОЧНО" : "РЕКОМЕНДУЕТСЯ"}</span>
              </div>
              <div className="doc-font" style={{ fontSize: 11.5, color: "#7a8898", lineHeight: 1.4, marginBottom: 4 }}>{headline.why}</div>
              {headline.example && (
                <div className="doc-font" style={{ fontSize: 12, color: "#a8b8c8", fontStyle: "italic", lineHeight: 1.4 }}>Пример: «{headline.example}»</div>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#5a7a5a", whiteSpace: "nowrap" }}>{headline.effect}</div>
              {headline.mode !== "skip" && <div className="mono-font" style={{ fontSize: 8, color: "#4a5a70", marginTop: 2 }}>{MODE_LABELS[headline.mode]}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Доклады всех министров одновременно */}
      <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", letterSpacing: "0.1em", marginBottom: 6 }}>ПО НАПРАВЛЕНИЯМ</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {sortedCabinet.map((adv, i) => {
          const sc = STATUS_COLORS[adv.status];
          const clickable = !!adv.action;
          return (
            <div
              key={i}
              onClick={clickable ? () => onSelectHint(adv.action) : undefined}
              style={{
                background: "#101824",
                border: "1px solid #1c2734",
                borderLeft: `3px solid ${sc}`,
                borderRadius: 4, padding: "6px 9px",
                cursor: clickable ? "pointer" : "default",
                opacity: adv.status === "ok" ? 0.78 : 1,
              }}
              onMouseEnter={clickable ? (e => e.currentTarget.style.borderColor = sc) : undefined}
              onMouseLeave={clickable ? (e => { e.currentTarget.style.border = "1px solid #1c2734"; e.currentTarget.style.borderLeft = `3px solid ${sc}`; }) : undefined}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11 }}>{adv.icon}</span>
                  <span className="mono-font" style={{ fontSize: 9.5, color: sc, fontWeight: 700 }}>{adv.domain}</span>
                  <span style={{ fontSize: 8 }}>{STATUS_DOTS[adv.status]}</span>
                </div>
                <span className="mono-font" style={{ fontSize: 8, color: "#4a5a70", whiteSpace: "nowrap" }}>{adv.metric}</span>
              </div>
              <div className="doc-font" style={{ fontSize: 11, color: "#7a8898", lineHeight: 1.35, marginTop: 3 }}>{adv.read}</div>
              {clickable ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 8 }}>
                  <span className="doc-font" style={{ fontSize: 11, color: "#a8b8c8", fontStyle: "italic" }}>{adv.action.example ? `«${adv.action.example}»` : "Перегруппировка войск"}</span>
                  <span className="mono-font" style={{ fontSize: 8, color: sc, whiteSpace: "nowrap" }}>{MODE_LABELS[adv.action.mode]} →</span>
                </div>
              ) : (
                <div className="mono-font" style={{ fontSize: 8, color: "#3a6a4a", marginTop: 3 }}>✓ в норме — действий не требуется</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mono-font" style={{ fontSize: 8, color: "#2a3540", marginTop: 8, textAlign: "right" }}>
        Нажмите на доклад министра — он заполнит форму автоматически
      </div>
    </div>
  );
}

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
  economy:   { label: "Экономика",    icon: TrendingDown, color: "#3a8a7a" },
  military:  { label: "Армия",        icon: Swords,       color: "#a8313a" },
  stability: { label: "Стабильность", icon: Shield,       color: "#4a6b5c" },
  diplomacy: { label: "Дипломатия",   icon: Globe2,       color: "#5b6b8c" },
  approval:  { label: "Поддержка",    icon: Landmark,     color: "#8c6b3a" },
};

// Плоский словарь всех меток (основные + субметрики) для отображения дельт
const ALL_STAT_LABELS = {
  economy: "Экономика", military: "Армия", stability: "Стабильность",
  diplomacy: "Дипломатия", approval: "Поддержка", initiative: "Инициатива",
  gdp_growth: "Рост ВВП", inflation: "Инфляция", employment: "Занятость", reserves: "Резервы",
  army_morale: "Боевой дух", equipment: "Техника", readiness: "Боеготовность", veterans: "Опыт войск",
  ally_trust: "Доверие союзников", isolation: "Изоляция", soft_power: "Мягкая сила", reputation: "Репутация",
  law_order: "Правопорядок", social_tension: "Соц. напряж.", media_control: "Контроль СМИ", regional_unity: "Ед. регионов",
  elite_satisfaction: "Элиты", corruption: "Коррупция", middle_class: "Средний класс", lower_class_mood: "Народ",
  treasury: "Казна", peace_progress: "Мирный трек",
  donetsk_control: "Контроль Донецка", luhansk_control: "Контроль Луганска",
  zaporizhzhia_control: "Контроль Запорожья", kherson_control: "Контроль Херсона", kharkiv_control: "Контроль Харькова",
  military_streak: "Воен. стрик",
};
// Метрики где рост = плохо (инвертированные: красный при росте, зелёный при снижении)
const INVERTED_STATS = new Set(["corruption", "inflation", "social_tension", "isolation", "war_escalation_counter"]);
function deltaColor(stat, delta) {
  if (delta === 0) return "#5a6070";
  const bad = INVERTED_STATS.has(stat) ? delta > 0 : delta < 0;
  return bad ? "#e09090" : "#7fae93";
}

// Тип политики: программа / реформа / указ
const POLICY_CATEGORY = {
  program: { label: "ПРОГРАММА", color: "#9c7ab0", section: "ПРОГРАММЫ", hint: "крупная многолетняя программа" },
  reform:  { label: "РЕФОРМА",  color: "#3a8a7a", section: "РЕФОРМЫ",  hint: "системная реформа" },
  decree:  { label: "УКАЗ",     color: "#5b6b8c", section: "УКАЗЫ",    hint: "оперативный указ" },
};
const POLICY_CATEGORY_ORDER = ["program", "reform", "decree"];

// "↑↑ Армия, ↑ Готовность" — что вырастет при успехе
function boostStrings(effectStats) {
  if (!effectStats) return [];
  return Object.entries(effectStats).map(([k, mag]) => {
    const arrows = "↑".repeat(Math.max(1, Math.min(3, Math.abs(mag || 1))));
    return `${arrows} ${ALL_STAT_LABELS[k] || k}`;
  });
}
// Последствия отмены: [{label, delta, good}]
function penaltyEntries(cancelPenalty) {
  if (!cancelPenalty) return [];
  return Object.entries(cancelPenalty).map(([k, v]) => {
    // Для инфляции/напряжённости/изоляции/коррупции рост = плохо
    const inverse = ["inflation", "social_tension", "isolation", "corruption"].includes(k);
    const good = inverse ? v < 0 : v > 0;
    return { label: ALL_STAT_LABELS[k] || k, delta: v, good };
  });
}

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
  const [revisedNote, setRevisedNote] = useState(null);

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
        if (result.revisedNarrative) setRevisedNote(result.revisedNarrative);
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
          {!arguing && !advisorReply && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                onClick={() => { setArguing(true); setAdvisorReply(null); }}
                style={{ ...btnStyle("#5a2a2a", "#e09090"), fontSize: 12 }}
              >
                Возразить советнику
              </button>
              <button
                onClick={onCancel}
                style={{ ...btnStyle("#2a3040", "#8a8472"), fontSize: 12 }}
              >
                Согласиться (отменить решение)
              </button>
            </div>
          )}
          {arguing && (
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
          )}
        </div>
      )}

      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: "#9c8347", marginBottom: 4 }}>
        ПРОЕКТ РЕШЕНИЯ · ХОД {preview.turnNumber}
      </div>
      <div className="doc-font" style={{ fontSize: 13.5, color: "#ece7d8", lineHeight: 1.5, marginBottom: 10 }}>
        {preview.narrative}
      </div>

      {revisedNote && (
        <div style={{ background: "#101a10", border: "1px solid #2a5030", borderRadius: 4, padding: "6px 11px", marginBottom: 10 }}>
          <span className="mono-font" style={{ fontSize: 9, color: "#5a9060", letterSpacing: "0.08em" }}>✓ РЕШЕНИЕ СКОРРЕКТИРОВАНО · </span>
          <span className="doc-font" style={{ fontSize: 12, color: "#9fc090" }}>{revisedNote}</span>
        </div>
      )}

      {preview.effectLogic && (
        <div style={{ background: "#111c14", border: "1px solid #2a4030", borderRadius: 4, padding: "7px 11px", marginBottom: 10 }}>
          <div className="mono-font" style={{ fontSize: 8, color: "#4a8050", letterSpacing: "0.08em", marginBottom: 3 }}>ЛОГИКА ЭФФЕКТА</div>
          <div className="doc-font" style={{ fontSize: 12, color: "#7fae93", lineHeight: 1.4 }}>{preview.effectLogic}</div>
        </div>
      )}
      {preview.corruptionLeak > 0 && (
        <div style={{ background: "#1a1010", border: "1px solid #5a2020", borderRadius: 4, padding: "6px 11px", marginBottom: 10 }}>
          <span className="mono-font" style={{ fontSize: 10, color: "#c06060" }}>⚠ Коррупционная утечка: −{preview.corruptionLeak} из казны разворовано при исполнении</span>
        </div>
      )}
      {preview.militaryStreak >= 2 && (
        <div style={{ background: "#1a1400", border: "1px solid #5a3a00", borderRadius: 4, padding: "6px 11px", marginBottom: 10 }}>
          <span className="mono-font" style={{ fontSize: 10, color: "#c09030" }}>⚠ Усталость армии: {preview.militaryStreak} операции подряд — эффективность снижена</span>
        </div>
      )}
      <div style={{ background: "#1f2733", borderRadius: 4, padding: "8px 12px", marginBottom: 12 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 6 }}>ПРОГНОЗ ИЗМЕНЕНИЙ</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {deltas.filter(([s]) => !s.startsWith("_") && s !== "military_streak").length === 0
            ? <span className="mono-font" style={{ fontSize: 11, color: "#8a8472" }}>Без заметных изменений</span>
            : deltas.filter(([s]) => !s.startsWith("_") && s !== "military_streak").map(([stat, delta]) => (
              <span key={stat} className="mono-font" style={{ fontSize: 12, color: deltaColor(stat, delta) }}>
                {ALL_STAT_LABELS[stat] ?? stat} {delta > 0 ? `+${delta}` : delta}
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

// ---------- MissionPanel ----------
const OUTCOME_TITLES = {
  victory:          "ПОБЕДА — МИР ДОСТИГНУТ",
  victory_military: "ВОЕННАЯ ПОБЕДА",
  victory_combined: "ПРИНУЖДЕНИЕ К МИРУ",
  partial_peace:    "ДОГОВОР ПОДПИСАН",
  partial:          "ДОСТОЙНОЕ ПРАВЛЕНИЕ",
  partial_military: "ВОЕННОЕ ДОМИНИРОВАНИЕ",
  defeat_time:      "СРОК ИСТЁК",
  defeat_coup:      "ГОСУДАРСТВЕННЫЙ ПЕРЕВОРОТ",
  defeat_collapse:  "ЭКОНОМИЧЕСКИЙ КОЛЛАПС",
  defeat_unrest:    "НАРОДНЫЕ ВОЛНЕНИЯ",
  defeat_isolation: "МЕЖДУНАРОДНАЯ ИЗОЛЯЦИЯ",
  defeat_war:       "СПИРАЛЬ ВОЙНЫ",
};

function MissionPanel({ stats, turn, maxTurns = 24 }) {
  const peace = stats?.peace_progress ?? 0;
  const peaceColor = peace >= 100 ? "#4caf50" : peace >= 60 ? "#8bc34a" : peace >= 30 ? "#ffc107" : "#ef5350";

  const objectives = [
    { label: "Экономика", key: "economy", target: 55 },
    { label: "Рейтинг",   key: "approval", target: 60 },
    { label: "Стабильность", key: "stability", target: 60 },
  ];

  const turnsLeft = maxTurns - turn;
  const progressPct = Math.min(100, (turn / maxTurns) * 100);

  return (
    <div style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 6, padding: "10px 14px", fontSize: 11.5, color: "#bbb", fontFamily: "'PT Serif',serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#c9aa71", fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>МИССИЯ · РОССИЯ 2026</span>
        <span style={{ color: turnsLeft <= 4 ? "#ef5350" : "#888", fontSize: 11 }}>ХОД {turn}/{maxTurns} · осталось {turnsLeft}</span>
      </div>

      {/* Timeline bar */}
      <div style={{ background: "#111", borderRadius: 3, height: 4, marginBottom: 10, overflow: "hidden" }}>
        <div style={{ width: `${progressPct}%`, height: "100%", background: turnsLeft <= 4 ? "#ef5350" : "#c9aa71", transition: "width 0.4s" }} />
      </div>

      {/* Peace progress */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ color: "#ccc", fontSize: 11 }}>☮ Мирный трек</span>
          <span style={{ color: peaceColor, fontWeight: 700, fontSize: 11 }}>{peace}/100</span>
        </div>
        <div style={{ background: "#111", borderRadius: 3, height: 6, overflow: "hidden" }}>
          <div style={{ width: `${peace}%`, height: "100%", background: peaceColor, transition: "width 0.6s" }} />
        </div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
          Диппереговоры и мирные инициативы двигают трек. Военное наступление — откатывает.
        </div>
      </div>

      {/* Stat thresholds */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {objectives.map(obj => {
          const val = stats?.[obj.key] ?? 0;
          const ok = val >= obj.target;
          return (
            <div key={obj.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#aaa", fontSize: 11 }}>{obj.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "#555" }}>цель {obj.target}</span>
                <span style={{ color: ok ? "#4caf50" : "#ef5350", fontWeight: 700, fontSize: 11 }}>{val} {ok ? "✓" : "✗"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Defeat warnings */}
      {(stats?.approval ?? 100) < 35 && (
        <div style={{ marginTop: 8, padding: "4px 8px", background: "#3a1515", borderRadius: 3, fontSize: 10.5, color: "#ef9a9a" }}>
          ⚠ Рейтинг критически низок — угроза переворота (&lt;25)
        </div>
      )}
      {(stats?.economy ?? 100) < 40 && (
        <div style={{ marginTop: 4, padding: "4px 8px", background: "#3a1515", borderRadius: 3, fontSize: 10.5, color: "#ef9a9a" }}>
          ⚠ Экономика под угрозой коллапса (&lt;30)
        </div>
      )}
    </div>
  );
}

// ---------- TerritoryPanel ----------
const TERRITORIES = [
  { key: "donetsk_control",     label: "Донецк",     short: "ДНР" },
  { key: "luhansk_control",     label: "Луганск",    short: "ЛНР" },
  { key: "zaporizhzhia_control",label: "Запорожье",  short: "ЗПЗ" },
  { key: "kherson_control",     label: "Херсон",     short: "ХРС" },
  { key: "kharkiv_control",     label: "Харьков",    short: "ХРК" },
];

function territoryColor(pct, req) {
  if (pct >= req) return "#7a9c7a";      // выполнено — приглушённый зелёный
  if (pct >= req * 0.75) return "#8a8060"; // близко — тёмное золото
  return "#7a5050";                        // далеко — тёмный красный
}

const TERRITORY_DEFAULTS = {
  donetsk_control: 78, luhansk_control: 96,
  zaporizhzhia_control: 68, kherson_control: 58, kharkiv_control: 12,
};

const MIL_VICTORY_REQS = {
  donetsk_control: 100, luhansk_control: 100, zaporizhzhia_control: 85,
  kherson_control: 65, kharkiv_control: 50,
};

function TerritoryPanel({ stats }) {
  const [open, setOpen] = React.useState(false);
  if (!stats) return null;
  const s = { ...TERRITORY_DEFAULTS, ...stats };
  const allMet = TERRITORIES.every(({ key }) => (s[key] ?? 0) >= MIL_VICTORY_REQS[key]);
  const metCount = TERRITORIES.filter(({ key }) => (s[key] ?? 0) >= MIL_VICTORY_REQS[key]).length;

  return (
    <div style={{ background: "#16161e", border: "1px solid #2a2a38", borderRadius: 6, marginTop: 6, fontFamily: "'PT Serif',serif" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ color: "#8a9ab0", fontWeight: 700, fontSize: 11, letterSpacing: "0.08em" }}>
          ТЕРРИТОРИАЛЬНЫЙ КОНТРОЛЬ
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: allMet ? "#7a9c7a" : "#5a6070" }}>
            {metCount}/5 целей
          </span>
          <span style={{ fontSize: 10, color: "#3a4156" }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
          {TERRITORIES.map(({ key, label }) => {
            const pct = s[key] ?? 0;
            const req = MIL_VICTORY_REQS[key];
            const color = territoryColor(pct, req);
            const meetsReq = pct >= req;
            return (
              <div key={key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ color: "#7a8090", fontSize: 11 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "#3a4050" }}>цель {req}%</span>
                    <span style={{ color, fontWeight: 700, fontSize: 11 }}>{Math.round(pct)}%{meetsReq ? " ✓" : ""}</span>
                  </div>
                </div>
                <div style={{ background: "#0e0e14", borderRadius: 2, height: 4, overflow: "hidden", position: "relative" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${req}%`, width: 1, height: "100%", background: "#4a5878" }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 4, fontSize: 10, color: "#3a4050", lineHeight: 1.4 }}>
            Военная победа: Донецк+Луганск по 100% и ещё 2 региона выше цели · Бездействие отдаёт территории
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- EndGameScreen ----------
const OUTCOME_COLORS = {
  victory:          { bg: "#0a1f0a", border: "#4caf50", title: "#81c784", glow: "rgba(76,175,80,0.15)" },
  victory_military: { bg: "#0a0f1f", border: "#5c8af5", title: "#90caf9", glow: "rgba(92,138,245,0.15)" },
  victory_combined: { bg: "#0a1a16", border: "#26a69a", title: "#80cbc4", glow: "rgba(38,166,154,0.18)" },
  partial_peace:    { bg: "#0f1f0a", border: "#8bc34a", title: "#aed581", glow: "rgba(139,195,74,0.15)" },
  partial:          { bg: "#1a1500", border: "#c9aa71", title: "#c9aa71", glow: "rgba(201,170,113,0.15)" },
  partial_military: { bg: "#0f1525", border: "#7986cb", title: "#9fa8da", glow: "rgba(121,134,203,0.15)" },
  defeat_time:      { bg: "#1a1000", border: "#ff8c00", title: "#ffb74d", glow: "rgba(255,140,0,0.1)" },
  defeat_coup:      { bg: "#1a0000", border: "#ef5350", title: "#ef9a9a", glow: "rgba(239,83,80,0.1)" },
  defeat_collapse:  { bg: "#1a0000", border: "#ef5350", title: "#ef9a9a", glow: "rgba(239,83,80,0.1)" },
  defeat_unrest:    { bg: "#1a0000", border: "#ef5350", title: "#ef9a9a", glow: "rgba(239,83,80,0.1)" },
  defeat_isolation: { bg: "#1a0010", border: "#ab47bc", title: "#ce93d8", glow: "rgba(171,71,188,0.1)" },
  defeat_war:       { bg: "#1a0500", border: "#ff5722", title: "#ff8a65", glow: "rgba(255,87,34,0.1)" },
};

function EndGameScreen({ outcome, gameId, stats, turn, onRestart }) {
  const [legacy, setLegacy] = useState(null);
  const [loading, setLoading] = useState(true);
  const colors = OUTCOME_COLORS[outcome] || OUTCOME_COLORS.partial;
  const outcomeTitle = OUTCOME_TITLES[outcome] || "КОНЕЦ ПРАВЛЕНИЯ";
  const isVictory = outcome === "victory" || outcome === "victory_military" || outcome === "victory_combined" || outcome === "partial_peace" || outcome === "partial" || outcome === "partial_military";

  useEffect(() => {
    fetchLegacy(gameId, outcome)
      .then(data => setLegacy(data.legacy))
      .catch(() => setLegacy(null))
      .finally(() => setLoading(false));
  }, [gameId, outcome]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: `radial-gradient(ellipse at center, ${colors.glow} 0%, #0a0a12 70%)`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
      overflowY: "auto", padding: "40px 20px",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32, maxWidth: 700 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#555", marginBottom: 10, fontFamily: "monospace" }}>
          {isVictory ? "— КОНЕЦ ПАРТИИ —" : "— ИГРА ОКОНЧЕНА —"}
        </div>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: 2, color: colors.title,
          fontFamily: "'PT Serif',serif", textTransform: "uppercase", marginBottom: 12,
          textShadow: `0 0 30px ${colors.title}44`,
        }}>
          {outcomeTitle}
        </div>
        {legacy?.verdict && (
          <div style={{ fontSize: 15, color: "#bbb", fontFamily: "'PT Serif',serif", lineHeight: 1.6, fontStyle: "italic" }}>
            "{legacy.verdict}"
          </div>
        )}
      </div>

      {loading && (
        <div style={{ color: "#555", fontFamily: "monospace", fontSize: 13, marginBottom: 30 }}>
          Хроникёр составляет летопись…
        </div>
      )}

      {legacy && (
        <div style={{ maxWidth: 720, width: "100%", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Title */}
          {legacy.title && (
            <div style={{
              textAlign: "center", fontSize: 17, color: colors.title, fontFamily: "'PT Serif',serif",
              fontWeight: 700, padding: "12px 20px", border: `1px solid ${colors.border}22`,
              borderRadius: 6, background: colors.bg,
            }}>
              {legacy.title}
            </div>
          )}

          {/* Chapters */}
          {(legacy.chapters || []).map((ch, i) => (
            <div key={i} style={{
              background: "#111827", border: `1px solid ${colors.border}33`,
              borderRadius: 6, padding: "16px 20px",
            }}>
              <div style={{ fontSize: 12, color: colors.title, fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>
                {ch.heading}
              </div>
              <div style={{ fontSize: 13.5, color: "#ccc", lineHeight: 1.7, fontFamily: "'PT Serif',serif" }}>
                {ch.text}
              </div>
            </div>
          ))}

          {/* Highlights */}
          {(legacy.highlights || []).length > 0 && (
            <div style={{ background: "#0d1117", border: `1px solid #2a2a3e`, borderRadius: 6, padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: "#888", letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>
                Ключевые решения
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(legacy.highlights || []).map((h, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                      {h.type === "good" ? "✓" : "✗"}
                    </span>
                    <span style={{ fontSize: 13, color: h.type === "good" ? "#81c784" : "#ef9a9a", fontFamily: "'PT Serif',serif", lineHeight: 1.5 }}>
                      {h.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Epitaph */}
          {legacy.epitaph && (
            <div style={{
              textAlign: "center", padding: "20px 30px",
              borderTop: `1px solid ${colors.border}33`,
              fontSize: 15, color: "#888", fontFamily: "'PT Serif',serif", fontStyle: "italic",
              lineHeight: 1.7,
            }}>
              {legacy.epitaph}
            </div>
          )}
        </div>
      )}

      {/* Stats summary */}
      <div style={{ maxWidth: 720, width: "100%", marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { label: "Экономика", key: "economy" },
          { label: "Армия", key: "military" },
          { label: "Стабильность", key: "stability" },
          { label: "Дипломатия", key: "diplomacy" },
          { label: "Рейтинг", key: "approval" },
          { label: "Мирный трек", key: "peace_progress" },
        ].map(s => {
          const val = stats?.[s.key] ?? 0;
          const clr = val >= 65 ? "#81c784" : val >= 40 ? "#ffb74d" : "#ef9a9a";
          return (
            <div key={s.key} style={{
              background: "#111827", border: "1px solid #2a2a3e", borderRadius: 6,
              padding: "10px 16px", textAlign: "center", minWidth: 90,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: clr }}>{val}</div>
              <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 36, marginBottom: 20 }}>
        <button onClick={onRestart} style={{
          background: colors.border, color: "#000", border: "none", borderRadius: 4,
          padding: "12px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer",
          fontFamily: "'PT Serif',serif", letterSpacing: 1,
        }}>
          НОВАЯ ПАРТИЯ
        </button>
      </div>
    </div>
  );
}

function DecreeLegendModal({ onClose }) {
  const CATEGORIES = [
    {
      id: "decree_fast",
      icon: "📜",
      title: "Быстрый указ",
      duration: "1–2 месяца",
      initiative: 20,
      color: "#7ab09c",
      desc: "Оперативное президентское решение: кадровые назначения, точечные постановления, экстренные меры. Подписывается и вступает в силу немедленно. Эффект ограниченный — вы решаете конкретную проблему, но не меняете систему.",
      examples: ["Отправить в отставку министра", "Ввести временные пошлины на импорт", "Назначить спецпредставителя по переговорам", "Заморозить цены на топливо на 2 месяца"],
      pros: ["Быстро — виден результат уже на следующем ходе", "Дёшево по инициативе"],
      cons: ["Эффект краткосрочный и небольшой", "Не решает структурных проблем"],
    },
    {
      id: "decree_reform",
      icon: "📋",
      title: "Реформа",
      duration: "3–6 месяцев",
      initiative: 35,
      color: "#9c8347",
      desc: "Системные изменения в одной отрасли или сфере государственного управления. Требует согласования ведомств, выделения ресурсов, назначения ответственных. Меняет правила работы — не разовую ситуацию, а механизм.",
      examples: ["Реформа судебной системы", "Налоговая реформа малого бизнеса", "Реструктуризация армейских подразделений", "Программа поддержки регионального экспорта"],
      pros: ["Средний масштаб эффекта", "Относительно управляемый риск", "Виден прогресс по ходам"],
      cons: ["Нужно время — результат через 3–6 ходов", "Может встретить сопротивление элит"],
    },
    {
      id: "decree_program",
      icon: "🏛",
      title: "Крупная программа",
      duration: "7–12 месяцев",
      initiative: 55,
      color: "#9c7ab0",
      desc: "Масштабная государственная инициатива с федеральным бюджетом, KPI, несколькими министерствами-исполнителями. Меняет структуру экономики, вооружённых сил или общества. Высокий риск — провал программы ударит по рейтингу и стабильности. Высокий выигрыш — при успехе эффект многократно превышает реформу.",
      examples: ["Государственная программа вооружений", "Национальный проект «Инфраструктура»", "Программа импортозамещения в IT", "Масштабная демографическая программа"],
      pros: ["Максимальный эффект при успехе", "Видна международному сообществу — влияет на дипломатию"],
      cons: ["Очень дорого по инициативе", "Долгий срок — много ходов до результата", "Провал = крупный штраф к рейтингу и стабильности"],
    },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(14,18,26,0.9)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 8, width: "min(95vw, 680px)", maxHeight: "88vh", overflowY: "auto", color: "#ece7d8" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a3040", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", letterSpacing: "0.15em", marginBottom: 4 }}>ЛИКБЕЗ · ТИПЫ ГОСУДАРСТВЕННЫХ РЕШЕНИЙ</div>
            <div className="doc-font" style={{ fontSize: 15, fontWeight: 700 }}>Как работают указы, реформы и программы</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5a6070", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "20px" }}>
          <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", lineHeight: 1.6, marginBottom: 20 }}>
            Президент не управляет страной напрямую — он задаёт направление. Масштаб решения определяет, насколько глубоко оно меняет систему, сколько времени нужно на исполнение и сколько политического капитала (инициативы) оно стоит.
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {CATEGORIES.map(cat => (
              <div key={cat.id} style={{ background: "#1a1f2c", border: `1px solid ${cat.color}30`, borderRadius: 6, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 20 }}>{cat.icon}</span>
                  <div>
                    <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, color: cat.color }}>{cat.title}</div>
                    <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>
                      СРОК: {cat.duration} · ИНИЦИАТИВА: −{cat.initiative}
                    </div>
                  </div>
                </div>

                <div className="doc-font" style={{ fontSize: 13, color: "#c0b898", lineHeight: 1.55, marginBottom: 12 }}>{cat.desc}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div className="mono-font" style={{ fontSize: 8, color: "#4a6b5c", marginBottom: 5 }}>ПРИМЕРЫ</div>
                    <ul style={{ margin: 0, paddingLeft: 14 }}>
                      {cat.examples.map((e, i) => (
                        <li key={i} className="doc-font" style={{ fontSize: 12, color: "#8a8472", lineHeight: 1.5 }}>{e}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mono-font" style={{ fontSize: 8, color: "#4a6b5c", marginBottom: 5 }}>ПЛЮСЫ</div>
                    {cat.pros.map((p, i) => (
                      <div key={i} className="doc-font" style={{ fontSize: 12, color: "#7ab09c", lineHeight: 1.5, marginBottom: 2 }}>+ {p}</div>
                    ))}
                    <div className="mono-font" style={{ fontSize: 8, color: "#a8313a", marginTop: 6, marginBottom: 5 }}>МИНУСЫ</div>
                    {cat.cons.map((c, i) => (
                      <div key={i} className="doc-font" style={{ fontSize: 12, color: "#c07070", lineHeight: 1.5, marginBottom: 2 }}>− {c}</div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, background: "#1a1f2c", border: "1px solid #2a3040", borderRadius: 4, padding: "12px 16px" }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#9c8347", marginBottom: 6 }}>РАЗВЕДКА И ВОЕННЫЕ ОПЕРАЦИИ</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <span style={{ fontSize: 13 }}>🕵️ </span>
                <span className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#7a9cb0" }}>Разведка</span>
                <span className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginLeft: 6 }}>−20 инициативы</span>
                <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", marginTop: 4, lineHeight: 1.5 }}>Тайная операция — компромат, вербовка, дезинформация, провокация. Случайный исход: от блестящей операции до провала с задержанием агента.</div>
              </div>
              <div>
                <span style={{ fontSize: 13 }}>⚔️ </span>
                <span className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#c07070" }}>Военная операция</span>
                <span className="mono-font" style={{ fontSize: 8, color: "#5a6070", marginLeft: 6 }}>−55 инициативы</span>
                <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", marginTop: 4, lineHeight: 1.5 }}>Прямое применение силы или публичная угроза её применения. Самое дорогое и рискованное действие. Влияет на всех соседей и союзников.</div>
              </div>
            </div>
          </div>

          <button onClick={onClose} style={{ marginTop: 16, width: "100%", background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "10px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Понятно →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App({ gameId, playerName, onNewGame, showWelcome: initialShowWelcome = false }) {
  const [state, setState] = useState(null);
  const [assistMode, setAssistMode] = useState("advisor"); // закреплён на старте партии: "advisor" | "hardcore"
  const [tab, setTab] = useState("overview");
  const [loaded, setLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(initialShowWelcome);
  const [loadError, setLoadError] = useState(null);

  const [draftInput, setDraftInput] = useState("");
  const [actionMode, setActionMode] = useState("decree_fast");
  const [tutorialMode, setTutorialMode] = useState(() => {
    try { return localStorage.getItem("rp_tutorial") !== "off"; } catch { return true; }
  });
  const toggleTutorial = () => setTutorialMode(v => {
    const next = !v;
    try { localStorage.setItem("rp_tutorial", next ? "on" : "off"); } catch {}
    return next;
  });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [turnError, setTurnError] = useState(null);
  const [endTurnResult, setEndTurnResult] = useState(null);
  const [lastActionResult, setLastActionResult] = useState(null); // результат последнего действия (не завершает ход)
  const [sessionTurnStart, setSessionTurnStart] = useState(null); // ход в начале сессии действий
  const [diplomaticReactions, setDiplomaticReactions] = useState(null);
  const [pendingNextState, setPendingNextState] = useState(null);
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const nuclearConfirmRef = useRef(false); // ref для catch-замыкания
  const [gameOutcome, setGameOutcome] = useState(null);
  const draftTextareaRef = useRef(null);
  const [nuclearConfirmError, setNuclearConfirmError] = useState(null);
  const [nuclearAftermath, setNuclearAftermath] = useState(null);

  const [advisors, setAdvisors] = useState(null);
  const [consulting, setConsulting] = useState(false);
  const [advisorError, setAdvisorError] = useState(null);
  const actionModeRef = useRef("decree_fast");
  const consultingRef = useRef(false);

  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showDecreeLegend, setShowDecreeLegend] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const data = await fetchGameState(gameId);
      setState(data);
      if (data.assistMode) setAssistMode(data.assistMode);
      setSessionTurnStart(prev => prev ?? data.turn);
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

  // Предзагрузка советников сразу после загрузки игры
  useEffect(() => {
    if (loaded && state && !advisors && !consulting) {
      handleConsult();
    }
  }, [loaded]);

  // Синхронизируем ref с actionMode чтобы handleConsult всегда читал свежее значение
  useEffect(() => { actionModeRef.current = actionMode; }, [actionMode]);

  // Авто-обновление советников при смене режима
  useEffect(() => {
    if (!loaded || !state) return;
    setAdvisors(null);
    // Если сейчас идёт запрос — дождёмся его конца через consultingRef
    if (!consultingRef.current) {
      handleConsult();
    }
  }, [actionMode]);

  // Обновить советников при переключении на вкладку если данных нет
  useEffect(() => {
    if (tab === "advisors" && !advisors && !consulting) {
      handleConsult();
    }
  }, [tab]);

  async function handlePreview() {
    if (!draftInput.trim() || previewing) return;
    setPreviewing(true);
    setTurnError(null);
    try {
      const NUCLEAR_RE = /ядерн|термоядер|nuclear|атомн.*удар|ракет.*удар.*ядер/i;
      const effectiveMode = NUCLEAR_RE.test(draftInput) ? "military" : actionMode;
      if (effectiveMode !== actionMode) setActionMode("military");
      const result = await previewTurn(gameId, draftInput, effectiveMode);
      setPreview(result);
    } catch (err) {
      setTurnError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  function handleConfirmClick() {
    if (preview?.gmActionType === "nuclear_strike") {
      nuclearConfirmRef.current = true;
      setShowNuclearConfirm(true);
    } else {
      handleConfirm();
    }
  }

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    setTurnError(null);
    setNuclearConfirmError(null);
    try {
      const confirmResult = await confirmTurn(gameId);
      nuclearConfirmRef.current = false;
      setShowNuclearConfirm(false);
      setLastActionResult({
        narrative: preview?.narrative,
        statDeltasPreview: preview?.statDeltasPreview,
        actionMode,
        gmActionType: preview?.gmActionType,
      });
      if (confirmResult?.gameOutcome) {
        setGameOutcome(confirmResult.gameOutcome);
      }
      setPreview(null);
      setDraftInput("");
      setActionMode("decree_fast");
      await loadState();
      setTimeout(() => draftTextareaRef.current?.focus(), 100);
    } catch (err) {
      if (nuclearConfirmRef.current) {
        // Ядерный экран — показываем ошибку прямо там, не закрываем
        if (err.message.includes("Call /turns/preview") || err.message.includes("expired") || err.message.includes("No pending")) {
          setNuclearConfirmError("Сессия истекла — нажмите «Отменить» и «Рассмотреть» снова.");
        } else {
          setNuclearConfirmError(err.message);
        }
      } else {
        setPreview(null);
        setTurnError(err.message);
      }
    } finally {
      setConfirming(false);
    }
  }

  const [ukraineReactions, setUkraineReactions] = useState(null);

  function handleEndTurnDone(newState, worldReactions, ukraineActions) {
    setSessionTurnStart(null);
    const nuclear = (worldReactions || []).filter(r => r.item_type === "nuclear_reaction" || r.type === "nuclear_reaction");
    const isNuclearTurnDone = endTurnResult?.gmActionType === "nuclear_strike";
    if (nuclear.length > 0 || isNuclearTurnDone) {
      const enriched = nuclear.length > 0
        ? nuclear.map(r => {
            const esc = Array.isArray(r.reactions) && r.reactions[0]?.escalation ? r.reactions[0].escalation : 1;
            return { ...r, escalation: esc };
          })
        : [
            { source: "Совет Безопасности ООН", text: "Применение ядерного оружия зафиксировано. Мировое сообщество находится в состоянии шока. Счётчик судного дня переведён на 90 секунд до полуночи.", escalation: 1 },
            { source: "США / НАТО", text: "Все союзники переведены в DEFCON 2. Президент США проводит экстренное заседание Совета национальной безопасности. Ядерный чемоданчик приведён в готовность.", escalation: 3 },
            { source: "Мировые рынки", text: "Биржи закрыты. Торговля заморожена. Глобальная экономика входит в коллапс.", escalation: 1 },
          ];
      setPendingNextState(newState);
      setNuclearAftermath(enriched);
      setEndTurnResult(null);
      return;
    }

    // Сначала: экран ответа Украине, если есть её действия
    const uaItems = (ukraineActions || []).filter(u => u.text);
    if (uaItems.length > 0) {
      setPendingNextState(newState);
      setUkraineReactions({ items: uaItems, pendingWorld: (worldReactions || []).filter(r => r.text && r.source) });
      setEndTurnResult(null);
      return;
    }

    // Потом: дипломатические реакции мира
    const notable = (worldReactions || []).filter(r => r.text && r.source);
    if (notable.length > 0) {
      setPendingNextState(newState);
      setDiplomaticReactions(notable);
      setEndTurnResult(null);
    } else {
      loadState();
      setEndTurnResult(null);
    }
  }

  function handleUkraineDone() {
    const pendingWorld = ukraineReactions?.pendingWorld || [];
    setUkraineReactions(null);
    if (pendingWorld.length > 0) {
      setDiplomaticReactions(pendingWorld);
    } else {
      if (pendingNextState) setState(pendingNextState);
      else loadState();
      setPendingNextState(null);
    }
  }

  function handleDiplomaticRespond(responseText, reaction) {
    setDraftInput(`[Ответ на: ${reaction.source}] ${responseText}`);
  }

  function handleDiplomaticDone() {
    if (pendingNextState) setState(pendingNextState);
    else loadState();
    setDiplomaticReactions(null);
    setPendingNextState(null);
  }

  async function handleCancel() {
    try {
      await cancelTurn(gameId);
    } finally {
      setPreview(null);
      setTurnError(null);
    }
  }

  async function handleSkipTurn() {
    if (confirming) return;
    setConfirming(true);
    setTurnError(null);
    try {
      const result = await skipTurn(gameId);
      const r = { narrative: result.narrative || "Гражданская передышка.", statDeltasPreview: result.statDeltas || {}, actionMode: "skip" };
      if (state?.multiActionTurns) {
        // Внутри месяца — остаёмся, обновляем состояние
        setLastActionResult(r); setDraftInput(""); await loadState();
      } else {
        setEndTurnResult(r); setDraftInput("");
      }
    } catch (err) {
      setTurnError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  async function handleRegroupTurn() {
    if (confirming) return;
    setConfirming(true);
    setTurnError(null);
    try {
      const result = await regroupTurn(gameId);
      const r = { narrative: result.narrative || "Войска переформированы.", statDeltasPreview: result.statDeltas || {}, actionMode: "regroup" };
      if (state?.multiActionTurns) {
        setLastActionResult(r); setDraftInput(""); await loadState();
      } else {
        setEndTurnResult(r); setDraftInput("");
      }
    } catch (err) {
      setTurnError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  async function handleEndTurn() {
    // Мульти-режим: «Завершить месяц» — продвигает месяц, затем обзор реакций мира
    if (state?.multiActionTurns) {
      if (confirming) return;
      setConfirming(true);
      setTurnError(null);
      try {
        const res = await endMonth(gameId);
        setConfirming(false);
        if (res.gameOutcome) { setLastActionResult(null); setGameOutcome(res.gameOutcome); return; }
        // Показываем обзор накопленных за месяц реакций мира / действий Украины
        setEndTurnResult(lastActionResult || { narrative: `Месяц завершён. Наступает месяц ${res.nextMonth}.`, statDeltasPreview: {}, actionMode: "decree" });
        setLastActionResult(null);
      } catch (err) {
        setTurnError(err.message);
        setConfirming(false);
      }
      return;
    }
    // Старая модель: 1 действие = 1 ход
    if (lastActionResult) {
      setEndTurnResult(lastActionResult);
      setLastActionResult(null);
    } else {
      handleSkipTurn();
    }
  }

  async function handleLoadSuggestions() {
    if (loadingSuggestions) return;
    setLoadingSuggestions(true);
    try {
      const result = await fetchSuggestions(gameId, actionMode);
      setSuggestions(result.suggestions || []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function handleConsult() {
    if (consultingRef.current) return;
    consultingRef.current = true;
    setConsulting(true);
    setAdvisorError(null);
    const modeForThisRequest = actionModeRef.current;
    try {
      const result = await consultAdvisors(gameId, draftInput, modeForThisRequest);
      // Если пока запрос шёл пользователь сменил режим — сбрасываем и перезапрашиваем
      if (actionModeRef.current !== modeForThisRequest) {
        setAdvisors(null);
        consultingRef.current = false;
        setConsulting(false);
        handleConsult();
        return;
      }
      setAdvisors(result.advisors);
    } catch (err) {
      setAdvisorError(err.message);
    } finally {
      consultingRef.current = false;
      setConsulting(false);
    }
  }

  if (!loaded) return <CenteredMessage text="Загрузка партии…" />;
  if (loadError || !state) return <CenteredMessage text={`Не удалось загрузить партию: ${loadError || "нет данных"}`} isError />;

  if (gameOutcome) {
    return <EndGameScreen
      outcome={gameOutcome}
      gameId={gameId}
      stats={state?.stats}
      turn={state?.turn ?? 0}
      onRestart={onNewGame}
    />;
  }

  if (showNuclearConfirm) {
    return <NuclearConfirmScreen onConfirm={handleConfirm} onCancel={() => { nuclearConfirmRef.current = false; setShowNuclearConfirm(false); setNuclearConfirmError(null); }} confirming={confirming} error={nuclearConfirmError} />;
  }

  if (nuclearAftermath) {
    return <NuclearAftermathScreen
      reactions={nuclearAftermath}
      onDone={() => {
        setSessionTurnStart(null);
        setNuclearAftermath(null);
        setPendingNextState(null);
        loadState(); // свежий запрос — к этому моменту nuclear worldUpdate уже записан в БД
      }}
    />;
  }

  if (endTurnResult) {
    return <EndTurnScreen prevState={state} turnResult={endTurnResult} gameId={gameId} onDone={handleEndTurnDone} fromTurn={sessionTurnStart} />;
  }

  if (ukraineReactions) {
    return <UkraineResponseScreen items={ukraineReactions.items} onDone={handleUkraineDone} gameId={gameId} />;
  }

  if (diplomaticReactions) {
    return <DiplomaticResponseScreen reactions={diplomaticReactions} onRespond={handleDiplomaticRespond} onSkip={handleDiplomaticDone} gameId={gameId} />;
  }

  const tabs = [
    { id: "overview", label: "Обстановка", icon: Globe2 },
    { id: "map", label: "Карта", icon: Globe2 },
    { id: "stats", label: "Показатели", icon: Shield },
    { id: "world", label: "Мир", icon: Globe2 },
    { id: "advisors", label: "Кабинет министров", icon: ChevronRight },
    { id: "policies", label: "Политики", icon: ChevronRight },
    { id: "relations", label: "Отношения", icon: Landmark },
    { id: "treasury", label: "💰 Казна", icon: Landmark },
    { id: "newsfeed", label: "Лента", icon: ScrollText },
    { id: "log", label: "Журнал", icon: ScrollText },
    ...(assistMode !== "hardcore" ? [{ id: "wiki", label: "📖 Ликбез", icon: ChevronRight }] : []),
  ];

  const isNuclearWorld = (state.newsfeed || []).some(n => n.type === "nuclear_reaction");
  const NK = isNuclearWorld ? {
    pageBg: "#0d0505",
    headerBg: "linear-gradient(180deg,#120303 0%,#1a0505 100%)",
    headerBorder: "#6a1010",
    accent: "#c03030",
    tabBarBg: "#0d0505",
    tabActiveBg: "#2a0808",
    tabActiveColor: "#e8b0b0",
    tabInactiveColor: "#7a4040",
    contentBg: "#1a0808",
    contentColor: "#d0a0a0",
    inputBg: "#14181f",
    footerBg: "#0d0505",
    footerBorder: "#6a1010",
  } : {
    pageBg: "#1a1f2c",
    headerBg: "linear-gradient(180deg,#14181f 0%,#1a1f2c 100%)",
    headerBorder: "#9c8347",
    accent: "#9c8347",
    tabBarBg: "#1a1f2c",
    tabActiveBg: "#ece7d8",
    tabActiveColor: "#1a1f2c",
    tabInactiveColor: "#a8a294",
    contentBg: "#ece7d8",
    contentColor: "#262420",
    inputBg: "#14181f",
    footerBg: "#14181f",
    footerBorder: "#9c8347",
  };

  return (
    <div style={{ minHeight: "100vh", background: NK.pageBg, fontFamily: "'Georgia','Times New Roman',serif", color: "#ece7d8" }}>
      {showWelcome && state && (
        <WelcomeModal state={state} playerName={playerName} onClose={() => setShowWelcome(false)} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${NK.pageBg}; }
        .doc-font { font-family: 'PT Serif', Georgia, serif; }
        .mono-font { font-family: 'JetBrains Mono', monospace; }
        .tab-btn:focus-visible, button:focus-visible { outline: 2px solid ${NK.accent}; outline-offset: 2px; }
        .scroll-hide::-webkit-scrollbar { height: 4px; }
        .scroll-hide::-webkit-scrollbar-thumb { background: #3a4156; }
      `}</style>

      {isNuclearWorld && (
        <div className="mono-font" style={{ background: "#3a0000", color: "#ff4040", fontSize: 10, letterSpacing: "0.2em", textAlign: "center", padding: "5px 0", borderBottom: "1px solid #6a1010" }}>
          ☢ ЯДЕРНЫЙ УДАР НАНЕСЁН · DEFCON 1 · МИР В СОСТОЯНИИ ЯДЕРНОЙ ТРЕВОГИ ☢
        </div>
      )}

      <div style={{ background: NK.headerBg, borderBottom: `2px solid ${NK.headerBorder}`, padding: "18px 20px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.15em", color: NK.accent, marginBottom: 4 }}>
              {isNuclearWorld ? "☢ ЯДЕРНАЯ ВОЙНА · DEFCON 1" : "СОВЕРШЕННО СЕКРЕТНО · ЭКЗ. №1"}
            </div>
            <h1 className="doc-font" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.04em", color: isNuclearWorld ? "#e88080" : "#ece7d8" }}>REALPOLITIK</h1>
            <div className="mono-font" style={{ fontSize: 11, color: isNuclearWorld ? "#9a5050" : "#a8a294", marginTop: 2 }}>
              {state.date} · Ход №{state.turn}{playerName ? ` · ${playerName}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <Lock size={20} color={NK.accent} />
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

      <div className="scroll-hide" style={{ display: "flex", gap: 2, padding: "10px 16px 0", overflowX: "auto", background: NK.tabBarBg }}>
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
                background: active ? NK.tabActiveBg : "transparent", color: active ? NK.tabActiveColor : NK.tabInactiveColor,
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

      <div style={{ background: NK.contentBg, color: NK.contentColor, minHeight: "60vh", padding: "20px 16px 32px" }}>
        {tab === "overview" && <OverviewTab state={state} />}
        {tab === "map" && <MapTab state={state} />}
        {tab === "stats" && <StatsTab state={state} gameId={gameId} />}
        {tab === "world" && <WorldTab state={state} />}
        {tab === "advisors" && (
          <AdvisorsTab
            advisors={advisors}
            consulting={consulting}
            advisorError={advisorError}
            draftInput={draftInput}
            actionMode={actionMode}
            onConsult={handleConsult}
            onSelectAdvice={(adv) => {
              setDraftInput(adv.proposed_decree || adv.recommendation || "");
              const scale = adv.suggested_scale;
              if (scale && ["decree_fast","decree_reform","decree_program","intel","military","diplomacy_op"].includes(scale)) setActionMode(scale);
              setTab("overview");
            }}
          />
        )}
        {tab === "policies" && <PoliciesTab state={state} gameId={gameId} currentTurn={state.turn} onStateRefresh={loadState} />}
        {tab === "relations" && <RelationsTab state={state} />}
        {tab === "treasury" && <TreasuryTab state={state} gameId={gameId} onRefresh={loadState} />}
        {tab === "newsfeed" && <NewsfeedTab state={state} gameId={gameId} onRefresh={loadState} />}
        {tab === "log" && <LogTab state={state} />}
        {tab === "wiki" && <WikiTab />}
      </div>

      {/* Mission panel — always visible above action area */}
      <div style={{ padding: "0 16px 10px" }}>
        <MissionPanel stats={state?.stats} turn={state?.turn ?? 0} maxTurns={24} />
        <TerritoryPanel stats={state?.stats} />
      </div>

      {preview ? (
        <PreviewCard preview={preview} onConfirm={handleConfirmClick} onCancel={handleCancel} confirming={confirming} gameId={gameId} onObjectionWithdrawn={() => {}} />
      ) : (
        <div style={{ background: NK.footerBg, borderTop: `2px solid ${NK.footerBorder}`, padding: "14px 16px" }}>

          {/* Баннер последнего выполненного действия */}
          {lastActionResult && (
            <div style={{ background: "#0d1a10", border: "1px solid #2a4030", borderLeft: "3px solid #7fae93", borderRadius: 4, padding: "10px 12px", marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#7fae93", letterSpacing: "0.08em", marginBottom: 4 }}>
                  {state?.multiActionTurns
                    ? `✓ РЕШЕНИЕ ПРИНЯТО · МЕСЯЦ ПРОДОЛЖАЕТСЯ · ИНИЦИАТИВА ${state?.stats?.initiative ?? 0}`
                    : "✓ РЕШЕНИЕ ВЫПОЛНЕНО · МОЖЕТЕ ДЕЙСТВОВАТЬ ЕЩЁ"}
                </div>
                <div className="doc-font" style={{ fontSize: 12.5, color: "#a0c090", lineHeight: 1.5 }}>{lastActionResult.narrative}</div>
              </div>
              <button onClick={() => setLastActionResult(null)} style={{ background: "none", border: "none", color: "#4a6050", cursor: "pointer", fontSize: 16, lineHeight: 1, flexShrink: 0, padding: "0 0 0 4px" }}>×</button>
            </div>
          )}

          {/* Заголовок действия + переключатель режима */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {lastActionResult ? (
                <div className="mono-font" style={{ fontSize: 10, color: "#7fae93", letterSpacing: "0.08em", background: "#0a1a0d", border: "1px solid #2a4030", borderRadius: 3, padding: "4px 10px" }}>
                  {state?.multiActionTurns ? "➕ ЕЩЁ ОДНО РЕШЕНИЕ (хватит инициативы) — ИЛИ «ЗАВЕРШИТЬ МЕСЯЦ»" : "➕ ДОБАВЬТЕ ЕЩЁ ОДНО ДЕЙСТВИЕ — ИЛИ ЗАВЕРШИТЕ ХОД"}
                </div>
              ) : (
                <>
                  <StepBadge n={1} active />
                  <div style={{ height: 1, width: 20, background: "#3a4156" }} />
                  <StepBadge n={2} />
                  <div className="mono-font" style={{ fontSize: 10, color: "#9c8347", letterSpacing: "0.08em", marginLeft: 6 }}>
                    СФОРМУЛИРУЙТЕ РЕШЕНИЕ И НАЖМИТЕ «РАССМОТРЕТЬ»
                  </div>
                </>
              )}
            </div>
            {assistMode === "hardcore" ? (
              <span className="mono-font" title="Режим «Сам по себе» — игровые подсказки отключены на старте партии" style={{ border: "1px solid #4a2020", borderRadius: 4, padding: "3px 8px", fontSize: 9, color: "#8a4040", flexShrink: 0, letterSpacing: "0.04em" }}>
                🎖 сам по себе
              </span>
            ) : (
              <button
                onClick={toggleTutorial}
                title={tutorialMode ? "Советник включён — нажмите чтобы скрыть" : "Советник скрыт — нажмите чтобы показать подсказки"}
                style={{ background: tutorialMode ? "#0e1a10" : "#2a2410", border: `1px solid ${tutorialMode ? "#2a5030" : "#9c8347"}`, borderRadius: 4, padding: "3px 8px", fontFamily: "monospace", fontSize: 9, color: tutorialMode ? "#4a9c6a" : "#c8b87a", cursor: "pointer", flexShrink: 0, letterSpacing: "0.04em" }}
              >
                {tutorialMode ? "💡 советник" : "💡 показать подсказки"}
              </button>
            )}
          </div>

          {/* Панель подсказок — скрыта в режиме «сам по себе». Показывается каждый ход. */}
          {tutorialMode && assistMode !== "hardcore" && (
            <SmartHintsPanel
              stats={state?.stats}
              turn={state?.turn ?? 0}
              onSelectHint={(h) => {
              if (h.mode === "regroup") {
                // Прокручиваем к блоку с кнопками действий — пусть игрок нажмёт сам
                document.getElementById("action-buttons-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
              }
              setActionMode(h.mode);
              const raw = h.example || "";
              const modeLabels = {
                decree_fast: "Настоящим постановляю",
                decree_reform: "В целях реформирования приказываю",
                decree_program: "Утверждаю программу",
                military: "Приказываю Генеральному штабу",
                diplomacy_op: "Министерству иностранных дел поручаю",
                skip: "",
              };
              const prefix = modeLabels[h.mode] || "Приказываю";
              setDraftInput(prefix ? `${prefix}: ${raw.charAt(0).toLowerCase()}${raw.slice(1)}` : raw);
            }}
              onClose={() => setTutorialMode(false)}
            />
          )}

          {turnError && (
            <div className="doc-font" style={{ color: "#e09090", fontSize: 12.5, marginBottom: 8 }}>
              Ошибка: {turnError}
            </div>
          )}

          {/* Подсказки */}
          {suggestions && suggestions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 6 }}>
                {{ decree_reform: "ВАРИАНТЫ РЕФОРМ", decree_program: "ВАРИАНТЫ ПРОГРАММ", intel: "ВАРИАНТЫ ОПЕРАЦИЙ", military: "ВАРИАНТЫ ОПЕРАЦИЙ" }[actionMode] || "ВАРИАНТЫ УКАЗОВ"} — нажмите чтобы выбрать:
              </div>
              {(() => {
                const info = ACTION_MODE_INFO[actionMode] || ACTION_MODE_INFO.decree_fast;
                return (
                  <div style={{ background: "#141b24", border: "1px solid #2a3545", borderRadius: 4, padding: "6px 9px", marginBottom: 7 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginBottom: 3 }}>
                      <span className="mono-font" style={{ fontSize: 9, color: "#9c8347" }}>⚡ {info.cost} инициативы</span>
                      {info.money != null && <span className="mono-font" style={{ fontSize: 9, color: "#c8b87a" }}>💰 {info.money} казны (~₽{(info.money*0.8).toFixed(1)} трлн)</span>}
                      <span className="mono-font" style={{ fontSize: 9, color: "#7a8898" }}>⏳ {info.duration}</span>
                      <span className="mono-font" style={{ fontSize: 9, color: info.riskColor }}>⚠ {info.risk}</span>
                    </div>
                    <div className="doc-font" style={{ fontSize: 11, color: "#8a96a6", lineHeight: 1.35 }}>{info.desc}</div>
                    <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6a7a", fontStyle: "italic", marginTop: 2 }}>Точные изменения статов покажет «Рассмотреть».</div>
                  </div>
                );
              })()}
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

          {/* Разведбонус — следующее действие усилено успешной операцией */}
          {(state?.stats?.next_action_boost ?? 0) > 0 && (
            <div style={{ background: "#1a1426", border: "1px solid #6a4aa0", borderRadius: 4, padding: "7px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#b08ad8", fontSize: 13 }}>🕵️</span>
              <span className="mono-font" style={{ fontSize: 9, color: "#b08ad8", letterSpacing: "0.08em" }}>РАЗВЕДКА ВСКРЫЛА СЛАБЫЕ МЕСТА — СЛЕДУЮЩЕЕ ДЕЙСТВИЕ УСИЛЕНО (+30% к эффекту)</span>
            </div>
          )}

          {/* Кризисный режим — баннер */}
          {state?.overview?.crisis_mode && (
            <div style={{ background: "#3a1414", border: "1px solid #c04040", borderRadius: 4, padding: "7px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#e06060", fontSize: 13 }}>⚠</span>
              <span className="mono-font" style={{ fontSize: 9, color: "#e06060", letterSpacing: "0.1em" }}>РЕЖИМ ЧС АКТИВЕН · 1 ХОД = 2 НЕДЕЛИ · ТОЛЬКО БЫСТРЫЕ УКАЗЫ</span>
            </div>
          )}

          {/* Инициатива */}
          {(() => {
            const initiative = state?.stats?.initiative ?? 100;
            const crisisMode = !!(state?.overview?.crisis_mode);
            const multi = !!state?.multiActionTurns;
            const COST = { decree_fast: 20, decree_reform: 35, decree_program: 55, decree: 35, intel: 20, military: 55, crisis: 15, diplomacy_op: 35 };
            const cost = COST[actionMode] ?? 35;
            const regen = multi ? 0 : (crisisMode ? 35 : 25);
            const after = Math.min(100, initiative + regen) - cost;
            const color = after < 0 ? "#e09090" : after < 20 ? "#9c8347" : "#7fae93";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", flexShrink: 0 }}>ИНИЦИАТИВА</div>
                <div style={{ flex: 1, height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${initiative}%`, height: "100%", background: initiative > 50 ? "#7fae93" : initiative > 25 ? "#9c8347" : "#e09090", transition: "width 0.3s", borderRadius: 2 }} />
                </div>
                <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>{initiative}</div>
                <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>→</div>
                <div className="mono-font" style={{ fontSize: 9, color }}>
                  {after < 0 ? "недостаточно" : after} {multi ? "после действия" : "после хода"}
                </div>
                <div className="mono-font" style={{ fontSize: 8, color: "#3a4050" }}>{multi ? `(−${cost} ⚡)` : `(+${regen} ↻ −${cost} ⚡)`}</div>
              </div>
            );
          })()}

          {/* Казна (бюджет) + месячный поток + предупреждение о спирали */}
          {(() => {
            const T = 0.8; // ₽ трлн за пункт
            const treasury = state?.stats?.treasury ?? 52;
            const economy = state?.stats?.economy ?? 50;
            const [showTreasuryTip, setShowTreasuryTip] = useState(false);
            const MONEY = { military: 20, decree_program: 15, decree_reform: 8, decree: 8, decree_fast: 3, diplomacy_op: 5, intel: 5, crisis: 4 };
            const cost = MONEY[actionMode] ?? 0;
            const after = treasury - cost;
            const deficit = treasury < 0;
            const barPct = Math.max(0, Math.min(100, treasury));
            const afterColor = after < 0 ? "#e09090" : after < 15 ? "#c89347" : "#7fae93";
            // Прогноз месячного потока: доход (экономика + налоги) − содержание программ
            const activePol = (state?.policies || []).filter(p => p.status !== "cancelled");
            const taxIncome = activePol.reduce((s, p) => s + (Number(p.budget_income) || 0), 0);
            const upkeep = activePol.reduce((s, p) => s + (Number(p.budget_upkeep) || 0), 0);
            const ecoIncome = Math.round(economy * 0.4);
            const net = ecoIncome + taxIncome - upkeep;
            const netColor = net > 0 ? "#7fae93" : net < 0 ? "#e09090" : "#9c8347";
            // Спираль к коллапсу: казна тает И экономика уже низкая
            const spiral = net < 0 && economy < 45;
            return (
              <>
                <div style={{ position: "relative" }}
                  onMouseEnter={() => setShowTreasuryTip(true)}
                  onMouseLeave={() => setShowTreasuryTip(false)}
                >
                {showTreasuryTip && (
                  <div style={{ position: "absolute", bottom: "110%", left: 0, zIndex: 99, background: "#1a2030", border: "1px solid #2a3848", borderRadius: 6, padding: "10px 14px", width: 280, boxShadow: "0 4px 16px #00000080" }}>
                    <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", letterSpacing: "0.1em", marginBottom: 6 }}>КАК РАБОТАЕТ КАЗНА</div>
                    <div className="doc-font" style={{ fontSize: 11, color: "#a0a8b8", lineHeight: 1.5 }}>
                      <b style={{ color: "#c8b87a" }}>Доход каждый месяц</b> = налоги от экономики + налоговые политики.<br/>
                      При экономике выше 50 — доход растёт. Ниже 50 — падает. Ниже 35 — почти нет.<br/>
                      <b style={{ color: "#c8b87a" }}>Расход</b> = содержание активных программ (бюджетное обеспечение).<br/>
                      <b style={{ color: "#c89090" }}>Дефицит</b> (казна &lt; 0) → инфляция +2, экономика −2.<br/>
                      <b style={{ color: "#e09090" }}>Спираль</b>: слабая экономика → меньше дохода → казна тает → ещё слабее экономика.<br/>
                      Каждое действие списывает очки казны напрямую.
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", flexShrink: 0, cursor: "help" }}>КАЗНА ⓘ</div>
                  <div style={{ flex: 1, height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${barPct}%`, height: "100%", background: deficit ? "#e09090" : treasury > 40 ? "#c8b87a" : "#c89347", transition: "width 0.3s", borderRadius: 2 }} />
                  </div>
                  <div className="mono-font" style={{ fontSize: 9, color: deficit ? "#e09090" : "#c8b87a" }}>{deficit ? "ДЕФИЦИТ " : ""}₽{(treasury * T).toFixed(1)} трлн</div>
                  <div className="mono-font" style={{ fontSize: 8, color: netColor }}>{net >= 0 ? "+" : ""}{net}/мес</div>
                  {cost > 0 && <>
                    <div className="mono-font" style={{ fontSize: 9, color: "#5a6070" }}>→</div>
                    <div className="mono-font" style={{ fontSize: 9, color: afterColor }}>₽{(after * T).toFixed(1)} трлн</div>
                    <div className="mono-font" style={{ fontSize: 8, color: "#3a4050" }}>(−{cost} 💰)</div>
                  </>}
                </div>
                {spiral && (
                  <div style={{ background: "#2a1414", border: "1px solid #a8313a", borderRadius: 4, padding: "6px 10px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#e06060", fontSize: 12 }}>📉</span>
                    <span className="doc-font" style={{ fontSize: 11, color: "#e09090", lineHeight: 1.35 }}>
                      Спираль к коллапсу: экономика {economy} и казна тает ({net}/мес). Поднимите доход (налоговые политики), срежьте содержание программ или поддержите экономику быстрым указом.
                    </span>
                  </div>
                )}
                </div>{/* /tooltip wrapper */}
              </>
            );
          })()}

          {/* Тип действия */}
          {showDecreeLegend && <DecreeLegendModal onClose={() => setShowDecreeLegend(false)} />}
          {(() => {
            const crisisMode = !!(state?.overview?.crisis_mode);
            const decreeButtons = crisisMode
              ? [{ id: "crisis", label: "⚡ Антикризисный", cost: 15, tip: "Экстренный указ. Дёшево, быстро, краткосрочно.", dur: "1–2 мес." }]
              : [
                  { id: "decree_fast",    label: "📜 Быстрый указ",  cost: 20, tip: "Оперативное решение. 1–2 месяца.",    dur: "1–2 мес." },
                  { id: "decree_reform",  label: "📋 Реформа",        cost: 35, tip: "Системные изменения. 3–6 месяцев.",   dur: "3–6 мес." },
                  { id: "decree_program", label: "🏛 Программа",      cost: 55, tip: "Масштабная инициатива. 7–12 месяцев.", dur: "7–12 мес." },
                ];
            const allButtons = [
              ...decreeButtons,
              { id: "intel",    label: "🕵️ Разведка",     cost: 20, tip: "Тайная операция. Компромат, агентура, провокации. Случайный исход.", dur: null },
              { id: "military", label: "⚔️ Военная оп.",  cost: 55, tip: "Прямое применение силы. Двигает территориальный контроль. Эскалирует, получает отпор.", dur: null },
              { id: "diplomacy_op", label: "🤝 Диппереговоры", cost: 35, tip: "Прямые контакты с партнёрами. Двигает мирный трек. Не влияет на территории.", dur: null },
            ];
            // Если текущий режим несовместим с кризисом — сбросить на crisis
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {allButtons.map(({ id, label, cost, tip, dur }) => (
                  <button
                    key={id}
                    onClick={() => { setActionMode(id); setSuggestions(null); }}
                    title={tip}
                    style={{
                      background: actionMode === id ? "#1f2733" : "transparent",
                      border: `1px solid ${actionMode === id ? "#9c8347" : "#2a3040"}`,
                      color: actionMode === id ? "#9c8347" : "#5a6070",
                      borderRadius: 4, padding: "4px 8px",
                      fontFamily: "'JetBrains Mono',monospace", fontSize: 9,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                    }}
                  >
                    {label}
                    <span style={{ color: "#5a6070" }}>−{cost}</span>
                    {dur && <span style={{ color: "#3a4050", fontSize: 8 }}>{dur}</span>}
                  </button>
                ))}
                <button
                  onClick={() => setShowDecreeLegend(true)}
                  title="Что такое быстрый указ, реформа и программа?"
                  style={{ background: "transparent", border: "1px solid #2a3040", borderRadius: "50%", width: 22, height: 22, color: "#5a6070", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                >?</button>
              </div>
            );
          })()}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={draftTextareaRef}
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              placeholder={
                actionMode === "intel" ? "Опишите разведывательную или тайную операцию…"
                : actionMode === "military" ? "Опишите военную операцию или приказ…"
                : actionMode === "decree_program" ? "Опишите крупную государственную программу (7–12 мес.)…"
                : actionMode === "decree_reform" ? "Опишите реформу (3–6 мес.)…"
                : actionMode === "crisis" ? "Опишите экстренную меру (ЧС режим)…"
                : "Опишите быстрый указ или решение (1–2 мес.)…"
              }
              rows={2}
              disabled={previewing}
              style={{ flex: 1, resize: "none", background: "#ece7d8", color: "#262420", border: `1px solid ${lastActionResult ? "#7fae93" : "#3a4156"}`, borderRadius: 4, padding: "8px 10px", fontFamily: "'PT Serif',serif", fontSize: 13.5, boxShadow: lastActionResult ? "0 0 0 2px rgba(127,174,147,0.25)" : "none" }}
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

          {/* Завершить ход / месяц */}
          <div id="action-buttons-anchor" style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {state?.multiActionTurns ? (
              /* Мульти-режим: действия внутри месяца + явное завершение месяца */
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  onClick={handleRegroupTurn}
                  disabled={confirming}
                  title="Перегруппировка — инициатива +75, армия отдыхает. Действие внутри месяца."
                  style={{ ...btnStyle("#1a2a1a", "#5a8050"), border: "1px solid #2a4030", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                >
                  {confirming ? "…" : "⚙ Перегруппировка"}
                </button>
                <button
                  onClick={handleSkipTurn}
                  disabled={confirming}
                  title="Гражданская передышка — восстанавливает тыл. Действие внутри месяца."
                  style={{ ...btnStyle("#1f2733", "#7a8aa0"), border: "1px solid #2a3040", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                >
                  {confirming ? "…" : "🏠 Передышка (тыл +)"}
                </button>
                <button
                  onClick={handleEndTurn}
                  disabled={confirming}
                  title="Завершить месяц — восстановить инициативу, увидеть реакцию мира, перейти к следующему месяцу."
                  style={{ ...btnStyle("#2a2410", "#c8b87a"), border: "1px solid #9c8347", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                >
                  {confirming ? "…" : "🗓 Завершить месяц → реакция мира"}
                </button>
              </div>
            ) : (
              <>
                {!lastActionResult && (
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      onClick={handleRegroupTurn}
                      disabled={confirming}
                      title="Перегруппировка — инициатива +75, армия отдыхает. Мягкие эффекты, нет штрафов"
                      style={{ ...btnStyle("#1a2a1a", "#5a8050"), border: "1px solid #2a4030", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                    >
                      {confirming ? "…" : "⚙ Перегруппировка (+75 инициативы)"}
                    </button>
                    <button
                      onClick={handleEndTurn}
                      disabled={confirming}
                      title="Гражданская передышка — восстанавливает тыл (экономика/рейтинг/стабильность) и +40 инициативы."
                      style={{ ...btnStyle("#1f2733", "#7a8aa0"), border: "1px solid #2a3040", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                    >
                      {confirming ? "…" : "🏠 Гражданская передышка (тыл +)"}
                    </button>
                  </div>
                )}
                {lastActionResult && (
                  <button
                    onClick={handleEndTurn}
                    disabled={confirming}
                    title="Завершить ход и увидеть реакцию мира"
                    style={{ ...btnStyle("#1f2733", "#9c8347"), border: "1px solid #3a3020", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                  >
                    {confirming ? "…" : "⏭ Завершить ход → реакция мира"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mono-font" style={{ textAlign: "center", fontSize: 10, letterSpacing: "0.1em", color: "#5a5f6e", padding: "10px 0 16px", background: "#1a1f2c" }}>
        ПАНЕЛЬ ОБНОВЛЯЕТСЯ ПО ХОДАМ
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

const ACTION_MODE_BADGE = {
  decree_fast:    { label: "📜 Быстрый указ",     color: "#7ab09c" },
  decree_reform:  { label: "📋 Реформа",           color: "#9c8347" },
  decree_program: { label: "🏛 Крупная программа", color: "#9c7ab0" },
  intel:          { label: "🕵️ Разведка",          color: "#7a9cb0" },
  military:       { label: "⚔️ Военная операция",  color: "#c07070" },
  diplomacy_op:   { label: "🤝 Диппереговоры",     color: "#5b8cb0" },
  crisis:         { label: "⚡ Антикризисный",     color: "#c09030" },
};

function AdvisorsTab({ advisors, consulting, advisorError, draftInput, actionMode, onConsult, onSelectAdvice }) {
  const badge = ACTION_MODE_BADGE[actionMode] || ACTION_MODE_BADGE.decree_fast;
  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.1em" }}>СОВЕТ ПО РЕЖИМУ:</span>
          <span style={{ background: badge.color + "22", border: `1px solid ${badge.color}55`, borderRadius: 4, padding: "3px 10px", color: badge.color, fontFamily: "'PT Serif',serif", fontSize: 12 }}>{badge.label}</span>
          {consulting && <span className="mono-font" style={{ fontSize: 9, color: "#9c8347", animation: "pulse 1.2s infinite" }}>обновляется…</span>}
        </div>
        <button
          onClick={onConsult}
          disabled={consulting}
          style={{ background: consulting ? "#5a5040" : "#9c8347", color: "#1a1f2c", border: "none", borderRadius: 4, padding: "7px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: consulting ? "default" : "pointer", opacity: consulting ? 0.7 : 1 }}
        >
          {draftInput.trim() ? "Совет по черновику" : "Обновить совет"}
        </button>
      </div>
      {draftInput.trim() && !consulting && (
        <div className="doc-font" style={{ marginBottom: 10, fontSize: 12, color: "#5c5648", fontStyle: "italic" }}>
          Советники прочитают ваш черновик: «{draftInput.slice(0, 80)}{draftInput.length > 80 ? "…" : ""}»
        </div>
      )}
      {advisorError && (
        <div className="doc-font" style={{ marginBottom: 10, fontSize: 12.5, color: "#a8313a" }}>
          Ошибка: {advisorError}
        </div>
      )}

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
                    {adv.suggested_scale && (
                      <span className="mono-font" style={{ fontSize: 8, padding: "2px 6px", borderRadius: 2, background: adv.suggested_scale === "decree_program" ? "#2a1f3a" : adv.suggested_scale === "decree_reform" ? "#1a2a1f" : "#1f2a2a", color: adv.suggested_scale === "decree_program" ? "#9c7ab0" : adv.suggested_scale === "decree_reform" ? "#7ab09c" : "#7a9cb0", letterSpacing: "0.06em" }}>
                        {{ decree_fast: "БЫСТРЫЙ УКАЗ", decree_reform: "РЕФОРМА", decree_program: "ПРОГРАММА", intel: "РАЗВЕДКА", military: "ВОЕННАЯ ОП." }[adv.suggested_scale] || adv.suggested_scale}
                      </span>
                    )}
                  </div>
                </div>
                <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.55, color: "#3a362e", marginBottom: 10 }}>
                  {adv.recommendation}
                </div>
                {adv.proposed_decree && adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                  <div style={{ background: "#ece3cf", borderLeft: "3px solid #9c8347", borderRadius: 3, padding: "6px 9px", marginBottom: 10 }}>
                    <div className="mono-font" style={{ fontSize: 8, color: "#9c8347", letterSpacing: "0.08em", marginBottom: 2 }}>ПРЕДЛАГАЕМЫЙ УКАЗ</div>
                    <div className="doc-font" style={{ fontSize: 12.5, color: "#3a362e", fontStyle: "italic", lineHeight: 1.45 }}>«{adv.proposed_decree}»</div>
                  </div>
                )}
                {adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                  <button
                    onClick={() => onSelectAdvice(adv)}
                    title={adv.proposed_decree ? `Вставит указ: «${adv.proposed_decree}»` : undefined}
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
const STAT_COLOR = { economy: "#3a8a7a", military: "#a8313a", stability: "#4a6b5c", diplomacy: "#5b6b8c", approval: "#8c6b3a" };

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
  const [expandedStat, setExpandedStat] = useState(null);

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
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 12 }}>ОПЕРАТИВНАЯ СВОДКА · нажмите для деталей</div>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(stats).filter(([key]) => STAT_LABEL[key]).map(([key, value]) => {
                const lvl = statLevel(value);
                const color = STAT_COLOR[key] || "#9c8347";
                const substats = (SUBSTAT_META[key] || []).map(sm => ({ ...sm, value: stats[sm.key] ?? 50 }));
                const isOpen = expandedStat === key;
                return (
                  <div key={key} style={{ background: "#1f2733", borderRadius: 4, border: `1px solid ${isOpen ? color + "44" : "transparent"}`, overflow: "hidden", cursor: "pointer" }}
                    onClick={() => setExpandedStat(isOpen ? null : key)}>
                    <div style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                        <span className="doc-font" style={{ fontSize: 13.5, fontWeight: 700, color: "#ece7d8" }}>
                          {STAT_LABEL[key]}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="mono-font" style={{ fontSize: 9, color: lvl.color, letterSpacing: "0.08em" }}>{lvl.label.toUpperCase()}</span>
                          <span className="mono-font" style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
                          <span style={{ fontSize: 10, color, transition: "transform 0.2s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                        </div>
                      </div>
                      <div style={{ height: 5, background: "#2a3040", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3 }} />
                      </div>
                    </div>
                    {isOpen && substats.length > 0 && (
                      <div style={{ borderTop: `1px solid ${color}22`, padding: "10px 14px 12px", background: "#18202a" }}>
                        <div className="mono-font" style={{ fontSize: 8, color: "#4a5060", letterSpacing: "0.08em", marginBottom: 8 }}>ДЕТАЛЬНЫЕ ПОКАЗАТЕЛИ</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 14px" }}>
                          {substats.map(s => {
                            const displayVal = s.inverted ? 100 - s.value : s.value;
                            const clr = displayVal >= 60 ? "#4a8a6a" : displayVal >= 40 ? "#9c8347" : "#c05050";
                            return (
                              <div key={s.key}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                  <span className="doc-font" style={{ fontSize: 11, color: "#8a9aaa" }}>{s.label}</span>
                                  <span className="mono-font" style={{ fontSize: 11, color: clr, fontWeight: 700 }}>{s.value}</span>
                                </div>
                                <div style={{ height: 3, background: "#2a3040", borderRadius: 2, overflow: "hidden" }}>
                                  <div style={{ width: `${displayVal}%`, height: "100%", background: clr }} />
                                </div>
                                {s.desc && <div style={{ fontSize: 9.5, color: "#4a5060", marginTop: 2, fontFamily: "monospace", lineHeight: 1.3 }}>{s.desc}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Цель */}
          <div style={{ border: "1px solid #9c8347", borderRadius: 4, padding: "14px 16px", marginBottom: 24 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 10 }}>ЦЕЛЬ ОПЕРАЦИИ · 24 ХОДА (2 ГОДА)</div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#ece7d8", lineHeight: 1.65, marginBottom: 16 }}>
              Завершите мирный процесс по Украине и стабилизируйте страну к <strong style={{ color: "#9c8347" }}>концу 2027 года</strong>.
            </div>

            {/* Условия победы */}
            <div className="mono-font" style={{ fontSize: 9, color: "#4a6b5c", letterSpacing: "0.1em", marginBottom: 8 }}>УСЛОВИЯ ПОБЕДЫ (все сразу)</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
              {[
                { label: "☮ Мирный договор", desc: "Донбасс и Луганск → России, Запорожье и Херсон по линии разграничения. США и Китай — наблюдатели. Санкции сняты.", color: "#4a6b5c" },
                { label: "📈 Экономика ≥ 55", desc: "Рост ВВП, снижение инфляции, восстановление резервов после санкционного давления.", color: "#3a8a7a" },
                { label: "🗳 Рейтинг ≥ 60", desc: "Поддержка населения достаточна для легитимного управления страной.", color: "#8c6b3a" },
                { label: "🛡 Стабильность ≥ 60", desc: "Отсутствие серьёзных внутренних угроз, управляемое общество.", color: "#4a6b5c" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1f2733", borderRadius: 3, padding: "8px 12px", borderLeft: `3px solid ${color}` }}>
                  <div className="doc-font" style={{ fontSize: 12.5, color: "#ece7d8", fontWeight: 700, marginBottom: 3 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 11.5, color: "#6a7080", lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Три пути к победе */}
            <div className="mono-font" style={{ fontSize: 9, color: "#5b6b8c", letterSpacing: "0.1em", marginBottom: 8 }}>ТРИ ПУТИ К ПОБЕДЕ</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              {[
                { label: "⚔️ Военный путь", desc: "Донецк 100%, Луганск 100% + 2 из 3 (Запорожье ≥85%, Херсон ≥65%, Харьков ≥50%). Армия ≥85, мораль/готовность ≥70, тыл ≥52, экономика ≥36. Срабатывает при мирном треке < 35.", color: "#9c6347" },
                { label: "🕊 Принуждение к миру", desc: "Те же территории, НО мирный трек ≥40 — «дипломатия с позиции силы». Лучший исход: оба пути сошлись.", color: "#26a69a" },
                { label: "☮ Дипломатический путь", desc: "Мирный трек до 100 (диппереговоры). Требует: экономика ≥65, рейтинг ≥65, стабильность ≥65.", color: "#4a6b8c" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div className="mono-font" style={{ fontSize: 9, color: "#5b6b8c", letterSpacing: "0.1em", marginBottom: 8 }}>ВАЖНО ПРО МИРНЫЙ ТРЕК</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
              {[
                { label: "⚔️ Военное наступление", desc: "Срывает переговоры — мирный трек откатывается. Установленный мир (≥40) держится крепче, чем низкий. Наступление двигает территории, но мир придётся строить дипломатией", color: "#9c6347" },
                { label: "☢️ Ядерный удар", desc: "Катастрофический откат мирного трека (-40). Международная изоляция", color: "#a8313a" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 11, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Ресурсы хода */}
            <div className="mono-font" style={{ fontSize: 9, color: "#5b6b8c", letterSpacing: "0.1em", marginBottom: 8 }}>РЕСУРСЫ: МЕСЯЦ, ИНИЦИАТИВА, КАЗНА</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {[
                { label: "🗓 Несколько действий в месяц", desc: "За один месяц можно принять несколько решений, пока хватает инициативы. Месяц продвигается только по кнопке «Завершить месяц».", color: "#9c8347" },
                { label: "⚡ Инициатива", desc: "Политическая воля — бюджет действий на месяц. Тратится на каждое решение, восстанавливается в конце месяца.", color: "#7fae93" },
                { label: "💰 Казна (бюджет)", desc: "Деньги. Действия стоят казны (война — дороже всего). Доход: экономика + налоги. Расход: содержание программ. Казна и экономика связаны: пустая казна тянет экономику вниз, здоровая — вверх; слабая экономика сушит доход. Дефицит — спираль вниз.", color: "#c8b87a" },
                { label: "⚙ Перегруппировка / 🏠 Передышка", desc: "Перегруппировка — отдых фронта (мораль, готовность, инициатива). Передышка — восстановление тыла (экономика, рейтинг, стабильность).", color: "#5a8050" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Типы решений */}
            <div className="mono-font" style={{ fontSize: 9, color: "#5b6b8c", letterSpacing: "0.1em", marginBottom: 8 }}>ТИПЫ РЕШЕНИЙ (сила растёт с ценой)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {[
                { label: "📜 Быстрый указ", desc: "Дёшево, эффект слабее (~2 хода). ⚡20 💰3", color: "#5a9c6a" },
                { label: "📋 Реформа", desc: "Средняя сила и длительность (~5 ходов). ⚡35 💰8", color: "#9c8347" },
                { label: "🏛 Программа", desc: "Сильнее всех, держится ~10 ходов, но дорого. ⚡55 💰15", color: "#c89347" },
                { label: "🕵️ Разведка", desc: "Случайный исход. Успех даёт +30% к эффекту СЛЕДУЮЩЕГО действия. ⚡20 💰5", color: "#b08ad8" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Политики */}
            <div className="mono-font" style={{ fontSize: 9, color: "#5b6b8c", letterSpacing: "0.1em", marginBottom: 8 }}>ДЕЙСТВУЮЩИЕ ПОЛИТИКИ</div>
            <div style={{ background: "#1a2030", borderRadius: 3, padding: "8px 11px", marginBottom: 16 }}>
              <div className="doc-font" style={{ fontSize: 11, color: "#7a8090", lineHeight: 1.45 }}>
                Вкладка «Политики» сгруппирована: <span style={{ color: "#9c7ab0" }}>программы</span>, <span style={{ color: "#3a8a7a" }}>реформы</span>, <span style={{ color: "#5b6b8c" }}>указы</span>. У каждой видно, что вырастет при успехе и последствия отмены. Налоговые (НДС, утильсбор) <b>пополняют казну</b>, но бьют по рейтингу; программы <b>стоят на содержание</b>. Отмена непопулярной политики может поднять рейтинг — но лишит дохода.
              </div>
            </div>

            {/* Условия поражения */}
            <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.1em", marginBottom: 8 }}>ПОРАЖЕНИЕ (любое из условий)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
              {[
                { cond: "Рейтинг < 30", res: "Переворот", color: "#a8313a" },
                { cond: "Экономика < 30", res: "Коллапс", color: "#a8313a" },
                { cond: "Стабильность < 25", res: "Волнения", color: "#a8313a" },
                { cond: "Дипломатия < 15", res: "Изоляция", color: "#ab47bc" },
                { cond: "3+ наступления подряд без отдыха", res: "Спираль войны", color: "#ff5722" },
              ].map(({ cond, res, color }) => (
                <div key={cond} style={{ background: "#2a1a1a", borderRadius: 3, padding: "7px 9px", borderTop: `2px solid ${color}` }}>
                  <div className="mono-font" style={{ fontSize: 8.5, color: "#6a4040", marginBottom: 2 }}>{cond}</div>
                  <div className="mono-font" style={{ fontSize: 9.5, color, fontWeight: 700 }}>{res}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Инструкция */}
          <div style={{ marginBottom: 26 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 12 }}>КАК ИГРАТЬ</div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                ["1", "Читайте «Обстановку»", "Очаги напряжённости кликабельны. Вкладка «Мир» — ходы других стран, «Политики» — что уже действует."],
                ["2", "Спросите кабинет министров", "Вкладка «Кабинет министров» → «Запросить совет». Каждый министр даёт мнение И готовую формулировку указа. «Принять совет» вставит её и выставит нужный тип. Советник 💡 внизу подсказывает по всем направлениям сразу."],
                ["3", "Сформулируйте решение", "Выберите тип (указ/реформа/программа/военная/дипломатия/разведка) — под полем видно цену ⚡ инициативы и 💰 казны. Напишите текст или возьмите вариант из «💡 Подсказок»."],
                ["4", "«Рассмотреть →» и подтвердите", "ИИ-геймместер покажет прогноз и возражение советника. Подтверждение тратит инициативу и казну, но месяц НЕ заканчивает."],
                ["5", "Несколько решений за месяц", "Пока хватает инициативы — принимайте ещё решения. Это и есть «несколько действий за месяц»."],
                ["6", "«Завершить месяц»", "Восстановит инициативу, начислит доход в казну, спишет содержание программ, покажет реакцию противников и союзников. Месяц сменится."],
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

// Союзники России (ОДКБ без Армении + Северная Корея)
const RUSSIA_ALLIES = new Set(["Беларусь", "Казахстан", "Кыргызстан", "Таджикистан", "Северная Корея"]);

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
  "Kyrgyzstan": "Кыргызстан", "Tajikistan": "Таджикистан",
  "Syria": "Сирия", "Iraq": "Ирак", "Pakistan": "Пакистан",
  "Afghanistan": "Афганистан", "Libya": "Ливия", "Egypt": "Египет",
  "Ethiopia": "Эфиопия", "Nigeria": "Нигерия", "South Africa": "ЮАР",
  "Venezuela": "Венесуэла", "Cuba": "Куба", "Argentina": "Аргентина",
  "Mexico": "Мексика", "Canada": "Канада", "Australia": "Австралия",
  "Indonesia": "Индонезия", "Vietnam": "Вьетнам", "Thailand": "Таиланд",
  "Mongolia": "Монголия", "Myanmar": "Мьянма", "Malaysia": "Малайзия",
  "Philippines": "Филиппины", "Bangladesh": "Бангладеш", "Sri Lanka": "Шри-Ланка",
  "Nepal": "Непал", "Spain": "Испания", "Italy": "Италия",
  "Netherlands": "Нидерланды", "Belgium": "Бельгия", "Switzerland": "Швейцария",
  "Austria": "Австрия", "Czech Republic": "Чехия", "Slovakia": "Словакия",
  "Greece": "Греция", "Portugal": "Португалия", "Denmark": "Дания",
  "Bulgaria": "Болгария", "Croatia": "Хорватия", "Lithuania": "Литва",
  "Latvia": "Латвия", "Estonia": "Эстония", "Moldova": "Молдова",
  "Algeria": "Алжир", "Morocco": "Марокко", "Tunisia": "Тунис",
  "Sudan": "Судан", "Somalia": "Сомали", "Kenya": "Кения",
  "Tanzania": "Танзания", "Mozambique": "Мозамбик", "Angola": "Ангола",
  "Cameroon": "Камерун", "Ghana": "Гана", "Côte d'Ivoire": "Кот-д'Ивуар",
  "Mali": "Мали", "Niger": "Нигер", "Chad": "Чад",
  "Democratic Republic of the Congo": "ДР Конго", "Congo": "Конго",
  "Central African Republic": "ЦАР", "Burkina Faso": "Буркина-Фасо",
  "Senegal": "Сенегал", "Guinea": "Гвинея", "Zimbabwe": "Зимбабве",
  "Zambia": "Замбия", "Madagascar": "Мадагаскар", "Botswana": "Ботсвана",
  "Namibia": "Намибия", "South Sudan": "Южный Судан", "Uganda": "Уганда",
  "Jordan": "Иордания", "Lebanon": "Ливан", "Yemen": "Йемен",
  "Oman": "Оман", "Kuwait": "Кувейт", "Qatar": "Катар",
  "United Arab Emirates": "ОАЭ", "Bahrain": "Бахрейн",
  "Colombia": "Колумбия", "Peru": "Перу", "Chile": "Чили",
  "Bolivia": "Боливия", "Ecuador": "Эквадор", "Paraguay": "Парагвай",
  "Uruguay": "Уругвай", "New Zealand": "Новая Зеландия",
  "Papua New Guinea": "Папуа Новая Гвинея",
};

// Статичная база данных по странам
const COUNTRY_INFO = {
  "Россия": { capital: "Москва", gov: "Президентская федерация", flag: "🇷🇺", desc: "Крупнейшая страна мира. Постоянный член СБ ООН, ядерная держава. С 2022 г. ведёт военную операцию на Украине, находится под масштабными западными санкциями." },
  "США": { capital: "Вашингтон", gov: "Президентская республика", flag: "🇺🇸", desc: "Единственная сверхдержава. Доминирует в НАТО, контролирует мировые финансы через доллар. Крупнейшая экономика и военный бюджет мира." },
  "Китай": { capital: "Пекин", gov: "Однопартийная республика", flag: "🇨🇳", desc: "Вторая экономика мира, стремительно наращивает военную мощь. Конкурирует с США за мировое лидерство, претендует на Тайвань." },
  "Германия": { capital: "Берлин", gov: "Федеративная республика", flag: "🇩🇪", desc: "Локомотив ЕС. Крупнейший экономический партнёр России в Европе до 2022 г., теперь лидирует в санкционной политике и военной поддержке Украины." },
  "Франция": { capital: "Париж", gov: "Президентская республика", flag: "🇫🇷", desc: "Ядерная держава, постоянный член СБ ООН. Активно продвигает европейскую стратегическую автономию, поддерживает Украину." },
  "Великобритания": { capital: "Лондон", gov: "Конституционная монархия", flag: "🇬🇧", desc: "Постоянный член СБ ООН, ядерная держава. Один из главных поставщиков оружия Украине, лидирует в санкционном давлении на Россию." },
  "Украина": { capital: "Киев", gov: "Президентская республика", flag: "🇺🇦", desc: "В состоянии вооружённого конфликта с Россией с февраля 2022 г. Получает масштабную военную и финансовую помощь Запада." },
  "Беларусь": { capital: "Минск", gov: "Президентская республика", flag: "🇧🇾", desc: "Ближайший союзник России. Предоставила территорию для наступления в феврале 2022 г., находится под западными санкциями." },
  "Польша": { capital: "Варшава", gov: "Парламентская республика", flag: "🇵🇱", desc: "Крупнейший сухопутный плацдарм НАТО на восточном фланге. Один из главных поставщиков помощи Украине." },
  "Турция": { capital: "Анкара", gov: "Президентская республика", flag: "🇹🇷", desc: "Многовекторный игрок. Член НАТО, но сохраняет отношения с Россией, выступает посредником в переговорах." },
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
  "Кыргызстан": { capital: "Бишкек", gov: "Президентская республика", flag: "🇰🇬", desc: "Член ОДКБ и союзник России. Беднейшая страна Центральной Азии, сильно зависит от российских переводов мигрантов. Принимает российские военные базы." },
  "Таджикистан": { capital: "Душанбе", gov: "Президентская республика", flag: "🇹🇯", desc: "Член ОДКБ, на территории страны размещена крупнейшая российская военная база за рубежом. Граничит с Афганистаном, служит буфером против нестабильности." },
  "Грузия": { capital: "Тбилиси", gov: "Парламентская республика", flag: "🇬🇪", desc: "Бывшая советская республика. После войны 2008 г. Россия признала Абхазию и Южную Осетию. В 2024 г. правительство отложило курс на ЕС, что вызвало массовые протесты." },
  "Норвегия": { capital: "Осло", gov: "Конституционная монархия", flag: "🇳🇴", desc: "Член НАТО, граничит с Россией на севере. Крупнейший экспортёр газа в Европу, заменивший российские поставки." },
  "Румыния": { capital: "Бухарест", gov: "Парламентская республика", flag: "🇷🇴", desc: "Член НАТО, граничит с Украиной. Принимает значительные силы альянса на восточном фланге, размещает американские противоракетные системы." },
  "Сербия": { capital: "Белград", gov: "Парламентская республика", flag: "🇷🇸", desc: "Исторически близка к России. Единственная страна Европы, не присоединившаяся к санкциям, при этом официально стремится в ЕС." },
  "Венгрия": { capital: "Будапешт", gov: "Парламентская республика", flag: "🇭🇺", desc: "Член ЕС и НАТО, но проводит пророссийский курс. Блокировала ряд решений ЕС по санкциям и помощи Украине." },
  "Афганистан": { capital: "Кабул", gov: "Исламский эмират (Талибан)", flag: "🇦🇫", desc: "После вывода войск США в 2021 г. власть перешла к Талибану. Россия установила рабочие контакты с новым режимом." },
  "Ливия": { capital: "Триполи", gov: "Расколотое государство", flag: "🇱🇾", desc: "Страна разделена между западным правительством и восточными силами. Россия поддерживает восточную коалицию через ЧВК." },
  "Эфиопия": { capital: "Аддис-Абеба", gov: "Федеративная республика", flag: "🇪🇹", desc: "Крупнейшая страна Африканского Рога. Преодолевает последствия гражданской войны 2020–2022 гг., наращивает сотрудничество с Китаем и Россией." },
  "Нигерия": { capital: "Абуджа", gov: "Президентская федерация", flag: "🇳🇬", desc: "Крупнейшая экономика Африки и самая населённая страна континента. Борется с исламским экстремизмом на севере и сепаратизмом на юге." },
  "ЮАР": { capital: "Претория", gov: "Президентская республика", flag: "🇿🇦", desc: "Лидирующая экономика Африки. Воздержалась при голосовании ООН по Украине, проводит активную политику в БРИКС." },
  "Аргентина": { capital: "Буэнос-Айрес", gov: "Президентская республика", flag: "🇦🇷", desc: "Крупнейшая испаноязычная страна. В 2023 г. к власти пришёл радикальный либертарианец Милей, кардинально изменивший внешнеполитический курс." },
  "Мексика": { capital: "Мехико", gov: "Президентская федерация", flag: "🇲🇽", desc: "Вторая экономика Латинской Америки. Торговый партнёр США №1, придерживается нейтралитета по Украине." },
  "Вьетнам": { capital: "Ханой", gov: "Однопартийная республика", flag: "🇻🇳", desc: "Крупный покупатель российского оружия и нефти. Балансирует между США, Китаем и Россией, стремительно развивает экономику." },
  "Таиланд": { capital: "Бангкок", gov: "Конституционная монархия", flag: "🇹🇭", desc: "Страна АСЕАН. Придерживается нейтралитета, сохраняет деловые отношения с Россией, туристический хаб для россиян." },
  "Мьянма": { capital: "Нейпьидо", gov: "Военная хунта", flag: "🇲🇲", desc: "После военного переворота 2021 г. страна охвачена гражданской войной. Россия — главный поставщик оружия хунте, заблокировала санкции ООН." },
  "Малайзия": { capital: "Куала-Лумпур", gov: "Конституционная монархия", flag: "🇲🇾", desc: "Развивающаяся экономика ЮВА. Придерживается нейтралитета, наращивает торговлю с Китаем и Россией." },
  "Филиппины": { capital: "Манила", gov: "Президентская республика", flag: "🇵🇭", desc: "Союзник США. При президенте Маркосе-мл. восстановил тесные отношения с Вашингтоном на фоне территориального конфликта с Китаем в Южно-Китайском море." },
  "Бангладеш": { capital: "Дакка", gov: "Парламентская республика", flag: "🇧🇩", desc: "Одна из самых густонаселённых стран мира. В 2024 г. массовые протесты свергли премьера Хасину, страна переходит к демократии при временном правительстве." },
  "Шри-Ланка": { capital: "Коломбо", gov: "Президентская республика", flag: "🇱🇰", desc: "В 2022 г. пережила тяжелейший экономический кризис. Балансирует между Китаем и Индией, получает кредиты МВФ для восстановления." },
  "Непал": { capital: "Катманду", gov: "Федеративная республика", flag: "🇳🇵", desc: "Горная страна между Индией и Китаем. Традиционно ориентирована на Индию, но наращивает связи с Китаем по инициативе Пояса и Пути." },
  "Испания": { capital: "Мадрид", gov: "Конституционная монархия", flag: "🇪🇸", desc: "Четвёртая экономика еврозоны. Поддерживает Украину, принимает значительную украинскую диаспору. Член НАТО и ЕС." },
  "Италия": { capital: "Рим", gov: "Парламентская республика", flag: "🇮🇹", desc: "Третья экономика ЕС. Была крупнейшим европейским потребителем российского газа. Поддерживает Украину, несмотря на исторически тесные деловые связи с Россией." },
  "Нидерланды": { capital: "Амстердам", gov: "Конституционная монархия", flag: "🇳🇱", desc: "Транспортный и финансовый хаб ЕС. Потеряли 298 граждан в катастрофе MH17 в 2014 г. — активно поддерживают международные расследования." },
  "Бельгия": { capital: "Брюссель", gov: "Конституционная монархия", flag: "🇧🇪", desc: "Штаб-квартира НАТО и ключевых институтов ЕС находится в Брюсселе. Активно участвует в координации западной поддержки Украины." },
  "Швейцария": { capital: "Берн", gov: "Федеративная республика", flag: "🇨🇭", desc: "Исторически нейтральная страна. Впервые с 1939 г. присоединилась к западным санкциям против России, что вызвало острые споры о нейтралитете." },
  "Австрия": { capital: "Вена", gov: "Федеративная республика", flag: "🇦🇹", desc: "Нейтральная страна, не член НАТО. Вена традиционно использовалась для российско-западных переговоров. Сильно зависела от российского газа." },
  "Чехия": { capital: "Прага", gov: "Парламентская республика", flag: "🇨🇿", desc: "Активный сторонник Украины, один из крупнейших поставщиков оружия в пересчёте на ВВП. Инициировала закупку артиллерийских снарядов для Украины по всему миру." },
  "Словакия": { capital: "Братислава", gov: "Парламентская республика", flag: "🇸🇰", desc: "После прихода к власти Фицо в 2023 г. заблокировала военную помощь Украине. Транзитная страна для российского газа в Европу." },
  "Греция": { capital: "Афины", gov: "Парламентская республика", flag: "🇬🇷", desc: "Член НАТО с 1952 г. Традиционно имела тесные культурные связи с Россией (православие). Поддерживает Украину, но осторожнее других по вопросам санкций." },
  "Португалия": { capital: "Лиссабон", gov: "Президентская республика", flag: "🇵🇹", desc: "Атлантический форпост НАТО. Активно поддерживает Украину, принимает украинских беженцев. Исторически тесные связи с Бразилией и Анголой." },
  "Дания": { capital: "Копенгаген", gov: "Конституционная монархия", flag: "🇩🇰", desc: "Страна НАТО, граничит с Балтийским морем. Один из крупнейших доноров Украины в пересчёте на ВВП. Контролирует Гренландию — стратегически важный арктический регион." },
  "Болгария": { capital: "София", gov: "Парламентская республика", flag: "🇧🇬", desc: "Православная балканская страна, исторически близкая к России. Присоединилась к санкциям как член ЕС, но внутри страны сильны пророссийские настроения." },
  "Хорватия": { capital: "Загреб", gov: "Президентская республика", flag: "🇭🇷", desc: "Член ЕС и НАТО. Активно помогает Украине военной техникой, при этом президент Милановач занимает более сдержанную позицию." },
  "Литва": { capital: "Вильнюс", gov: "Парламентская республика", flag: "🇱🇹", desc: "Один из самых активных сторонников Украины среди малых стран. Первой ввела санкции против Беларуси, перекрыла транзит в Калининград." },
  "Латвия": { capital: "Рига", gov: "Парламентская республика", flag: "🇱🇻", desc: "Прибалтийская страна НАТО. Принимает крупный контингент НАТО. Активно выдворяет российских дипломатов и поддерживает Украину." },
  "Эстония": { capital: "Таллин", gov: "Парламентская республика", flag: "🇪🇪", desc: "Самая цифровая страна мира. Лидер по военной помощи Украине в % от ВВП. Граничит с Россией и активно наращивает оборонный потенциал." },
  "Молдова": { capital: "Кишинёв", gov: "Президентская республика", flag: "🇲🇩", desc: "Маленькая страна между Украиной и Румынией. На её территории находится пророссийское Приднестровье с российскими войсками. Курс на вступление в ЕС." },
  "Алжир": { capital: "Алжир", gov: "Президентская республика", flag: "🇩🇿", desc: "Крупнейший по площади африканской страны. Главный поставщик газа в Европу из Африки, активно замещает российские поставки. Исторически тесные связи с Россией." },
  "Марокко": { capital: "Рабат", gov: "Конституционная монархия", flag: "🇲🇦", desc: "Стабильная монархия на севере Африки. Углубляет отношения с США и Израилем (Абрахамские соглашения 2020 г.), крупный потребитель российского зерна." },
  "Тунис": { capital: "Тунис", gov: "Президентская республика", flag: "🇹🇳", desc: "Единственная арабская страна, где Арабская весна привела к демократии. После 2021 г. президент Саид концентрирует власть, откатывая демократические достижения." },
  "Судан": { capital: "Хартум", gov: "Военный переходный совет", flag: "🇸🇩", desc: "С апреля 2023 г. охвачен кровопролитной войной между армией и силами ЦПБ. Россия добивалась военно-морской базы на Красном море." },
  "Сомали": { capital: "Могадишо", gov: "Федеральная республика", flag: "🇸🇴", desc: "Слабое государство, борющееся с террористической группировкой Аш-Шабаб. Важен для контроля судоходных маршрутов вблизи Аденского залива." },
  "Кения": { capital: "Найроби", gov: "Президентская республика", flag: "🇰🇪", desc: "Крупнейшая экономика Восточной Африки. Региональный финансовый центр, активно противостоит терроризму совместно с западными партнёрами." },
  "Танзания": { capital: "Додома", gov: "Президентская республика", flag: "🇹🇿", desc: "Крупнейшая страна Восточной Африки по площади. Туристический магнит (Килиманджаро, Занзибар), придерживается нейтралитета в мировой политике." },
  "Мозамбик": { capital: "Мапуту", gov: "Президентская республика", flag: "🇲🇿", desc: "Богатая газом страна с нестабильностью на севере. Россия и вагнеровцы оказывали помощь в борьбе с джихадистами в провинции Кабу-Делгаду." },
  "Ангола": { capital: "Луанда", gov: "Президентская республика", flag: "🇦🇴", desc: "Крупный нефтеэкспортёр, бывшая советская союзница. Сегодня активно привлекает западные инвестиции, дистанцируясь от России." },
  "Камерун": { capital: "Яунде", gov: "Президентская республика", flag: "🇨🇲", desc: "Двуязычная страна (франц./англ.) с сепаратистским конфликтом в англоязычных регионах. Поддерживает отношения с Россией и Францией." },
  "Гана": { capital: "Аккра", gov: "Президентская республика", flag: "🇬🇭", desc: "Одна из наиболее стабильных демократий Африки. Традиционно прозападная, но принимает предложения о сотрудничестве от России и Китая." },
  "Кот-д'Ивуар": { capital: "Ямусукро", gov: "Президентская республика", flag: "🇨🇮", desc: "Крупнейшая экономика Западной Африки. Главный мировой экспортёр какао. Французский военный контингент сохраняется, несмотря на антифранцузские настроения в регионе." },
  "Мали": { capital: "Бамако", gov: "Военная хунта", flag: "🇲🇱", desc: "После переворота 2021 г. выгнала французские войска и пригласила бойцов Вагнера (ныне «Африканский корпус»). Разрывает связи с Западом в пользу России." },
  "Нигер": { capital: "Ниамей", gov: "Военная хунта", flag: "🇳🇪", desc: "После переворота 2023 г. выслала французских и американских военных. Вместе с Мали и Буркина-Фасо образовала Альянс сахельских государств, ориентированный на Россию." },
  "Чад": { capital: "Нджамена", gov: "Переходный военный совет", flag: "🇹🇩", desc: "Ключевой партнёр Франции в Сахеле. После смерти Дебби в 2021 г. его сын укрепляет власть. Французские базы постепенно выводятся из региона." },
  "ДР Конго": { capital: "Киншаса", gov: "Президентская республика", flag: "🇨🇩", desc: "Огромные запасы полезных ископаемых (кобальт, колтан) при хроническом конфликте на востоке. Китай и Россия активно осваивают ресурсную базу страны." },
  "Конго": { capital: "Браззавиль", gov: "Президентская республика", flag: "🇨🇬", desc: "Нефтеэкспортёр с авторитарным режимом. Поддерживает тесные связи с Россией и Китаем, принимал Путина в 2023 г." },
  "ЦАР": { capital: "Банги", gov: "Президентская республика", flag: "🇨🇫", desc: "Одна из беднейших стран мира. Российские инструкторы и наёмники Вагнера вытеснили французских военных. Россия получает доступ к золоту и алмазам." },
  "Буркина-Фасо": { capital: "Уагадугу", gov: "Военная хунта", flag: "🇧🇫", desc: "После двух переворотов в 2022 г. разорвала связи с Францией, пригласила российских военных инструкторов. Джихадистский конфликт охватывает большую часть страны." },
  "Сенегал": { capital: "Дакар", gov: "Президентская республика", flag: "🇸🇳", desc: "Одна из наиболее стабильных демократий Западной Африки. Важный французский партнёр в Сахеле, но нарастают антизападные настроения." },
  "Гвинея": { capital: "Конакри", gov: "Военная хунта", flag: "🇬🇳", desc: "После переворота 2021 г. установились тесные отношения с Россией. Крупнейший мировой производитель бокситов (сырьё для алюминия)." },
  "Зимбабве": { capital: "Харарэ", gov: "Президентская республика", flag: "🇿🇼", desc: "Страна под западными санкциями с 2002 г. Исторически дружественна России и Китаю, которые являются главными инвесторами. Богата хромом и платиной." },
  "Замбия": { capital: "Лусака", gov: "Президентская республика", flag: "🇿🇲", desc: "Один из крупнейших производителей меди. Балансирует между западными кредиторами и Китаем, который является главным торговым партнёром." },
  "Мадагаскар": { capital: "Антананариву", gov: "Президентская республика", flag: "🇲🇬", desc: "Крупнейший островной государство Африки. Богат редкоземельными металлами и ванилью. Поддерживает прагматичные отношения со всеми мировыми центрами силы." },
  "Ботсвана": { capital: "Габороне", gov: "Президентская республика", flag: "🇧🇼", desc: "Образцовая африканская демократия. Крупнейший мировой производитель алмазов совместно с De Beers. Санкции против России затронули алмазный рынок." },
  "Намибия": { capital: "Виндхук", gov: "Президентская республика", flag: "🇳🇦", desc: "Молодая демократия, бывшая немецкая колония. Германия в 2021 г. признала геноцид народа гереро. Богата ураном и алмазами." },
  "Южный Судан": { capital: "Джуба", gov: "Президентская республика", flag: "🇸🇸", desc: "Самое молодое государство мира (2011). Хронически нестабильна, охвачена периодическими вспышками гражданской войны. Богата нефтью." },
  "Уганда": { capital: "Кампала", gov: "Президентская республика", flag: "🇺🇬", desc: "Авторитарный режим Мусевени у власти с 1986 г. Россия усилила военное сотрудничество. Принят закон о криминализации гомосексуальности, вызвавший западные санкции." },
  "Иордания": { capital: "Амман", gov: "Конституционная монархия", flag: "🇯🇴", desc: "Стабильная монархия в неспокойном регионе. Координирует ПВО с Израилем и Западом против иранских дронов. Принимает более 650 тыс. сирийских беженцев." },
  "Ливан": { capital: "Бейрут", gov: "Парламентская республика", flag: "🇱🇧", desc: "Государство на грани коллапса. Глубокий экономический кризис с 2019 г., взрыв в порту 2020 г., война с Израилем в 2024 г. нанесла тяжелейший удар по Хезболле." },
  "Йемен": { capital: "Сана", gov: "Расколотое государство", flag: "🇾🇪", desc: "Гражданская война с 2015 г. Хуситы, поддерживаемые Ираном, контролируют север и атакуют торговые суда в Красном море с 2023 г., угрожая мировой торговле." },
  "Оман": { capital: "Маскат", gov: "Абсолютная монархия", flag: "🇴🇲", desc: "Традиционно нейтральный посредник Персидского залива. Поддерживает дипломатические каналы со всеми сторонами, включая Иран и Израиль." },
  "Кувейт": { capital: "Эль-Кувейт", gov: "Конституционная монархия", flag: "🇰🇼", desc: "Небольшое нефтяное государство. Принимает американские военные базы. Помнит иракскую оккупацию 1990 г. и опирается на американские гарантии безопасности." },
  "Катар": { capital: "Доха", gov: "Абсолютная монархия", flag: "🇶🇦", desc: "Крупнейший мировой экспортёр СПГ. После кризиса 2022 г. поставляет газ в Европу. Принимает американскую базу CENTCOM и политических беженцев из разных стран." },
  "ОАЭ": { capital: "Абу-Даби", gov: "Федеральная монархия", flag: "🇦🇪", desc: "Финансовый хаб региона. Дубай стал крупнейшим центром для россиян, обходящих санкции. Балансирует между США и Китаем, поддерживает рабочие отношения с Россией." },
  "Бахрейн": { capital: "Манама", gov: "Конституционная монархия", flag: "🇧🇭", desc: "Небольшой островной архипелаг. Принимает штаб 5-го флота США — главный американский военно-морской центр в Персидском заливе." },
  "Колумбия": { capital: "Богота", gov: "Президентская республика", flag: "🇨🇴", desc: "Крупнейший поставщик кокаина в мире. После десятилетий вооружённого конфликта с ФАРК пытается достичь мира. Президент Петро проводит левый курс, критикуя США." },
  "Перу": { capital: "Лима", gov: "Президентская республика", flag: "🇵🇪", desc: "Хронически нестабильная политическая система — за последние 10 лет сменилось 8 президентов. Крупный производитель меди и серебра." },
  "Чили": { capital: "Сантьяго", gov: "Президентская республика", flag: "🇨🇱", desc: "Наиболее стабильная экономика Южной Америки. Контролирует крупнейшие в мире запасы меди и лития — ключевого элемента для аккумуляторов." },
  "Боливия": { capital: "Сукре", gov: "Президентская республика", flag: "🇧🇴", desc: "Второй по величине мировой резерв лития. Левое правительство поддерживает отношения с Россией и Китаем, национализировало литиевые ресурсы." },
  "Эквадор": { capital: "Кито", gov: "Президентская республика", flag: "🇪🇨", desc: "Небольшой нефтеэкспортёр. В 2024 г. потряс регион штурм мексиканского посольства. Борется с картельным насилием." },
  "Парагвай": { capital: "Асунсьон", gov: "Президентская республика", flag: "🇵🇾", desc: "Единственная страна Южной Америки, признающая Тайвань вместо КНР. Крупный экспортёр сои и электроэнергии (ГЭС Итайпу)." },
  "Уругвай": { capital: "Монтевидео", gov: "Президентская республика", flag: "🇺🇾", desc: "Наиболее либеральная и социально развитая страна Латинской Америки. Первой легализовала марихуану, ЛГБТ-браки, аборты. Стабильная демократия." },
  "Новая Зеландия": { capital: "Веллингтон", gov: "Конституционная монархия", flag: "🇳🇿", desc: "Союзник США и Австралии (AUKUS, Five Eyes). Активно поддерживает Украину. Изолированная тихоокеанская страна с развитой экономикой." },
  "Папуа Новая Гвинея": { capital: "Порт-Морсби", gov: "Конституционная монархия", flag: "🇵🇬", desc: "Богатая ресурсами страна Тихоокеанского региона. США усиливают военное присутствие на фоне конкуренции с Китаем за влияние в регионе." },
};

function GeoMap({ hotspots, activeHotspotIdx, onMarkerClick, onCountryClick, relations = [], scale = 110, actionMarkers = [], nuclearStrike = null }) {
  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  function getCountryFill(geoName) {
    const ruName = COUNTRY_NAME_MAP[geoName];
    if (!ruName) return "#1f2d3d";
    // Россия — особый цвет (страна игрока)
    if (ruName === "Россия") return "#1a3d28";
    // Союзники — ярко-зелёный
    if (RUSSIA_ALLIES.has(ruName)) return "#1d4a2e";
    const rel = relations.find(r => r.name === ruName || r.country === ruName);
    if (!rel) return "#1f2d3d";
    if (rel.value >= 60) return "#1a3a2a";
    if (rel.value >= 30) return "#1f2d3d";
    if (rel.value >= 0)  return "#2a2535";
    return "#3a1f1f";
  }

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <div style={{ position: "relative" }}>
        {nuclearStrike && (
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
            background: "radial-gradient(ellipse at 50% 50%, rgba(80,0,0,0.18) 0%, rgba(10,10,10,0.55) 100%)",
            mixBlendMode: "multiply",
          }} />
        )}
        <ComposableMap
          width={800}
          height={340}
          projectionConfig={{ scale, center: [20, 15] }}
          style={{ width: "100%", height: "auto", aspectRatio: "800/340", background: "transparent", display: "block", filter: nuclearStrike ? "grayscale(0.7) sepia(0.35) brightness(0.75)" : "none" }}
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
          {/* Маркеры действий игрока (#6) */}
          {actionMarkers.map((m, i) => {
            if (!m.coords) return null;
            const color = m.type === "military" ? "#e05060" : m.type === "intel" ? "#9c8347" : "#5b8c7a";
            const symbol = m.type === "military" ? "⚔" : m.type === "intel" ? "🕵" : "📜";
            return (
              <Marker key={"am" + i} coordinates={m.coords}>
                <circle r={8} fill={color} fillOpacity={0.85} stroke="#fff" strokeWidth={0.8} />
                <text textAnchor="middle" y={4} fontSize={8} fill="#fff">{symbol}</text>
              </Marker>
            );
          })}
          {/* Маркер ядерного удара */}
          {nuclearStrike?.coords && (
            <Marker coordinates={nuclearStrike.coords}>
              <circle r={18} fill="#ff2200" fillOpacity={0.12} />
              <circle r={12} fill="#ff4400" fillOpacity={0.22} />
              <circle r={7} fill="#ff6600" fillOpacity={0.7} stroke="#ff2200" strokeWidth={1.5} />
              <text textAnchor="middle" y={4} fontSize={9} fill="#fff">☢</text>
              {nuclearStrike.city && (
                <text textAnchor="middle" y={-10} fontSize={7} fill="#ff9966" fontWeight="bold">{nuclearStrike.city}</text>
              )}
            </Marker>
          )}
        </ComposableMap>
      </div>
    </div>
  );
}

// Fallback coords for regions without lat/lon (used until AI generates them)
const REGION_COORDS = {
  // Страны
  "украина": [31.2, 48.4], "ukraine": [31.2, 48.4],
  "россия": [60.0, 55.0], "russia": [60.0, 55.0],
  "китай": [104.0, 35.0], "china": [104.0, 35.0],
  "сша": [-98.0, 38.0], "usa": [-98.0, 38.0], "united states": [-98.0, 38.0],
  "германия": [10.0, 51.0], "germany": [10.0, 51.0],
  "франция": [2.3, 46.5], "france": [2.3, 46.5],
  "великобритан": [-2.0, 54.0], "britain": [-2.0, 54.0], "uk": [-2.0, 54.0],
  "польша": [20.0, 52.0], "poland": [20.0, 52.0],
  "беларусь": [28.0, 53.5], "belarus": [28.0, 53.5],
  "иран": [53.0, 32.0], "iran": [53.0, 32.0],
  "израиль": [34.8, 31.5], "israel": [34.8, 31.5],
  "тайвань": [121.0, 23.5], "taiwan": [121.0, 23.5],
  "сирия": [38.0, 35.0], "syria": [38.0, 35.0],
  "турция": [35.0, 39.0], "turkey": [35.0, 39.0],
  "япония": [138.0, 36.0], "japan": [138.0, 36.0],
  "индия": [78.0, 20.0], "india": [78.0, 20.0],
  "пакистан": [69.0, 30.0], "pakistan": [69.0, 30.0],
  "саудов": [45.0, 24.0], "saudi": [45.0, 24.0],
  "северная корея": [127.0, 40.0], "north korea": [127.0, 40.0],
  // Регионы Украины
  "донбасс": [37.8, 48.0], "донецк": [37.8, 48.0], "donetsk": [37.8, 48.0],
  "луганск": [39.3, 48.5], "lugansk": [39.3, 48.5],
  "запорожье": [35.1, 47.8], "zaporizhzhia": [35.1, 47.8],
  "херсон": [32.6, 46.6], "kherson": [32.6, 46.6],
  "харьков": [36.2, 49.9], "kharkiv": [36.2, 49.9],
  "одесса": [30.7, 46.5], "odessa": [30.7, 46.5],
  "киев": [30.5, 50.4], "kyiv": [30.5, 50.4],
  "крым": [34.1, 44.9], "crimea": [34.1, 44.9],
  // Крупные регионы
  "ближний восток": [45.0, 29.0], "middle east": [45.0, 29.0],
  "европа": [15.0, 50.0], "europe": [15.0, 50.0],
  "нато": [10.0, 52.0], "nato": [10.0, 52.0],
  "африка": [25.0, 5.0], "africa": [25.0, 5.0],
  "балтия": [24.0, 57.0], "балтийск": [24.0, 57.0], "baltic": [24.0, 57.0],
  "арктика": [30.0, 80.0], "arctic": [30.0, 80.0],
  "кавказ": [44.0, 42.0], "caucasus": [44.0, 42.0],
  "азия": [100.0, 35.0], "asia": [100.0, 35.0],
  "латинская": [-60.0, -15.0], "latin": [-60.0, -15.0],
  // Абстрактные темы — привязываем к логичной точке
  "энергетич": [55.0, 55.0],   // Россия (нефть/газ)
  "газ": [55.0, 55.0], "нефт": [50.0, 40.0], "oil": [50.0, 40.0],
  "ядерн": [37.8, 48.0],        // Донбасс / зона конфликта
  "атомн": [37.8, 48.0],
  "финанс": [2.3, 48.9],        // Париж
  "рынок": [2.3, 48.9],
  "ооh": [2.3, 48.9], "оон": [2.3, 48.9], "un ": [2.3, 48.9],
  "г7": [7.0, 47.0], "g7": [7.0, 47.0], "g20": [7.0, 47.0],
};

function resolveCoords(spot) {
  // Explicit lat/lon (skip placeholder 0,0)
  if (typeof spot.lat === "number" && typeof spot.lon === "number" && !(spot.lat === 0 && spot.lon === 0)) {
    return [spot.lon, spot.lat];
  }
  // Name-based lookup: check if region name contains any dict key
  const regionLower = (spot.region || "").toLowerCase();
  const entries = Object.entries(REGION_COORDS);
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i];
    if (regionLower.includes(k)) return v;
  }
  return null;
}

const LIVE_HEADLINES = [
  { src: "Reuters", text: "Экстренное заседание СБ ООН: ситуация на границе признана критической" },
  { src: "AP", text: "Министры G7 экстренно встретились на фоне эскалации конфликта" },
  { src: "Al Jazeera", text: "Беспилотники зафиксированы в 40 км от столицы — армия в режиме повышенной готовности" },
  { src: "Bloomberg", text: "Мировые рынки падают: инвесторы уходят в защитные активы после заявлений Пентагона" },
  { src: "DW", text: "Германия приостанавливает экспорт оружия в связи с нарастающей нестабильностью" },
  { src: "Euronews", text: "ЕС готовит новый пакет санкций — голосование запланировано на следующей неделе" },
  { src: "ТАСС", text: "МИД вызвал послов западных стран для объяснений по военным учениям" },
  { src: "CNN", text: "Спецслужбы США: перехвачены переговоры о переброске войск к северной границе" },
  { src: "France 24", text: "Переговоры зашли в тупик — делегация покинула зал без подписания соглашения" },
  { src: "BBC", text: "Нефть достигла двухлетнего максимума на фоне угрозы блокады Ормузского пролива" },
  { src: "Reuters", text: "Китай призвал к немедленному прекращению огня и готов выступить посредником" },
  { src: "Politico", text: "Конгресс США расколот: законопроект о военной помощи заблокирован оппозицией" },
  { src: "CGTN", text: "Пекин и Москва подписали декларацию о стратегическом партнёрстве в сфере безопасности" },
  { src: "AFP", text: "Гуманитарный коридор открыт — ООН координирует эвакуацию мирного населения" },
  { src: "Sky News", text: "Кибератака парализовала инфраструктуру трёх государств — следы ведут к APT-группировке" },
  { src: "NHK", text: "Токио готов пересмотреть оборонный бюджет в свете угроз региональной стабильности" },
  { src: "Al Arabiya", text: "Эр-Рияд отказал в транзите военных грузов — переговоры продолжаются" },
  { src: "WSJ", text: "Отключение от SWIFT: курс национальной валюты рухнул на 18% за сутки" },
  { src: "Axios", text: "Источники в Белом доме: президент подписал закрытый указ о введении особого режима" },
  { src: "Le Monde", text: "Франция предложила план мирного урегулирования — реакция сторон пока неизвестна" },
  { src: "Financial Times", text: "Иностранные инвестиции рухнули на 40%: бизнес покидает зону конфликта" },
  { src: "Spiegel", text: "Немецкие спецслужбы предупредили о подготовке диверсий на критической инфраструктуре" },
  { src: "Washington Post", text: "Внутренний раскол в администрации: советники президента не могут договориться о стратегии" },
  { src: "Nikkei", text: "Токийская биржа обвалилась на 4% — инвесторы реагируют на геополитическую эскалацию" },
  { src: "Bloomberg", text: "Золото пробило исторический максимум: $3200 за унцию на фоне паники" },
  { src: "The Times", text: "MI6 предупреждает: вероятность прямого столкновения выросла до 60%" },
  { src: "Reuters", text: "Разведка: противник завершил переброску тяжёлой техники на восточный фланг" },
  { src: "BBC", text: "Три посольства эвакуированы после угроз — дипломаты возвращаются на родину" },
  { src: "AP", text: "НАТО провело экстренный саммит — союзники усиливают восточный фланг альянса" },
  { src: "AFP", text: "Число беженцев превысило два миллиона — ООН объявила гуманитарный кризис" },
  { src: "Al Jazeera", text: "Ракетный удар по военной базе — подробности уточняются, жертвы среди мирных не подтверждены" },
  { src: "CNN", text: "Пентагон подтвердил: в регион направлена дополнительная авианосная ударная группа" },
  { src: "ТАСС", text: "Россия испытала новую систему перехвата — технические подробности засекречены" },
  { src: "DW", text: "ВВП региона сжался на 6% за квартал из-за санкций и военной нестабильности" },
  { src: "Kyodo", text: "Япония вводит ограничения на экспорт полупроводников по соображениям безопасности" },
  { src: "Hürriyet", text: "Анкара выступила посредником — турецкие дипломаты встретились с обеими сторонами" },
  { src: "Xinhua", text: "КНР призывает к немедленному прекращению огня и готова выступить гарантом мира" },
  { src: "Yonhap", text: "Сеул зафиксировал аномальную активность у демилитаризованной зоны — силы в готовности" },
  { src: "Sky News", text: "Спутниковые снимки подтверждают: колонна техники движется к границе" },
  { src: "Der Spiegel", text: "Европейские спецслужбы совместно расследуют разветвлённую шпионскую сеть" },
  { src: "RFI", text: "Африканский союз обеспокоен ростом иностранного военного присутствия на континенте" },
  { src: "Reuters", text: "Биткоин вырос на 12% — криптовалюта стала убежищем от геополитических рисков" },
  { src: "BBC", text: "Новые санкции: заморожены активы на сумму свыше $200 млрд в западных банках" },
  { src: "Kommersant", text: "Закрытый доклад: потери ОПК от санкций составили $47 млрд за год" },
  { src: "AP", text: "Экологическая катастрофа в зоне конфликта: нефтяное пятно движется к побережью" },
  { src: "Axios", text: "Утечка секретных документов: АНБ следило за переговорами союзников без их ведома" },
  { src: "AFP", text: "Международный суд ООН рассматривает иск о нарушении норм международного права" },
  { src: "Corriere", text: "Италия высылает трёх дипломатов — обвинения в шпионаже и вербовке чиновников" },
  { src: "Bloomberg", text: "Центробанки G20 скоординировали действия для стабилизации финансовых рынков" },
  { src: "ANSA", text: "Рим предложил нейтральную площадку для переговоров — приглашения разосланы сторонам" },
];

function NewsLiveFeed({ state }) {
  // Берём реальные новости из state.newsfeed, дополняем статичными если мало
  const headlines = useMemo(() => {
    const fromGame = (state?.newsfeed || [])
      .filter(n => n.text && n.source)
      .map(n => ({ src: n.source, text: n.text }))
      .reverse(); // последние первыми
    const combined = [...fromGame, ...LIVE_HEADLINES];
    return combined.slice(0, 20);
  }, [state?.turn]); // обновляем при смене хода

  const [visibleIdx, setVisibleIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    setVisibleIdx(0); // сброс при смене хода
  }, [headlines]);

  useEffect(() => {
    if (headlines.length === 0) return;
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setVisibleIdx(i => (i + 1) % headlines.length);
        setFade(true);
      }, 400);
    }, 4500);
    return () => clearInterval(interval);
  }, [headlines]);

  if (headlines.length === 0) return null;
  const item = headlines[visibleIdx];
  const next = headlines[(visibleIdx + 1) % headlines.length];
  const prev = headlines[(visibleIdx - 1 + headlines.length) % headlines.length];

  return (
    <div style={{ marginBottom: 14, background: "#f0ebe0", border: "1px solid #c8c2af", borderRadius: 4, overflow: "hidden" }}>
      {/* Шапка ленты */}
      <div style={{ background: "#a8313a", padding: "4px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6060", display: "inline-block", animation: "pulse-red 1s infinite" }} />
        <span className="mono-font" style={{ fontSize: 9, color: "#fff", letterSpacing: "0.14em", fontWeight: 700 }}>LIVE · МИРОВЫЕ НОВОСТИ</span>
        <style>{`@keyframes pulse-red { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      </div>

      {/* Главная новость */}
      <div style={{ padding: "10px 12px 8px", minHeight: 64, transition: "opacity 0.4s", opacity: fade ? 1 : 0 }}>
        <div className="mono-font" style={{ fontSize: 8, color: "#a8313a", letterSpacing: "0.1em", marginBottom: 4 }}>{item.src.toUpperCase()}</div>
        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.5, color: "#1e1c18", fontWeight: 700 }}>{item.text}</div>
      </div>

      {/* Бегущая строка */}
      <div style={{ background: "#1e1c18", padding: "5px 0", overflow: "hidden", position: "relative" }}>
        <div style={{
          display: "flex", gap: 0,
          animation: "ticker 18s linear infinite",
          whiteSpace: "nowrap",
        }}>
          {[...headlines, ...headlines].map((h, i) => (
            <span key={i} className="mono-font" style={{ fontSize: 9, color: "#9c8347", paddingRight: 40 }}>
              <span style={{ color: "#a8313a", marginRight: 6 }}>{h.src}</span>{h.text}
            </span>
          ))}
        </div>
        <style>{`@keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
      </div>

      {/* Следующие заголовки */}
      <div style={{ borderTop: "1px solid #d8d2bf" }}>
        {[next, prev].map((h, i) => (
          <div key={i} style={{ padding: "5px 12px", borderBottom: i === 0 ? "1px solid #e8e2cf" : "none", display: "flex", gap: 8, alignItems: "baseline" }}>
            <span className="mono-font" style={{ fontSize: 8, color: "#8c6b3a", flexShrink: 0 }}>{h.src}</span>
            <span className="doc-font" style={{ fontSize: 11.5, color: "#3a362e", lineHeight: 1.4 }}>{h.text.length > 90 ? h.text.slice(0, 90) + "…" : h.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsVideoPanel({ state }) { return <NewsLiveFeed state={state} />; }

function OverviewTab({ state }) {
  const [modal, setModal] = useState(null);
  const hotspots = state.overview?.hotspots ?? [];

  return (
    <div>
      {modal && (
        <Modal title={modal.region.toUpperCase() + " · ПОДРОБНЕЕ"} onClose={() => setModal(null)}>
          <div className="mono-font" style={{ fontSize: 10, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 10 }}>
            ХОД {state.turn}
          </div>
          <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
            {modal.region}
          </div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.65, color: "#3a362e" }}>
            {modal.text}
          </div>
        </Modal>
      )}

      <NewsVideoPanel state={state} />

      <div style={{ borderLeft: "3px solid #a8313a", paddingLeft: 12, marginBottom: 14 }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a8313a", marginBottom: 4 }}>
          ГЛАВНОЕ СЕЙЧАС · ХОД {state.turn}
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

const CITY_COORDS = {
  "киев": [30.52, 50.45], "київ": [30.52, 50.45], "kyiv": [30.52, 50.45],
  "москва": [37.62, 55.75], "moscow": [37.62, 55.75],
  "вашингтон": [-77.04, 38.89], "washington": [-77.04, 38.89],
  "лондон": [-0.12, 51.5], "london": [-0.12, 51.5],
  "берлин": [13.4, 52.52], "berlin": [13.4, 52.52],
  "париж": [2.35, 48.85], "paris": [2.35, 48.85],
  "пекин": [116.4, 39.9], "beijing": [116.4, 39.9],
  "токио": [139.7, 35.7], "tokyo": [139.7, 35.7],
  "сеул": [126.98, 37.57], "seoul": [126.98, 37.57],
  "тегеран": [51.42, 35.7], "tehran": [51.42, 35.7],
  "тель-авив": [34.78, 32.08], "tel aviv": [34.78, 32.08],
  "варшава": [21.01, 52.23], "warsaw": [21.01, 52.23],
  "анкара": [32.87, 39.93], "ankara": [32.87, 39.93],
  "нью-йорк": [-74.0, 40.71], "new york": [-74.0, 40.71],
  "лос-анджелес": [-118.24, 34.05], "los angeles": [-118.24, 34.05],
  "харьков": [36.23, 49.99], "одесса": [30.73, 46.48],
  "минск": [27.56, 53.9], "вильнюс": [25.28, 54.69],
  "рига": [24.11, 56.95], "таллин": [24.75, 59.44],
  "прага": [14.42, 50.07],
  "бухарест": [26.1, 44.43], "софия": [23.32, 42.7],
  "белград": [20.46, 44.8], "братислава": [17.11, 48.15],
  "стокгольм": [18.07, 59.33], "хельсинки": [24.94, 60.17],
  "осло": [10.75, 59.91], "копенгаген": [12.57, 55.68],
  "рим": [12.5, 41.9], "мадрид": [-3.7, 40.42], "лиссабон": [-9.14, 38.72],
  "амстердам": [4.9, 52.37], "брюссель": [4.35, 50.85],
  "дамаск": [36.29, 33.51], "багдад": [44.36, 33.33],
  "кабул": [69.18, 34.52], "исламабад": [73.05, 33.72],
  "дели": [77.2, 28.6], "мумбаи": [72.88, 19.07],
  "пхеньян": [125.75, 39.02], "pyongyang": [125.75, 39.02],
  "taipei": [121.56, 25.04], "тайбэй": [121.56, 25.04],
};

function detectNuclearStrike(state) {
  const hasNuclear = (state.newsfeed || []).some(n => n.type === "nuclear_reaction");
  if (!hasNuclear) return null;
  // Ищем город-цель в нарративе хода с ядерным ударом
  const logEntries = (state.log || []).filter(e => e.body);
  for (const entry of [...logEntries].reverse()) {
    const text = (entry.body || "").toLowerCase();
    if (!text.includes("ядерн") && !text.includes("nuclear") && !text.includes("термоядер")) continue;
    for (const [city, coords] of Object.entries(CITY_COORDS)) {
      if (text.includes(city)) return { coords, city: city.charAt(0).toUpperCase() + city.slice(1) };
    }
    return { coords: null, city: null };
  }
  return { coords: null, city: null };
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 600);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

function MapTab({ state }) {
  const [activeHotspotIdx, setActiveHotspotIdx] = useState(null);
  const [hotspotModal, setHotspotModal] = useState(null);
  const [countryModal, setCountryModal] = useState(null);
  const rawHotspots = state.overview?.hotspots ?? [];
  // Обогащаем hotspots координатами если их нет
  const hotspots = rawHotspots.map(h => {
    if (typeof h.lat === "number" && typeof h.lon === "number" && !(h.lat === 0 && h.lon === 0)) return h;
    const regionLower = (h.region || "").toLowerCase();
    for (const [k, coords] of Object.entries(REGION_COORDS)) {
      if (regionLower.includes(k)) {
        // REGION_COORDS хранит [lon, lat], нам нужен {lat, lon}
        return { ...h, lon: coords[0], lat: coords[1] };
      }
    }
    return h;
  });
  const relations = state.relations ?? [];
  const nuclearStrike = useMemo(() => detectNuclearStrike(state), [state.newsfeed, state.log]);
  const isMobile = useIsMobile();

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
        КАРТА МИРА · ХОД {state.turn}
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: "flex-start" }}>
        {/* Карта */}
        <div style={{ flex: "1 1 0", width: "100%", minWidth: 0, background: nuclearStrike ? "#0a0a0a" : "#0d1420", borderRadius: 6, position: "relative" }}>
          {nuclearStrike && (
            <div className="mono-font" style={{ padding: "4px 8px", background: "#2a0a0a", color: "#ff4444", fontSize: 9, letterSpacing: "0.1em", borderBottom: "1px solid #5a1a1a" }}>
              ☢ ЯДЕРНЫЙ УДАР НАНЕСЁН{nuclearStrike.city ? ` · ЦЕЛЬ: ${nuclearStrike.city.toUpperCase()}` : ""} · РАДИАЦИОННОЕ ЗАРАЖЕНИЕ
            </div>
          )}
          <GeoMap
            hotspots={hotspots}
            activeHotspotIdx={activeHotspotIdx}
            onMarkerClick={handleMarkerClick}
            onCountryClick={handleCountryClick}
            relations={relations}
            scale={isMobile ? 130 : 110}
            nuclearStrike={nuclearStrike}
          />
          <div className="mono-font" style={{ position: "absolute", bottom: 5, left: 8, fontSize: 8, color: "#2a3a4d" }}>
            клик по стране или маркеру
          </div>
        </div>

        {/* Боковая панель */}
        <div style={{ width: isMobile ? "100%" : 140, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>

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

// Субметрики по каждому основному стату
const SUBSTAT_META = {
  economy: [
    { key: "gdp_growth",  label: "Рост ВВП",    color: "#3a8a7a", desc: "0,6–1% г/г — пик перегрева прошёл, темп замедлился. Ставка ЦБ 18,5% давит кредитование." },
    { key: "inflation",   label: "Инфляция",    color: "#c06050", desc: "8,2% г/г — ЦБ удерживает высокую ставку. Рост цен бьёт по реальным доходам.", inverted: true },
    { key: "employment",  label: "Занятость",   color: "#4a7a5c", desc: "Рынок труда перегрет: мобилизация и ВПК вытянули рабочих, безработица рекордно низкая." },
    { key: "reserves",    label: "Резервы",     color: "#9c8347", desc: "ФНБ расходуется на покрытие дефицита. $300 млрд заморожены Западом, доступны только около $290 млрд." },
  ],
  military: [
    { key: "army_morale", label: "Боевой дух",  color: "#c04040", desc: "Четвёртый год СВО — накапливается усталость, но мобилизационный патриотизм держит." },
    { key: "equipment",   label: "Техника",     color: "#8c5a3a", desc: "ВПК на полной мощности: 1500 ед. бронетехники в год, 12 млн снарядов. Потери компенсируются." },
    { key: "readiness",   label: "Боеготовность", color: "#a84020", desc: "Армия в постоянном боевом контакте — высокая тактическая готовность, сказывается износ." },
    { key: "veterans",    label: "Опыт войск",  color: "#7a3030", desc: "Два года активных боёв дали огромный боевой опыт — крупнейший в Европе со времён ВОВ." },
  ],
  diplomacy: [
    { key: "ally_trust",  label: "Доверие союзников", color: "#5b6b8c", desc: "ОДКБ номинально, реально — Китай, КНДР, Беларусь. Ограниченный, но стабильный блок." },
    { key: "isolation",   label: "Изоляция",    color: "#8c5b5b", desc: "21-й пакет санкций ЕС готовится. Отрезаны от SWIFT, западных технологий и рынков.", inverted: true },
    { key: "soft_power",  label: "Мягкая сила", color: "#6b8c9c", desc: "RT заблокирован на Западе. Влияние в Африке и части Азии остаётся, но падает." },
    { key: "reputation",  label: "Репутация",   color: "#4a6b8c", desc: "Исторический минимум в западных странах. В БРИКС и Глобальном Юге — неоднозначно." },
  ],
  stability: [
    { key: "law_order",       label: "Правопорядок",     color: "#4a6b5c", desc: "Силовые структуры работают в штатном режиме. Публичных протестов нет с 2022 года." },
    { key: "social_tension",  label: "Соц. напряж.",     color: "#a85030", desc: "Усталость от ограничений растёт, но открытых волнений нет. ВЦИОМ: поддержка СВО 65%.", inverted: true },
    { key: "media_control",   label: "Контроль СМИ",     color: "#5c7a6b", desc: "Большинство независимых СМИ закрыты или за рубежом. Телевидение полностью под контролем." },
    { key: "regional_unity",  label: "Единство регионов",color: "#3a7a5c", desc: "Регионы лояльны. Чечня интегрирована. Новые территории — управляемая нестабильность." },
  ],
  approval: [
    { key: "elite_satisfaction", label: "Элиты",        color: "#8c6b3a", desc: "Силовики и госкорпорации в выигрыше от ВПК. Бизнес страдает от ставки ЦБ и санкций." },
    { key: "corruption",         label: "Коррупция",    color: "#a8313a", desc: "Военные контракты и параллельный импорт открыли новые схемы. Transparency: 137-е место.", inverted: true },
    { key: "middle_class",       label: "Средний класс",color: "#5b6b8c", desc: "Ипотека под 18%+, инфляция, утечка мозгов. Средний класс теряет позиции и уезжает." },
    { key: "lower_class_mood",   label: "Народ",        color: "#4a6b5c", desc: "Рост цен перекрывает надбавки участникам СВО. Деревня держится, города напряжены." },
  ],
};

// Спарклайн-график из SVG без библиотек
function Sparkline({ data, color, width = 120, height = 32 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={pts.split(" ").pop().split(",")[0]} cy={pts.split(" ").pop().split(",")[1]} r="3" fill={color} />
    </svg>
  );
}

function StatDetailModal({ statKey, state, gameId, onClose }) {
  const [history, setHistory] = useState(null);
  const [news, setNews] = useState(null);
  const meta = statMeta[statKey];

  const STAT_KEYWORDS = {
    economy:   null, // все новости — экономические события и так часто в ленте
    military:  null,
    stability: null,
    diplomacy: null,
    approval:  null,
  };

  useEffect(() => {
    fetchStatHistory(gameId).then(d => setHistory(d.history || []));
    // Показываем последние новости без фильтра — фильтр по ключевому слову слишком узкий
    fetchPolicyNews(gameId, null).then(d => setNews(d.items || []));
  }, [gameId, statKey]);

  const currentValue = state.stats[statKey] ?? 0;
  const historyValues = history ? history.map(h => h.stats_snapshot?.[statKey]).filter(v => v != null) : [];

  // Факторы влияния
  const FACTORS = {
    economy:  ["Экономические указы", "Санкции", "Торговые соглашения", "Военные расходы"],
    military: ["Военные операции", "Оборонные указы", "Разведка", "Союзники"],
    stability:["Репрессии", "Либерализация", "Военные конфликты", "Экономика"],
    diplomacy:["Дипломатические контакты", "Санкции", "Союзные договоры", "Конфронтация"],
    approval: ["Экономическое благополучие", "Военные успехи", "Репрессии", "Мир"],
  };

  const substats = (SUBSTAT_META[statKey] || []).map(sm => ({ ...sm, value: state.stats[sm.key] ?? 50 }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.85)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f5f1e6", borderRadius: 8, width: "min(95vw,520px)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div style={{ background: "#1a1f2c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: meta?.color }} />
            <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>{meta?.label?.toUpperCase()} · ДЕТАЛИ</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>
          {/* Текущее значение */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: meta?.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{currentValue}</div>
            <div>
              <div className="doc-font" style={{ fontSize: 15, fontWeight: 700 }}>{meta?.label}</div>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginTop: 2 }}>
                {currentValue >= 70 ? "ВЫСОКИЙ УРОВЕНЬ" : currentValue >= 40 ? "СРЕДНИЙ УРОВЕНЬ" : "НИЗКИЙ УРОВЕНЬ — ТРЕБУЕТ ВНИМАНИЯ"}
              </div>
            </div>
          </div>

          {/* График */}
          {historyValues.length >= 2 && (
            <div style={{ marginBottom: 18, background: "#ece7d8", borderRadius: 4, padding: "12px 14px" }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>ДИНАМИКА ПО ХОДАМ</div>
              <Sparkline data={historyValues} color={meta?.color} width={440} height={48} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>Ход {history[0]?.turn_n}</span>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>Сейчас</span>
              </div>
            </div>
          )}

          {/* Субметрики */}
          {substats.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 10 }}>ДЕТАЛЬНЫЕ ПОКАЗАТЕЛИ</div>
              <div style={{ display: "grid", gap: 10 }}>
                {substats.map(s => (
                  <div key={s.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <div>
                        <span className="doc-font" style={{ fontSize: 13, fontWeight: 700 }}>{s.label}</span>
                        <span className="doc-font" style={{ fontSize: 11, color: "#8a8472", marginLeft: 6 }}>{s.desc}</span>
                      </div>
                      <span className="mono-font" style={{ fontSize: 12, fontWeight: 700, color: s.inverted ? (s.value > 60 ? "#a8313a" : "#4a6b5c") : (s.value >= 60 ? "#4a6b5c" : s.value >= 40 ? "#9c8347" : "#a8313a") }}>{s.value}</span>
                    </div>
                    <Bar value={s.inverted ? 100 - s.value : s.value} color={s.inverted ? (s.value > 60 ? "#a8313a" : "#4a6b5c") : s.color} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Факторы влияния */}
          <div style={{ marginBottom: 18 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>ФАКТОРЫ ВЛИЯНИЯ</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(FACTORS[statKey] || []).map(f => (
                <span key={f} style={{ background: "#ece7d8", border: "1px solid #d8d2bf", borderRadius: 3, padding: "3px 8px", fontSize: 11, fontFamily: "'PT Serif',serif", color: "#5c5648" }}>{f}</span>
              ))}
            </div>
          </div>

          {/* Последние события */}
          <div>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>ПОСЛЕДНИЕ СОБЫТИЯ</div>
            {news === null && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472" }}>Загрузка…</div>}
            {news?.length === 0 && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", fontStyle: "italic" }}>Нет связанных событий.</div>}
            {news?.slice(0, 4).map((item, i) => (
              <div key={i} style={{ borderTop: "1px solid #d8d2bf", paddingTop: 8, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>ХОД {item.turn_n} · {item.source}</div>
                <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsTab({ state, gameId }) {
  const [openStat, setOpenStat] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [statHistory, setStatHistory] = useState(null);

  useEffect(() => {
    fetchStatHistory(gameId).then(d => setStatHistory(d.history || [])).catch(() => {});
  }, [gameId]);

  // Для каждого стата — последние 3 хода где он значимо изменился (|delta| >= 2)
  function getStatEvents(key) {
    if (!statHistory) return [];
    return statHistory
      .filter(h => {
        const d = h.stat_deltas?.[key];
        return typeof d === "number" && Math.abs(d) >= 2;
      })
      .slice(-4)
      .reverse()
      .map(h => ({
        turn: h.turn_n,
        delta: h.stat_deltas[key],
        actionType: h.action_type,
      }));
  }

  const ACTION_TYPE_LABEL = {
    military_offensive: "Наступление",
    military_defensive: "Оборона",
    diplomacy_outreach: "Дипломатия",
    diplomacy_confrontation: "Конфронтация",
    economic_stimulus: "Стимул эк-ки",
    economic_austerity: "Жёсткая экономия",
    domestic_repression: "Подавление",
    domestic_liberalization: "Либерализация",
    info_narrative: "Нарратив",
    intelligence_covert: "Разведка",
    peace_initiative: "Мирная инициатива",
    null_action: "Бездействие",
    nuclear_strike: "Ядерный удар",
  };

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        {Object.entries(state.stats).filter(([key]) => statMeta[key]).map(([key, value]) => {
          const meta = statMeta[key];
          const Icon = meta.icon;
          const substats = (SUBSTAT_META[key] || []).map(sm => ({ ...sm, value: state.stats[sm.key] ?? 50 }));
          const expanded = expandedKey === key;
          const events = getStatEvents(key);

          return (
            <div key={key} style={{ borderRadius: 6, background: "#f5f1e6", border: `1px solid ${expanded ? meta.color : "#d8d2bf"}`, transition: "border-color 0.15s", overflow: "hidden" }}>
              {/* Header — click to expand substats */}
              <div
                onClick={() => setExpandedKey(expanded ? null : key)}
                style={{ cursor: "pointer", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon size={15} color={meta.color} />
                  <span className="doc-font" style={{ fontSize: 14, fontWeight: 700 }}>{meta.label}</span>
                  {events.length > 0 && (
                    <span style={{ fontSize: 9, background: "#eee6d0", color: "#8a8472", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>
                      {events.length} событий
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono-font" style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{value}</span>
                  <span style={{ fontSize: 11, color: meta.color, transition: "transform 0.2s", display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                </div>
              </div>
              <div style={{ padding: "0 12px 10px" }}>
                <Bar value={value} color={meta.color} />
              </div>

              {/* Expanded: substats + events */}
              {expanded && (
                <div style={{ borderTop: "1px solid #e8e2d0", padding: "12px 12px 14px" }}>
                  {/* Substats */}
                  {substats.length > 0 && (
                    <>
                      <div className="mono-font" style={{ fontSize: 8, color: "#8a8472", letterSpacing: "0.08em", marginBottom: 8 }}>ДЕТАЛЬНЫЕ ПОКАЗАТЕЛИ</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: events.length > 0 ? 14 : 0 }}>
                        {substats.map(s => {
                          const displayVal = s.inverted ? 100 - s.value : s.value;
                          const clr = displayVal >= 60 ? "#4a6b5c" : displayVal >= 40 ? "#9c8347" : "#a8313a";
                          return (
                            <div key={s.key}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span className="doc-font" style={{ fontSize: 11, color: "#5c5648" }}>{s.label}</span>
                                <span className="mono-font" style={{ fontSize: 11, color: clr, fontWeight: 700 }}>{s.value}</span>
                              </div>
                              <div style={{ height: 4, background: "#d8d2bf", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ width: `${displayVal}%`, height: "100%", background: clr }} />
                              </div>
                              {s.desc && <div className="mono-font" style={{ fontSize: 8.5, color: "#a8a294", marginTop: 2, lineHeight: 1.3 }}>{s.desc}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Events affecting this stat */}
                  {events.length > 0 && (
                    <>
                      <div className="mono-font" style={{ fontSize: 8, color: "#8a8472", letterSpacing: "0.08em", marginBottom: 6 }}>СОБЫТИЯ</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {events.map((ev, i) => {
                          const positive = ev.delta > 0;
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: positive ? "#f0f5f0" : "#f5f0f0", borderRadius: 3, borderLeft: `3px solid ${positive ? "#4a6b5c" : "#a8313a"}` }}>
                              <span className="mono-font" style={{ fontSize: 10, fontWeight: 700, color: positive ? "#4a6b5c" : "#a8313a", minWidth: 28 }}>
                                {positive ? "+" : ""}{ev.delta}
                              </span>
                              <span className="doc-font" style={{ fontSize: 11, color: "#5c5648", flex: 1 }}>
                                {ACTION_TYPE_LABEL[ev.actionType] || ev.actionType}
                              </span>
                              <span className="mono-font" style={{ fontSize: 9, color: "#a8a294" }}>х.{ev.turn}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <button
                    onClick={e => { e.stopPropagation(); setOpenStat(key); }}
                    style={{ marginTop: 12, background: "none", border: `1px solid ${meta.color}`, borderRadius: 3, padding: "5px 12px", fontSize: 11, color: meta.color, cursor: "pointer", fontFamily: "'PT Serif',serif" }}
                  >
                    Подробный анализ →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {openStat && <StatDetailModal statKey={openStat} state={state} gameId={gameId} onClose={() => setOpenStat(null)} />}
    </>
  );
}

function PolicyDetailModal({ policy, gameId, currentTurn, onClose, onCancelled }) {
  const [news, setNews] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    fetchPolicyNews(gameId, policy.title).then(d => setNews(d.items || []));
  }, [gameId, policy.title]);

  const turnsLeft = policy.target_turn ? Math.max(0, policy.target_turn - currentTurn) : null;
  const totalDuration = policy.duration_turns || (policy.target_turn ? policy.target_turn - policy.turn : 5);
  const elapsed = currentTurn - policy.turn;
  const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
  const isCancelled = policy.status === "cancelled";

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelPolicy(gameId, policy.title);
      onCancelled?.();
      onClose();
    } catch { setCancelling(false); }
  }

  const statusColor = isCancelled ? "#8a8472" : policy.status === "completed" ? "#4a6b5c" : "#9c8347";
  const statusLabel = isCancelled ? "ОТМЕНЁН" : policy.status === "completed" ? "ВЫПОЛНЕН" : "АКТИВНО";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.85)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f5f1e6", borderRadius: 8, width: "min(95vw,520px)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div style={{ background: "#1a1f2c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: (POLICY_CATEGORY[policy.category]?.color) || "#9c8347" }}>
            {(POLICY_CATEGORY[policy.category]?.label) || "ПОЛИТИКА"} · ДЕТАЛИ
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>
          {/* Заголовок */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div className="doc-font" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, flex: 1, marginRight: 12 }}>{policy.title}</div>
            <span className="mono-font" style={{ fontSize: 8, padding: "3px 8px", borderRadius: 3, background: isCancelled ? "#d8d2bf" : "#dce5dc", color: statusColor, flexShrink: 0, letterSpacing: "0.06em" }}>{statusLabel}</span>
          </div>

          {/* Прогресс */}
          {!isCancelled && (
            <div style={{ background: "#ece7d8", borderRadius: 4, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>ПРОГРЕСС ИСПОЛНЕНИЯ</span>
                <span className="mono-font" style={{ fontSize: 9, color: "#5c5648", fontWeight: 700 }}>{progress}%</span>
              </div>
              <div style={{ height: 8, background: "#d8d2bf", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: progress >= 100 ? "#4a6b5c" : "#9c8347", transition: "width 0.4s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>Введён: Ход {policy.turn}</span>
                {turnsLeft !== null && (
                  <span className="mono-font" style={{ fontSize: 8, color: turnsLeft <= 1 ? "#a8313a" : "#5c5648", fontWeight: turnsLeft <= 1 ? 700 : 400 }}>
                    {turnsLeft === 0 ? "ЗАВЕРШАЕТСЯ" : `Осталось: ${turnsLeft} ход.`} (Ход {policy.target_turn})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Влияет на (при успехе) */}
          {policy.effect_stats && Object.keys(policy.effect_stats).length > 0 && (
            <div style={{ background: "#e3eadf", border: "1px solid #3a8a7a", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#2f6f5f", marginBottom: 5 }}>ПРИ УСПЕХЕ ВЫРАСТУТ</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px" }}>
                {boostStrings(policy.effect_stats).map((s, i) => (
                  <span key={i} className="doc-font" style={{ fontSize: 13, color: "#2f6f5f", fontWeight: 700 }}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Условие выполнения */}
          {policy.completion_conditions && (
            <div style={{ background: "#dce5dc", border: "1px solid #4a6b5c", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#4a6b5c", marginBottom: 3 }}>УСЛОВИЕ ВЫПОЛНЕНИЯ</div>
              <div className="doc-font" style={{ fontSize: 13 }}>{policy.completion_conditions}</div>
            </div>
          )}

          {/* Последствия отмены */}
          {!isCancelled && policy.cancel_penalty && Object.keys(policy.cancel_penalty).length > 0 && (
            <div style={{ background: "#f0e6e0", border: "1px solid #b07a5a", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#9a5a3a", marginBottom: 5 }}>ПОСЛЕДСТВИЯ ОТМЕНЫ</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px" }}>
                {penaltyEntries(policy.cancel_penalty).map((e, i) => (
                  <span key={i} className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: e.good ? "#2f6f5f" : "#a8313a" }}>
                    {e.label} {e.delta > 0 ? "+" : ""}{e.delta}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Пункты */}
          <div style={{ marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>СОДЕРЖАНИЕ</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(policy.items || []).map((item, i) => (
                <li key={i} className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 5 }}>{item}</li>
              ))}
            </ul>
          </div>

          {/* Новости */}
          <div style={{ marginBottom: 16 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>НОВОСТИ ПО УКАЗУ</div>
            {news === null && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472" }}>Загрузка…</div>}
            {news?.length === 0 && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", fontStyle: "italic" }}>Новостей пока нет.</div>}
            {news?.slice(0, 5).map((item, i) => (
              <div key={i} style={{ borderTop: "1px solid #d8d2bf", paddingTop: 8, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>ХОД {item.turn_n} · {item.source}</div>
                <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>{item.text}</div>
              </div>
            ))}
          </div>

          {/* Отмена */}
          {!isCancelled && policy.status !== "completed" && (
            !confirmCancel
              ? <button onClick={() => setConfirmCancel(true)} style={{ background: "none", border: "1px solid #a8313a", borderRadius: 4, padding: "7px 14px", color: "#a8313a", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>Отменить политику</button>
              : <div style={{ background: "#3a2424", border: "1px solid #a8313a", borderRadius: 4, padding: "12px 14px" }}>
                  <div className="doc-font" style={{ fontSize: 13, color: "#ece7d8", marginBottom: 10 }}>
                    {policy.cancel_penalty && Object.keys(policy.cancel_penalty).length > 0
                      ? <>Последствия отмены: {penaltyEntries(policy.cancel_penalty).map((e, i) => (
                          <span key={i} style={{ color: e.good ? "#a0c090" : "#e09090", fontWeight: 700 }}>{i > 0 ? ", " : ""}{e.label} {e.delta > 0 ? "+" : ""}{e.delta}</span>
                        ))}. Продолжить?</>
                      : "Отмена даст штраф: стабильность −2, рейтинг −1. Продолжить?"}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleCancel} disabled={cancelling} style={{ background: "#a8313a", color: "#fff", border: "none", borderRadius: 4, padding: "7px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>{cancelling ? "Отмена…" : "Да, отменить"}</button>
                    <button onClick={() => setConfirmCancel(false)} style={{ background: "none", border: "1px solid #5c5648", borderRadius: 4, padding: "7px 14px", color: "#5c5648", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>Нет</button>
                  </div>
                </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoliciesTab({ state, gameId, currentTurn, onStateRefresh }) {
  const [openPolicy, setOpenPolicy] = useState(null);

  if (!state.policies?.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>Активных политик пока нет.</div>;
  }

  const active = state.policies.filter(p => p.status !== "cancelled");
  const cancelled = state.policies.filter(p => p.status === "cancelled");

  const renderCard = (policy, i) => {
    const totalDuration = policy.duration_turns || (policy.target_turn ? policy.target_turn - policy.turn : 5);
    const elapsed = (currentTurn || 0) - policy.turn;
    const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
    const turnsLeft = policy.target_turn ? Math.max(0, policy.target_turn - (currentTurn || 0)) : null;
    const cat = POLICY_CATEGORY[policy.category];
    const boosts = boostStrings(policy.effect_stats);
    return (
      <div key={i} onClick={() => setOpenPolicy(policy)} style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4, padding: "13px 14px", cursor: "pointer", transition: "border-color 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
        onMouseLeave={e => e.currentTarget.style.borderColor = "#d8d2bf"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <span className="doc-font" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{policy.title}</span>
          {cat && <span className="mono-font" style={{ fontSize: 8, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 3, background: cat.color + "22", color: cat.color, flexShrink: 0, marginLeft: 8, whiteSpace: "nowrap" }}>{cat.label}</span>}
        </div>
        {boosts.length > 0 && (
          <div className="doc-font" style={{ fontSize: 11.5, color: "#2f6f5f", marginBottom: 7 }}>при успехе: {boosts.join(" · ")}</div>
        )}
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 5, background: "#d8d2bf", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: progress >= 100 ? "#4a6b5c" : "#9c8347", transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>Ход {policy.turn} → {policy.target_turn || "?"}</span>
            <span className="mono-font" style={{ fontSize: 8, color: turnsLeft !== null && turnsLeft <= 1 ? "#a8313a" : "#8a8472" }}>
              {turnsLeft !== null ? (turnsLeft === 0 ? "завершается" : `ост. ${turnsLeft} х.`) : `${progress}%`}
            </span>
          </div>
        </div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {(policy.items || []).slice(0, 2).map((item, j) => (
            <li key={j} className="doc-font" style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 3, color: "#5c5648" }}>{item}</li>
          ))}
          {(policy.items || []).length > 2 && <li className="mono-font" style={{ fontSize: 9, color: "#8a8472", listStyle: "none" }}>…ещё {policy.items.length - 2}</li>}
        </ul>
      </div>
    );
  };

  // Группировка активных по типу: программы → реформы → указы → прочее
  const grouped = POLICY_CATEGORY_ORDER.map(cat => ({ cat, items: active.filter(p => p.category === cat) }));
  const uncategorized = active.filter(p => !POLICY_CATEGORY_ORDER.includes(p.category));

  return (
    <>
      <div style={{ display: "grid", gap: 18 }}>
        {grouped.filter(g => g.items.length > 0).map(({ cat, items }) => (
          <div key={cat}>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: POLICY_CATEGORY[cat].color, marginBottom: 8 }}>
              {POLICY_CATEGORY[cat].section} · {items.length}
            </div>
            <div style={{ display: "grid", gap: 12 }}>{items.map((p, i) => renderCard(p, `${cat}-${i}`))}</div>
          </div>
        ))}
        {uncategorized.length > 0 && (
          <div>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#8a8472", marginBottom: 8 }}>ПРОЧЕЕ · {uncategorized.length}</div>
            <div style={{ display: "grid", gap: 12 }}>{uncategorized.map((p, i) => renderCard(p, `u-${i}`))}</div>
          </div>
        )}
        {cancelled.length > 0 && (
          <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginTop: 4 }}>+ {cancelled.length} отменённых</div>
        )}
      </div>
      {openPolicy && (
        <PolicyDetailModal
          policy={openPolicy}
          gameId={gameId}
          currentTurn={currentTurn || 0}
          onClose={() => setOpenPolicy(null)}
          onCancelled={onStateRefresh}
        />
      )}
    </>
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

  // Строим словарь отношений: страна → значение
  const relMap = {};
  for (const r of (state.relations || [])) relMap[r.name] = r.value;

  // Определяем статус страны по уровню отношений
  function getStance(countryName) {
    const val = relMap[countryName];
    if (val === undefined) return "neutral";
    if (val >= 60) return "cooperative";
    if (val <= 30) return "hostile";
    return "neutral";
  }

  const STANCE_COLOR  = { cooperative: "#4a6b5c", neutral: "#7a6a3a", hostile: "#a8313a" };
  const STANCE_BG     = { cooperative: "#f0f5f0", neutral: "#f5f1e6", hostile: "#f5f0ee" };
  const STANCE_BORDER = { cooperative: "#4a6b5c", neutral: "#9c8347", hostile: "#a8313a" };
  const STANCE_BADGE  = { cooperative: "СОЮЗНИК", neutral: "НЕЙТРАЛЬНО", hostile: "ПРОТИВНИК" };

  if (!worldMoves.length) {
    return (
      <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>
        Ходы других стран появятся после вашего первого хода.
      </div>
    );
  }

  const byTurn = {};
  for (const m of [...worldMoves].reverse()) {
    if (!byTurn[m.turn]) byTurn[m.turn] = [];
    byTurn[m.turn].push(m);
  }

  return (
    <div>
      {modal && (() => {
        const stance = getStance(modal.source);
        const col = STANCE_COLOR[stance];
        const relVal = relMap[modal.source];
        return (
          <Modal title={modal.source.toUpperCase() + " · ХОД " + modal.turn} onClose={() => setModal(null)}>
            {relVal !== undefined && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "7px 10px", background: STANCE_BG[stance], borderRadius: 4, border: `1px solid ${col}33` }}>
                <span className="mono-font" style={{ fontSize: 9, color: col, letterSpacing: "0.08em" }}>{STANCE_BADGE[stance]}</span>
                <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: col }}>{relVal}/100</span>
                <div style={{ flex: 1, height: 4, background: "#d8d2bf", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${relVal}%`, height: "100%", background: col }} />
                </div>
              </div>
            )}
            <div className="doc-font" style={{ fontSize: 15, lineHeight: 1.65, color: "#3a362e", marginBottom: 14 }}>
              {modal.text}
            </div>
            {modal.reactions?.length > 0 && (
              <div style={{ borderTop: "1px solid #d8d2bf", paddingTop: 12 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8, letterSpacing: "0.06em" }}>ОЦЕНКА АНАЛИТИКОВ</div>
                {modal.reactions.map((r, i) => (
                  <div key={i} className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, color: "#5c5648", fontStyle: "italic" }}>«{r.text}»</div>
                ))}
              </div>
            )}
          </Modal>
        );
      })()}

      <div style={{ display: "grid", gap: 20 }}>
        {Object.entries(byTurn).map(([turn, moves]) => (
          <div key={turn}>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#8a8472", marginBottom: 8, borderBottom: "1px solid #d8d2bf", paddingBottom: 4 }}>
              ХОД {turn} — ДЕЙСТВИЯ ДРУГИХ ГОСУДАРСТВ
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {moves.map((move, i) => {
                const stance = getStance(move.source);
                const col = STANCE_COLOR[stance];
                const bg  = STANCE_BG[stance];
                const brd = STANCE_BORDER[stance];
                const relVal = relMap[move.source];
                return (
                  <div
                    key={i}
                    onClick={() => setModal(move)}
                    style={{ background: bg, border: `1px solid ${brd}44`, borderLeft: `4px solid ${brd}`, borderRadius: 4, padding: "10px 12px", cursor: "pointer", transition: "opacity 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                          <span className="mono-font" style={{ fontSize: 11, color: col, fontWeight: 700, letterSpacing: "0.04em" }}>
                            {move.source.toUpperCase()}
                          </span>
                          <span className="mono-font" style={{ fontSize: 8, color: col, background: `${col}18`, padding: "1px 5px", borderRadius: 2 }}>
                            {STANCE_BADGE[stance]}
                          </span>
                          {relVal !== undefined && (
                            <span className="mono-font" style={{ fontSize: 9, color: "#a8a294" }}>{relVal}</span>
                          )}
                        </div>
                        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.4, color: "#3a362e" }}>
                          {move.text.length > 110 ? move.text.slice(0, 110) + "…" : move.text}
                        </div>
                      </div>
                      <span style={{ color: col, marginLeft: 10, flexShrink: 0, fontSize: 16 }}>›</span>
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
  decree:          { icon: "📜", color: "#a8313a", label: "УКАЗ" },
  news:            { icon: "📰", color: "#5b6b8c", label: "НОВОСТИ" },
  reaction:        { icon: "🌐", color: "#4a6b5c", label: "РЕАКЦИЯ" },
  nuclear_reaction:{ icon: "☢", color: "#c03030", label: "ЯДЕРНЫЙ КРИЗИС" },
  world_move:      { icon: "⚡", color: "#8c4a2a", label: "ДЕЙСТВИЕ ПРОТИВНИКА" },
};

function StatDeltaBadges({ delta }) {
  if (!delta || !Object.keys(delta).length) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
      {Object.entries(delta).map(([k, v]) => {
        const c = deltaColor(k, v);
        const isBad = c === "#e09090";
        return (
          <span key={k} className="mono-font" style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 3,
            background: isBad ? "#2a0808" : "#0a1a0d",
            color: c,
            border: `1px solid ${isBad ? "#6a1010" : "#2a4030"}`,
          }}>
            {ALL_STAT_LABELS[k] || k} {v > 0 ? "+" : ""}{v}
          </span>
        );
      })}
    </div>
  );
}

function UkraineActionCard({ item, gameId, respondedType, onResponded, warCounter = 0 }) {
  const [loading, setLoading] = useState(null); // responseType being submitted
  const [error, setError] = useState(null);

  // reactions хранится как объект {type, responses} для ukraine_action
  const eventData = item.reactions && !Array.isArray(item.reactions) ? item.reactions : null;
  const responses = eventData?.responses || [];

  const WAR_DEFEAT_THRESHOLD = 3;
  const warDanger = warCounter >= WAR_DEFEAT_THRESHOLD - 1; // 2+ = опасная зона

  const RESPONSE_STYLE = {
    defend:   { label: "🛡 Оборонительные меры", bg: "#0d1a10", border: "#2a5a30", color: "#7fae93" },
    retaliate:{ label: "⚔ Контрудар", bg: "#1a0d08", border: "#7a3020", color: "#e09070" },
    accept:   { label: "📋 Принять потери", bg: "#141420", border: "#3a3a5a", color: "#9090c0" },
  };

  async function handleRespond(responseType) {
    setLoading(responseType);
    setError(null);
    try {
      await respondToUkraineEvent(gameId, item.turn, responseType);
      onResponded(item.turn, responseType);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ background: "#140808", border: "2px solid #7a2020", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ padding: "10px 13px", borderLeft: "4px solid #c03030" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: "#e05050" }}>
            ⚔ {item.source?.toUpperCase()} · ДЕЙСТВИЕ ПРОТИВНИКА
          </span>
          <span className="mono-font" style={{ fontSize: 9, color: "#6a3030" }}>ХОД {item.turn}</span>
        </div>
        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.45, color: "#e8c0b0" }}>{item.text}</div>
      </div>
      <div style={{ padding: "10px 13px 12px", background: "#1a0a0a", borderTop: "1px solid #5a1a1a" }}>
        {respondedType ? (
          <div className="mono-font" style={{ fontSize: 11, color: "#7fae93" }}>
            ✓ Ответ дан: {RESPONSE_STYLE[respondedType]?.label || respondedType}
          </div>
        ) : (
          <>
            {/* Счётчик эскалации */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a5050", letterSpacing: "0.08em", flex: 1 }}>
                ВЫБЕРИТЕ ОТВЕТНЫЕ МЕРЫ
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
                color: warDanger ? "#e05050" : "#8a6050",
                background: warDanger ? "#2a0d0d" : "#1a1010",
                border: `1px solid ${warDanger ? "#7a2020" : "#3a2020"}`,
                borderRadius: 3, padding: "2px 7px",
              }}>
                ⚠ Эскалация: {warCounter}/{WAR_DEFEAT_THRESHOLD}
              </div>
            </div>
            {warDanger && (
              <div className="mono-font" style={{ fontSize: 9.5, color: "#e05050", background: "#200808", border: "1px solid #5a1010", borderRadius: 3, padding: "5px 8px", marginBottom: 8, lineHeight: 1.5 }}>
                КРИТИЧЕСКИ: счётчик войны {warCounter}/{WAR_DEFEAT_THRESHOLD}. «Контрудар» добавит +1 — при значении ≥{WAR_DEFEAT_THRESHOLD} наступает поражение (defeat_war).
              </div>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {responses.map((r) => {
                const style = RESPONSE_STYLE[r.type] || {};
                const isRetaliate = r.type === "retaliate";
                return (
                  <button
                    key={r.type}
                    onClick={() => handleRespond(r.type)}
                    disabled={!!loading}
                    style={{
                      background: loading === r.type ? "#2a1a1a" : style.bg || "#1a1a2a",
                      border: `1px solid ${isRetaliate && warDanger ? "#c04040" : style.border || "#4a4a6a"}`,
                      color: style.color || "#a0a0c0",
                      borderRadius: 4, padding: "8px 12px",
                      fontFamily: "'PT Serif',serif", fontSize: 12.5,
                      textAlign: "left", cursor: loading ? "wait" : "pointer",
                      opacity: loading && loading !== r.type ? 0.5 : 1,
                    }}
                  >
                    {loading === r.type ? "Выполняется…" : isRetaliate ? `${r.label} ${warDanger ? "⚠ +1 эскал." : "(+1 к счётчику)"}` : r.label}
                  </button>
                );
              })}
            </div>
            {error && <div className="mono-font" style={{ fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const OFZ_MAX = 3;
const OFZ_MONTHLY_COST = 3;
const TREASURY_PER_TRILLION = 0.8;

function TreasuryTab({ state, gameId, onRefresh }) {
  const stats = state.stats || {};
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

  const treasury = typeof stats.treasury === "number" ? stats.treasury : 52;
  const eco = stats.economy ?? 50;
  const ofzCount = stats.ofz_count ?? 0;
  const ofzUsedThisMonth = !!stats.ofz_used_this_month;
  const activePolicies = (state.policies || []).filter(p => p.status !== "cancelled");
  const taxIncome = activePolicies.reduce((s, p) => s + (Number(p.budget_income) || 0), 0);
  const programUpkeep = activePolicies.reduce((s, p) => s + (Number(p.budget_upkeep) || 0), 0);
  const ofzDebt = ofzCount * OFZ_MONTHLY_COST;
  const economyIncome = eco >= 50
    ? Math.round(20 + (eco - 50) * 0.6)
    : eco >= 35 ? Math.round(eco * 0.4) : Math.round(Math.max(5, eco * 0.2));
  const projectedNet = economyIncome + taxIncome - programUpkeep - ofzDebt;
  const projectedTreasury = Math.max(-100, Math.min(100, treasury + projectedNet));

  const T = TREASURY_PER_TRILLION;
  const treasuryTrln = (treasury * T).toFixed(1);
  const projTrln = (projectedTreasury * T).toFixed(1);

  const gaugePercent = Math.max(0, Math.min(100, (treasury + 100) / 2)); // -100..100 → 0..100%
  const gaugeColor = treasury < 0 ? "#c03030" : treasury < 20 ? "#c08030" : "#3a7a5a";

  async function handleIssue() {
    setLoading("issue"); setError(null);
    try { await issueBonds(gameId); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  async function handleRepay() {
    setLoading("repay"); setError(null);
    try { await repayBonds(gameId); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  const sectionStyle = { marginBottom: 20 };
  const labelStyle = { fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.12em", color: "#8a8472", marginBottom: 8 };
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #e0dac8" };

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Казна: текущий уровень */}
      <div style={sectionStyle}>
        <div style={labelStyle}>КАЗНА — ТЕКУЩЕЕ СОСТОЯНИЕ</div>
        <div style={{ background: "#14181f", borderRadius: 6, padding: "14px 16px", border: "1px solid #2a3040" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: gaugeColor }}>
                ₽{treasuryTrln} трлн
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#5a6070", marginTop: 2 }}>
                {treasury >= 0 ? `+${Math.round(treasury)} пунктов` : `${Math.round(treasury)} пунктов (ДЕФИЦИТ)`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: projectedNet >= 0 ? "#5a8a6a" : "#c05050" }}>
                {projectedNet >= 0 ? "▲" : "▼"} {projectedNet >= 0 ? "+" : ""}{projectedNet} / мес.
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#5a6070" }}>
                прогноз: ₽{projTrln} трлн
              </div>
            </div>
          </div>
          {/* Шкала */}
          <div style={{ height: 6, background: "#2a3040", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${gaugePercent}%`, background: gaugeColor, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
          {treasury < 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e05050", marginTop: 8 }}>
              ⚠ БЮДЖЕТНЫЙ ДЕФИЦИТ — инфляция и экономика под давлением
            </div>
          )}
        </div>
      </div>

      {/* Баланс: доходы и расходы */}
      <div style={sectionStyle}>
        <div style={labelStyle}>МЕСЯЧНЫЙ БАЛАНС (ПРОГНОЗ)</div>
        <div style={{ background: "#f5f1e6", border: "1px solid #d8d2bf", borderRadius: 4 }}>
          <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #e0dac8" }}>
            <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#3a6a4a" }}>+ Налоговый доход (экономика {Math.round(eco)})</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#3a6a4a", fontWeight: 700 }}>+{economyIncome}</span>
          </div>
          {taxIncome > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #e0dac8" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#3a6a4a" }}>+ Налоговые политики</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#3a6a4a", fontWeight: 700 }}>+{taxIncome}</span>
            </div>
          )}
          {programUpkeep > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #e0dac8" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#8a3030" }}>− Содержание программ ({activePolicies.length} активных)</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#8a3030", fontWeight: 700 }}>−{programUpkeep}</span>
            </div>
          )}
          {ofzDebt > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #e0dac8" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#8a3030" }}>− Обслуживание ОФЗ ({ofzCount} выпуска)</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#8a3030", fontWeight: 700 }}>−{ofzDebt}</span>
            </div>
          )}
          <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#5a5040", letterSpacing: "0.06em" }}>ИТОГ</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: projectedNet >= 0 ? "#2a6a3a" : "#8a2020" }}>
              {projectedNet >= 0 ? "+" : ""}{projectedNet} пунктов/мес.
            </span>
          </div>
        </div>
      </div>

      {/* ОФЗ: долговые инструменты */}
      <div style={sectionStyle}>
        <div style={labelStyle}>ОФЗ — ГОСУДАРСТВЕННЫЙ ДОЛГ</div>
        <div style={{ background: "#14181f", borderRadius: 6, padding: "14px 16px", border: `1px solid ${ofzCount > 0 ? "#5a3a10" : "#2a3040"}` }}>
          {/* Слоты выпусков */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {Array.from({ length: OFZ_MAX }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 28, borderRadius: 4,
                background: i < ofzCount ? "#3a2510" : "#1a2030",
                border: `1px solid ${i < ofzCount ? "#8a5520" : "#2a3040"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.06em",
                color: i < ofzCount ? "#c08050" : "#3a4050",
              }}>
                {i < ofzCount ? `ОФЗ-${i + 1}` : "—"}
              </div>
            ))}
          </div>
          {ofzCount > 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c08050", marginBottom: 10 }}>
              Активных выпусков: {ofzCount}/{OFZ_MAX} · Обслуживание: −{ofzDebt} пунктов/мес.
              (≈₽{(ofzDebt * T).toFixed(1)} трлн) · Инфляционное давление +{ofzCount}/мес.
            </div>
          )}
          {ofzCount === 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#3a5050", marginBottom: 10 }}>
              Активных выпусков нет. Долговая нагрузка: нулевая.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleIssue}
              disabled={ofzCount >= OFZ_MAX || ofzUsedThisMonth || loading === "issue"}
              style={{
                flex: 1, background: ofzCount >= OFZ_MAX || ofzUsedThisMonth ? "#1a2030" : "#1a2a10",
                border: `1px solid ${ofzCount >= OFZ_MAX || ofzUsedThisMonth ? "#2a3040" : "#3a5a20"}`,
                color: ofzCount >= OFZ_MAX || ofzUsedThisMonth ? "#3a4050" : "#7ab060",
                borderRadius: 4, padding: "9px 12px",
                fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: ofzCount >= OFZ_MAX || ofzUsedThisMonth ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
            >
              {loading === "issue" ? "Выпуск…" : ofzUsedThisMonth ? "⚠ Выпуск уже использован в этом месяце" : ofzCount >= OFZ_MAX ? "✕ Лимит долга исчерпан" : `📄 Выпустить ОФЗ (+20 казны, +2 инфл.)`}
            </button>
            <button
              onClick={handleRepay}
              disabled={ofzCount <= 0 || treasury < 20 || loading === "repay"}
              style={{
                flex: 1, background: ofzCount <= 0 || treasury < 20 ? "#1a2030" : "#1a1a2a",
                border: `1px solid ${ofzCount <= 0 || treasury < 20 ? "#2a3040" : "#3a3a5a"}`,
                color: ofzCount <= 0 || treasury < 20 ? "#3a4050" : "#7080b0",
                borderRadius: 4, padding: "9px 12px",
                fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: ofzCount <= 0 || treasury < 20 ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
            >
              {loading === "repay" ? "Погашение…" : `💸 Погасить выпуск (−20 казны, −2 инфл.)`}
            </button>
          </div>
          {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
        </div>
      </div>

      {/* Инфляция */}
      {(() => {
        const inf = stats.inflation ?? 64;
        const infColor = inf > 80 ? "#c03030" : inf > 70 ? "#b05020" : inf > 60 ? "#9c8347" : "#4a7a5a";
        const ecoP = inf > 70 ? Math.min(3, Math.floor((inf - 70) / 10) + 1) : 0;
        const appP = inf > 70 ? Math.min(2, Math.floor((inf - 70) / 15) + 1) : 0;
        return (
          <div style={sectionStyle}>
            <div style={labelStyle}>ИНФЛЯЦИОННОЕ ДАВЛЕНИЕ</div>
            <div style={{ background: inf > 70 ? "#1a0c08" : "#f5f1e6", border: `1px solid ${inf > 70 ? "#7a3020" : "#d8d2bf"}`, borderRadius: 4, padding: "12px 14px" }}>
              {/* Значение + бар */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: inf > 70 ? "#e0c0a0" : "#3a3020" }}>Инфляция</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: infColor }}>
                  {Math.round(inf)}
                </span>
              </div>
              <div style={{ height: 8, background: inf > 70 ? "#2a1510" : "#e0dac8", borderRadius: 4, overflow: "hidden", marginBottom: 10, position: "relative" }}>
                <div style={{ height: "100%", width: `${inf}%`, background: infColor, borderRadius: 4, transition: "width 0.4s" }} />
                {/* порог 70 — маркер */}
                <div style={{ position: "absolute", top: 0, left: "70%", width: 1, height: "100%", background: "#c03030", opacity: 0.6 }} />
              </div>
              {/* Строки штрафов */}
              {ecoP > 0 ? (
                <div style={{ background: inf > 70 ? "#200a06" : "#fff4f0", border: `1px solid ${inf > 80 ? "#8a2020" : "#c07040"}`, borderRadius: 3, padding: "6px 10px" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: inf > 80 ? "#e05050" : "#b05030", letterSpacing: "0.06em", marginBottom: 4 }}>
                    АКТИВНЫЙ ИНФЛЯЦИОННЫЙ ШТОРМ (порог &gt; 70)
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c04040" }}>
                      Экономика −{ecoP}/мес.
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c04040" }}>
                      Одобрение −{appP}/мес.
                    </span>
                  </div>
                  <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11.5, color: inf > 70 ? "#c09080" : "#7a4030", marginTop: 5, lineHeight: 1.4 }}>
                    Погасите ОФЗ или проведите политику аустерити, чтобы снизить давление.
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#5a7050" }}>
                  Инфляция в норме. Штрафов нет — порог активируется при значении &gt; 70.
                </div>
              )}
              {/* ОФЗ-вклад */}
              {ofzCount > 0 && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#8a6040", marginTop: 8, borderTop: `1px solid ${inf > 70 ? "#3a2010" : "#e0dac8"}`, paddingTop: 6 }}>
                  ОФЗ вклад: +{ofzCount} инфл./мес. (обслуживание) + {ofzCount} инфл./мес. (базовый рост)
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function NewsfeedTab({ state, gameId, onRefresh }) {
  const [respondedMap, setRespondedMap] = useState(() => state.stats?.ukraine_responses || {});

  // Синхронизируем при обновлении state
  useEffect(() => {
    setRespondedMap(state.stats?.ukraine_responses || {});
  }, [state.stats?.ukraine_responses]);

  function handleResponded(turnN, responseType) {
    setRespondedMap(prev => ({ ...prev, [turnN]: responseType }));
    onRefresh?.();
  }

  if (!state.newsfeed?.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>Лента пуста.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {[...state.newsfeed].reverse().map((item, i) => {
        if (item.type === "ukraine_action") {
          return (
            <UkraineActionCard
              key={i}
              item={item}
              gameId={gameId}
              respondedType={respondedMap[item.turn]}
              onResponded={handleResponded}
              warCounter={state.stats?.war_escalation_counter ?? 0}
            />
          );
        }

        const meta = NEWSFEED_TYPE[item.type] || NEWSFEED_TYPE.news;
        const isWorldMove = item.type === "world_move";
        const analystNote = isWorldMove ? item.reactions?.[0] : null;
        const moveDelta = analystNote?.stat_delta || {};
        return (
          <div key={i} style={{
            background: isWorldMove ? "#1a0e0a" : "#f5f1e6",
            border: `1px solid ${isWorldMove ? "#6a3020" : "#d8d2bf"}`,
            borderRadius: 4, overflow: "hidden",
          }}>
            <div style={{ padding: "10px 13px", borderLeft: `3px solid ${meta.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: meta.color }}>
                  {meta.icon} {item.source.toUpperCase()} · {meta.label}
                </span>
                <span className="mono-font" style={{ fontSize: 9, color: isWorldMove ? "#6a4030" : "#8a8472" }}>ХОД {item.turn}</span>
              </div>
              <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.45, color: isWorldMove ? "#d0a090" : undefined }}>{item.text}</div>
              {isWorldMove && <StatDeltaBadges delta={moveDelta} />}
            </div>
            {!isWorldMove && Array.isArray(item.reactions) && item.reactions.length > 0 && (
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
            {isWorldMove && analystNote && (
              <div style={{ background: "#120a08", padding: "7px 13px 10px", borderTop: "1px solid #4a2010" }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#6a3020", marginBottom: 4, letterSpacing: "0.05em" }}>ОЦЕНКА АНАЛИТИКА</div>
                <div className="doc-font" style={{ fontSize: 12.5, color: "#c08070", lineHeight: 1.4 }}>{analystNote.text}</div>
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

function WikiTab() {
  const S = { h: { fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#9c8347", letterSpacing: "0.12em", marginBottom: 8, marginTop: 20 }, p: { fontFamily: "'PT Serif',serif", fontSize: 13, color: "#a0a8b8", lineHeight: 1.6, marginBottom: 6 }, b: { color: "#c8b87a" } };
  return (
    <div style={{ maxWidth: 640 }}>
      <div className="mono-font" style={{ fontSize: 13, color: "#9c8347", fontWeight: 700, marginBottom: 4 }}>📖 ЛИКБЕЗ — КАК РАБОТАЕТ ИГРА</div>
      <div className="doc-font" style={{ fontSize: 12, color: "#5a6070", marginBottom: 20 }}>Прочтите один раз — потом всё встанет на место.</div>

      <div style={S.h}>РЕСУРСЫ</div>
      <div style={S.p}><span style={S.b}>Инициатива</span> — политическая воля президента. Восстанавливается полностью в начале каждого месяца. Каждое действие тратит её: военная операция — 55, реформа — 35, быстрый указ — 20. Если инициативы не хватает — действие недоступно.</div>
      <div style={S.p}><span style={S.b}>Казна</span> — деньги государства. Каждое действие стоит очков казны. В конце месяца приходит доход: чем выше экономика (особенно выше 50), тем больше налогов. Активные программы требуют содержания. Дефицит (казна &lt; 0) разгоняет инфляцию и давит экономику.</div>

      <div style={S.h}>ПОКАЗАТЕЛИ</div>
      <div style={S.p}><span style={S.b}>Экономика</span> — общее состояние народного хозяйства. Ниже 30 — поражение (коллапс). Влияет на доход казны: при экономике выше 50 — доход растёт, ниже — падает.</div>
      <div style={S.p}><span style={S.b}>Армия</span> — боеспособность вооружённых сил. Складывается из морального духа, готовности и территориального контроля. Военные операции двигают территории, но стоят инициативы и денег.</div>
      <div style={S.p}><span style={S.b}>Дипломатия</span> — международный вес страны. Ниже 15 — поражение через изоляцию. Растёт от дипломатических операций и договорённостей. Падает от эскалации и провокаций.</div>
      <div style={S.p}><span style={S.b}>Стабильность</span> — порядок внутри страны. Ниже 25 — поражение через волнения. Страдает от дефицита, военных неудач и социальной напряжённости.</div>
      <div style={S.p}><span style={S.b}>Рейтинг</span> — одобрение президента. Ниже 30 — поражение через переворот. Растёт от социальных решений, военных успехов, информационной работы.</div>
      <div style={S.p}><span style={S.b}>Мирный трек</span> — прогресс переговоров. Достигнув 100 при сильных показателях — дипломатическая победа. Медленно распадается если не поддерживать дипломатией.</div>

      <div style={S.h}>ТИПЫ ДЕЙСТВИЙ</div>
      <div style={S.p}><span style={S.b}>📜 Быстрый указ</span> (20 инициативы, 3 казны) — кадровые назначения, разовые постановления, срочные меры. Эффект через 1–2 месяца.</div>
      <div style={S.p}><span style={S.b}>📋 Реформа</span> (35, 8) — системные изменения в отрасли. Нужно согласование. Эффект через 3–6 месяцев.</div>
      <div style={S.p}><span style={S.b}>🏛 Программа</span> (55, 15) — федеральный нацпроект с бюджетом и KPI. Большой эффект, долгий горизонт, требует содержания.</div>
      <div style={S.p}><span style={S.b}>⚔️ Военная операция</span> (55, 20) — прямое применение силы. Двигает территориальный контроль, но провоцирует ответные удары Украины и международную реакцию.</div>
      <div style={S.p}><span style={S.b}>🤝 Диппереговоры</span> (35, 5) — встречи, письма, предложения. Двигает мирный трек. Не меняет территории.</div>
      <div style={S.p}><span style={S.b}>🕵️ Разведка</span> (20, 5) — тайные операции. Случайный исход: от компромата на противника до дипломатического скандала.</div>

      <div style={S.h}>СПЕЦИАЛЬНЫЕ ДЕЙСТВИЯ</div>
      <div style={S.p}><span style={S.b}>🏠 Передышка</span> — восстанавливает экономику, рейтинг и стабильность. Доступна 1 раз за месяц. Не восстанавливает инициативу — только тыл.</div>
      <div style={S.p}><span style={S.b}>⚙ Перегруппировка</span> — армия отходит для переформирования, инициатива восстанавливается. Внимание: Украина видит паузу и усиливает давление.</div>

      <div style={S.h}>ПУТИ К ПОБЕДЕ</div>
      <div style={S.p}><span style={S.b}>🏆 Военная победа</span> — взять Донецк и Луганск (100%), ещё 2 из 3 регионов, армия ≥85, все показатели выше 52.</div>
      <div style={S.p}><span style={S.b}>🕊 Дипломатическая победа</span> — мирный трек 100% + экономика/рейтинг/стабильность ≥65. Доступна с хода 12.</div>
      <div style={S.p}><span style={S.b}>⚡ Принуждение к миру</span> — военное доминирование + мирный трек ≥40. Победа с позиции силы.</div>

      <div style={S.h}>СОВЕТНИКИ И УКАЗЫ</div>
      <div style={S.p}>Кабинет министров даёт советы по всем направлениям. Вы можете принять предложенный советником указ — или полностью сформулировать своё решение. Игра принимает любые реалистичные президентские решения: торговые договоры, кадровые назначения, законы, дипломатические ноты, военные приказы.</div>
      <div style={S.p}>Хороший собственный указ часто лучше совета: вы лучше знаете ситуацию. Чем конкретнее формулировка — тем точнее игра рассчитает эффект.</div>
    </div>
  );
}
