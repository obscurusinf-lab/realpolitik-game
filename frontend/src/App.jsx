import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Shield, Swords, Landmark, Globe2, ScrollText, TrendingDown, TrendingUp, Minus, Send, AlertTriangle, Users, FileText } from "lucide-react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { fetchGameState, previewTurn, confirmTurn, cancelTurn, consultAdvisor, argueWithAdvisor, skipTurn, regroupTurn, endMonth, fetchStatHistory, fetchPolicyNews, cancelPolicy, fetchLegacy, sendWorldResponse, sendUkraineResponse, respondToUkraineEvent, issueBonds, repayBonds, cbPressure, cbReplace, antiCorruptionCampaign, convertReserves, toggleFxRegime, pingGame, updateGameLanguage, resolveFactionDilemma } from "./api";
import { FeedbackModal } from "./FeedbackModal";
import { t, getLang, useLang, LangToggle, statLabel, advisorToneLabel, directionLabel, actionModeLabel, actionScaleLabel, advisorRoleLabel, advisorGreeting, substatDesc, actionTypeLabel, policyCategoryLabel, policyCategorySection, kremlinDomainLabel, kremlinTierLabel, kremlinSubdomainLabel, kremlinCategoryTitle, kremlinCategoryDesc, useForceDesktop, DesktopViewToggle } from "./i18n";

// БАЛАНС (2026-07-04): иконка вкладки «Кремль» — раньше lucide Landmark (греческие колонны,
// буквально Парфенон), потом Castle (обычная западная крепость) — Петя прислал фото Спасской
// башни и попросил именно КРАСНУЮ звезду: самая узнаваемая, однозначно кремлёвская деталь
// (в отличие от стен/башен — общий признак любой крепости в мире). ⭐-эмодзи в лейбле не подходил:
// это цветной эмодзи-глиф, не текстовый символ, CSS-цвет на него не действует, и на большинстве
// платформ он рендерится жёлтым/золотым, а не красным. Поэтому — свой SVG, залитый фиксированным
// красным цветом (не currentColor: звезда красная всегда, а не только в активной вкладке).
function KremlinStarIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#c0392b" stroke="#c0392b" strokeWidth="0.5" strokeLinejoin="round">
      <path d="M12 2l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 16.9l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94z" />
    </svg>
  );
}

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
  // Второстепенные статы скрыты по умолчанию за одним переключателем (см. тот же паттерн в
  // PreviewCard/PrimarySecondaryDeltas) — 5 базовых статов уже показаны отдельно выше, здесь
  // только "всё остальное" (Петя, 2026-07-07: "основные метрики, и по клику — побочные").
  const [showSecondaryResults, setShowSecondaryResults] = useState(false);

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
  // actualPrevStats из бэкенда (состояние до декрета) точнее чем prevState (может быть post-turn)
  const prevStats = turnResult?.actualPrevStats || prevState?.stats || {};
  const changelog = turnResult?.statChangelog || null; // { economy: { decree, events, total }, ... }

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

        {/* Фаза 1: твои решения. Месяц может содержать НЕСКОЛЬКО указов (multiActionTurns) —
            раньше здесь показывался только последний (Петя, 2026-07-07: "показан только
            последний указ, а не все"). turnResult.actions — все решения месяца по порядку;
            если их несколько, показываем каждое отдельной карточкой, иначе как раньше. */}
        {Array.isArray(turnResult?.actions) && turnResult.actions.length > 1 ? (
          <div style={{ marginBottom: 14 }}>
            {turnResult.actions.map((a, i) => (
              <div key={i} className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderLeft: "3px solid #9c8347", borderRadius: 6, padding: "14px 16px", marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 6, letterSpacing: "0.1em" }}>{ACTION_MODE_LABEL[a.actionMode] || "📜 УКАЗ"} · РЕШЕНИЕ {i + 1}/{turnResult.actions.length}</div>
                <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{a.narrative}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderLeft: "3px solid #9c8347", borderRadius: 6, padding: "16px 18px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#9c8347", marginBottom: 8, letterSpacing: "0.1em" }}>{ACTION_MODE_LABEL[turnResult?.actionMode] || "📜 УКАЗ"}</div>
            <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.6 }}>{turnResult?.narrative}</div>
          </div>
        )}

        {/* Куда тает/растёт экономика — ВСЕГДА видимая разбивка (не только в модалке-предупреждении
            Минфина, которая всплывает лишь в плохие месяцы). Петя, 2026-07-07: "делаю указ, и
            экономика падает — а почему, я не понимаю". economySummary.effects — тот же список
            автоэффектов (ставка ЦБ, военное бремя, инфляция, стагнация ВВП и т.д.), что бэкенд
            уже считает каждый месяц (см. FinanceMinisterWarningModal) — просто теперь видно всегда. */}
        {turnResult?.economySummary && turnResult.economySummary.effects?.length > 0 && (() => {
          const { before, after, effects, capped, cap } = turnResult.economySummary;
          const netChange = after - before;
          const negatives = effects.filter(e => e.delta < 0).sort((a, b) => a.delta - b.delta);
          const positives = effects.filter(e => e.delta > 0);
          return (
            <div className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 18px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 8, letterSpacing: "0.1em" }}>ИЗ ЧЕГО СЛОЖИЛАСЬ ЭКОНОМИКА В ЭТОМ МЕСЯЦЕ</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span className="mono-font" style={{ fontSize: 18, fontWeight: 700, color: netChange < 0 ? "#e09090" : netChange > 0 ? "#8fbf8f" : "#cdd3e0" }}>{before} → {after}</span>
                <span className="mono-font" style={{ fontSize: 11, color: netChange < 0 ? "#e09090" : "#8fbf8f" }}>({netChange >= 0 ? "+" : ""}{netChange})</span>
              </div>
              {negatives.length > 0 && (
                <div style={{ marginBottom: positives.length > 0 ? 8 : 0 }}>
                  {negatives.map((e, i) => (
                    <div key={i} className="doc-font" style={{ fontSize: 12, color: "#d8b0b0", lineHeight: 1.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>{e.label}</span><span className="mono-font">{e.delta}</span>
                    </div>
                  ))}
                </div>
              )}
              {positives.length > 0 && (
                <div>
                  {positives.map((e, i) => (
                    <div key={i} className="doc-font" style={{ fontSize: 12, color: "#b0d8b8", lineHeight: 1.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>{e.label}</span><span className="mono-font">+{e.delta}</span>
                    </div>
                  ))}
                </div>
              )}
              {capped && (
                <div className="doc-font" style={{ fontSize: 11, color: "#8a8472", fontStyle: "italic", marginTop: 8 }}>
                  Автоматические потери месяца превысили потолок в −{cap} — часть эффекта уже компенсирована.
                </div>
              )}
            </div>
          );
        })()}

        {/* Фаза 2: изменения статов */}
        {phase >= 1 && (
          <div className="et-fade" style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 18px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10, letterSpacing: "0.1em" }}>ИЗМЕНЕНИЯ ПОКАЗАТЕЛЕЙ</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(() => {
                // Экономика теперь индикатор: военные/дипломатия/шпионаж/большинство указов не
                // двигают economy напрямую, поэтому её totalD часто ровно 0 здесь — выглядит так,
                // будто действие вообще не задело экономику. Честный прогноз (та же формула,
                // что в бэкенде) показывает, что оно всё равно скажется — просто с лагом.
                const econForecast = computeEconomyForecastNotes(prevStats, statDeltas);
                const econForecastSum = Object.values(econForecast).reduce((s, n) => s + n.after, 0);
                return Object.entries(statLabel).map(([k, label]) => {
                  const entry = changelog?.[k];
                  const totalD = entry?.total ?? (statDeltas[k] ?? 0);
                  const decreeD = entry?.decree ?? (statDeltas[k] ?? 0);
                  const eventsD = entry?.events ?? 0;
                  const prev = prevStats[k] ?? 50;
                  const next = Math.max(0, Math.min(100, prev + totalD));
                  const color = totalD > 0 ? "#7fae93" : totalD < 0 ? "#e09090" : "#5a6070";
                  const showEconForecast = k === "economy" && totalD === 0 && econForecastSum !== 0;
                  return (
                    <div key={k} style={{ background: "#1f2733", padding: "7px 10px", borderRadius: 4 }}>
                      {totalD !== 0
                        ? <PreviewStatBar statKey={k} current={prev} delta={totalD} />
                        : (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="mono-font" style={{ fontSize: 10, color: "#a8a294" }}>{label}</span>
                            <span className="mono-font" style={{ fontSize: 11, color, fontWeight: 700 }}>{prev}</span>
                          </div>
                        )}
                      {/* Разбивка: указ vs события */}
                      {entry && (decreeD !== 0 || eventsD !== 0) && (
                        <div className="mono-font" style={{ fontSize: 9, marginTop: 3, display: "flex", gap: 8 }}>
                          {decreeD !== 0 && (
                            <span style={{ color: decreeD > 0 ? "#5a8a6a" : "#8a5050" }}>
                              указ {decreeD > 0 ? "+" : ""}{decreeD}
                            </span>
                          )}
                          {eventsD !== 0 && (
                            <span style={{ color: eventsD > 0 ? "#5a7a6a" : "#7a4040" }}>
                              события {eventsD > 0 ? "+" : ""}{eventsD}
                            </span>
                          )}
                        </div>
                      )}
                      {showEconForecast && (
                        <div className="mono-font" style={{ fontSize: 9, marginTop: 3, color: econForecastSum < 0 ? "#c47a7a" : "#7fae93" }}>
                          ⤷ сейчас не видно, но скажется позже: {fmtEcoEffect(econForecastSum)}/мес (рост ВВП/занятость/армия/инфляция/казна)
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            {(() => {
              // Второстепенные статы (субметрики/территории/мирный трек/инициатива/казна и т.д.,
              // всё что не входит в 5 базовых статов выше) — за одним переключателем, тот же
              // компонент, что и в превью указа (PreviewCard/PrimarySecondaryDeltas). Раньше тут
              // была стена из 10+ полос ради изменений ±1 (Петя, 2026-07-07: "перегруженно").
              const extraEntries = Object.entries(statDeltas).filter(
                ([s, d]) => d !== 0 && !statMeta[s] && !s.startsWith("_") && s !== "military_streak"
              );
              if (extraEntries.length === 0) return null;
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a3040" }}>
                  <PrimarySecondaryDeltas deltas={extraEntries} current={prevStats} showSecondary={showSecondaryResults} toggleSecondary={() => setShowSecondaryResults(v => !v)} />
                </div>
              );
            })()}
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

            {/* Удары и действия третьих сторон — только то, что прямо задело статы (есть
                stat_delta). При нескольких указах в месяце (MULTI_ACTION_TURNS) их может
                накопиться много; показываем самые значимые, остальное — в ленте («Лента»),
                которая получает все newsfeed-записи без фильтра. */}
            {!polling && worldMoves.length > 0 && (() => {
              const impactOf = (item) => Object.values(item.reactions?.[0]?.stat_delta || {}).reduce((s, v) => s + Math.abs(v), 0);
              const sorted = [...worldMoves].sort((a, b) => impactOf(b) - impactOf(a));
              const SHOWN = 3;
              const shown = sorted.slice(0, SHOWN);
              const hiddenCount = sorted.length - shown.length;
              return (
              <div style={{ marginBottom: 16 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8c4a2a", marginBottom: 10, letterSpacing: "0.1em" }}>⚡ ДЕЙСТВИЯ МИРОВЫХ ИГРОКОВ</div>
                {shown.map((item, i) => {
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
                {hiddenCount > 0 && (
                  <div className="mono-font" style={{ fontSize: 10, color: "#5a6070", textAlign: "center", padding: "4px 0" }}>
                    + ещё {hiddenCount} — во вкладке «Лента»
                  </div>
                )}
              </div>
              );
            })()}
            {/* Реакции стран (worldItems) намеренно НЕ дублируются здесь плоским списком —
                каждая уже становится отдельным экраном «ваши действия»/дипломатический ответ
                сразу после этого экрана (см. handleEndTurnDone → DiplomaticResponseScreen),
                так что список тут был чистым повтором того же контента. */}

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
              {ukraineItems.length > 0 ? "Ваши действия →" : worldItems.length > 0 ? "Ответить на реакции →" : "Следующий ход →"}
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

// Детерминированный советник для экранов выбора
function getEventAdvisor({ stance, theme, stats, options }) {
  const mil = stats?.military ?? 50;
  const peace = stats?.peace_progress ?? 0;
  const dip = stats?.diplomacy ?? 50;
  const eco = stats?.economy ?? 50;
  const stab = stats?.stability ?? 50;

  const goingMilitary = mil > 60;
  const goingPeace = peace > 20;
  const dipWeak = dip < 40;

  let rec, reasoning;

  if (stance === "ally") {
    rec = options.find(o => o.type === "cooperate") ? "cooperate" : options[0]?.type;
    reasoning = "Союзник — взаимодействие укрепит дипломатию и откроет новые возможности для манёвра.";
  } else if (stance === "hostile") {
    if (goingPeace) {
      rec = "deescalate";
      reasoning = `Мирный трек (${peace}%) — деэскалация снизит давление. Конфронтация сейчас затруднит переговоры.`;
    } else if (goingMilitary) {
      rec = stab < 45 ? "ignore" : "confront";
      reasoning = stab < 45
        ? `Стабильность низкая (${stab}). Игнорирование — лучший выбор: не тратим капитал, не провоцируем внутри.`
        : `Военный курс. Жёсткий ответ покажет решимость — но следите за дипломатией (${dip}).`;
    } else {
      rec = eco < 40 ? "deescalate" : "ignore";
      reasoning = eco < 40
        ? `Экономика под давлением (${eco}). Деэскалация может открыть торговые возможности.`
        : "Без чёткой стратегии — игнорирование не тратит ресурсы и не даёт противнику повода для эскалации.";
    }
  } else { // neutral
    if (dipWeak) {
      rec = "cooperate";
      reasoning = `Дипломатия слабая (${dip}). Нейтральный актор может стать точкой опоры — взаимодействие выгодно.`;
    } else if (goingPeace) {
      rec = "cooperate";
      reasoning = `Нейтральный актор может стать посредником в мирном процессе (трек: ${peace}%).`;
    } else {
      rec = "deescalate";
      reasoning = "Нейтральный — поддержите отношения без обязательств. Деэскалация сохраняет опции на будущее.";
    }
  }

  const recOption = options.find(o => o.type === rec) || options[0];
  return { rec, recOption, reasoning };
}

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

// БАЛАНС (2026-07-04): игрок жаловался, что варианты ОТВЕТА игрока стране (не сама реакция
// страны — та персонализирована через COUNTRY_PROFILES в backend/src/ai/worldUpdate.js, п.10)
// одинаковы для любой страны в одной стойке+теме — Турция и Казахстан получают ОДИН И ТОТ ЖЕ
// набор из RESPONSE_OPTIONS.neutral.*, хотя рычаги у них разные (пример игрока — ответ Анкаре).
// Полностью расписать варианты под каждую из ~16 стран × 5 тем — непропорционально большой объём
// контента; вместо этого — короткий реальный рычаг/канал каждой страны (тот же принцип, что
// COUNTRY_PROFILES на бэкенде, просто мельче — noun-phrase для подстановки в конец фразы, а не
// полное предложение) добавляется к вариантам "cooperate"/"deescalate" (где страновая специфика
// реально помогает), "confront"/"ignore" остаются общими — жёсткий отказ звучит одинаково для
// любой страны.
const COUNTRY_HINT = {
  "Турция": "её роль посредника и поставки Байрактаров Украине",
  "Индия": "скидку на нефть, которую она уже получает",
  "ОАЭ": "её роль хаба параллельного импорта",
  "Саудовская Аравия": "координацию по ОПЕК+",
  "Казахстан": "транзитные маршруты параллельного импорта",
  "Китай": "расчёты в юанях в обход доллара",
  "Иран": "поставки дронов и ракетных технологий",
  "Северная Корея": "поставки боеприпасов",
  "Беларусь": "зависимость от российской экономики",
  "Германия": "её зависимость от прежних энергопоставок",
  "Франция": "её периодические намёки на диалог",
  "Польша": "роль логистического хаба для Украины",
  "Великобритания": "её роль инициатора санкций",
  "ЕС": "внутренний раскол по единству санкций (Венгрия, Словакия)",
  "США": "её роль лидера коалиции",
  "НАТО": "разногласия внутри альянса по эскалации",
};
function personalizeOptionLabel(option, source) {
  const hint = COUNTRY_HINT[source];
  if (!hint || (option.type !== "cooperate" && option.type !== "deescalate")) return option.label;
  return `${option.label} (рычаг: ${hint})`;
}

function DiplomaticResponseScreen({ reactions, onRespond, onSkip, gameId, gameStats }) {
  const [idx, setIdx] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [effectResult, setEffectResult] = useState(null); // { delta, outcome, label }

  const reaction = reactions[idx];
  if (!reaction && !effectResult) { onSkip(); return null; }

  const stance = classifySource(reaction?.source);
  const theme = detectReactionTheme(reaction?.text);
  const optionSet = RESPONSE_OPTIONS[stance]?.[theme] || RESPONSE_OPTIONS[stance]?.generic || RESPONSE_OPTIONS.hostile.generic;
  const advisor = getEventAdvisor({ stance, theme, stats: gameStats, options: optionSet });

  async function handleChoice(responseType) {
    if (choosing) return;
    setChoosing(true);
    try {
      const result = await sendWorldResponse(gameId, responseType, reaction?.source, reaction?.turn, reaction?.text);
      setEffectResult({ delta: result.delta || {}, outcome: result.outcome || "neutral", outcomeText: result.outcomeText || "", responseType });
    } catch {
      setEffectResult({ delta: {}, outcome: "neutral", outcomeText: "", responseType });
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
                style={{ marginTop: 12, background: "#9c8347", color: "#0a0d12", border: "none", borderRadius: 5, padding: "10px 24px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {idx + 1 < reactions.length ? "Следующая реакция →" : "Продолжить →"}
              </button>
            </div>
          );
        })()}

        {/* Советник */}
        {!effectResult && (
          <div style={{ background: "#141c14", border: "1px solid #2a4020", borderLeft: "3px solid #4a7a3a", borderRadius: 6, padding: "10px 14px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#4a7a3a", marginBottom: 5, letterSpacing: "0.12em" }}>👤 СОВЕТНИК</div>
            <div className="doc-font" style={{ fontSize: 12.5, color: "#a8c8a0", lineHeight: 1.5, marginBottom: 8 }}>{advisor.reasoning}</div>
            {advisor.recOption && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#4a7a3a" }}>РЕКОМЕНДУЮ:</span>
                <span className="doc-font" style={{ fontSize: 11.5, color: "#7fae93", fontStyle: "italic" }}>«{personalizeOptionLabel(advisor.recOption, reaction?.source)}»</span>
              </div>
            )}
          </div>
        )}

        {/* Варианты ответа */}
        {!effectResult && (
          <>
            <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 10, letterSpacing: "0.08em" }}>ВЫБЕРИТЕ ОТВЕТНУЮ ПОЗИЦИЮ:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {optionSet.map((opt, i) => {
                const isRec = opt.type === advisor.rec;
                return (
                  <button
                    key={i}
                    onClick={() => handleChoice(opt.type)}
                    disabled={choosing}
                    style={{ background: isRec ? "#1a2a16" : "#1f2733", border: `1px solid ${isRec ? "#3a6a2a" : "#2a3040"}`, borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13.5, color: choosing ? "#4a5060" : "#ece7d8", cursor: choosing ? "default" : "pointer", textAlign: "left", lineHeight: 1.45, position: "relative" }}
                    onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#9c8347")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = isRec ? "#3a6a2a" : "#2a3040")}
                  >
                    <span style={{ color: "#9c8347", marginRight: 8 }}>{i + 1}.</span>{personalizeOptionLabel(opt, reaction?.source)}
                    {isRec && <span className="mono-font" style={{ position: "absolute", top: 6, right: 8, fontSize: 7, color: "#4a7a3a", background: "#0d1a08", borderRadius: 2, padding: "1px 4px" }}>★ советник</span>}
                  </button>
                );
              })}
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

// БАЛАНС (2026-07-04): игрок попросил показать предполагаемые изменения статов под каждым
// вариантом ответа Украине ДО выбора (п.7 из списка замечаний) — раньше игрок видел только
// текст кнопки, без единой цифры, и узнавал результат уже после выбора. Исход броска по-прежнему
// вероятностный (не свели к детерминированному прогнозу — это НАМЕРЕННО: "ответный удар" —
// решение с реальным риском, а не гарантированный результат), поэтому здесь — зеркало РЕАЛЬНЫХ
// вероятностей/дельт/цены resolveUkraineResponse() из backend/src/rules/rules-engine.js —
// единственного источника истины для ОБОИХ бэкенд-путей ("ответить Украине" — и полноэкранный
// UkraineResponseScreen, и инлайн-карточка UkraineActionCard в Ленте раньше дублировали разные
// таблицы с разными эффектами для одного и того же решения — объединены в один заход). Держать
// в синхроне при правке баланса ответов.
const UA_RESPONSE_PREVIEW = {
  defend: {
    initiativeCost: 10,
    tiers: [
      { prob: 55, delta: { economy: 0, stability: 1 } },
      { prob: 30, delta: { economy: -1, military: -1 } },
      { prob: 15, delta: { economy: -1, approval: -1 } },
    ],
  },
  retaliate: {
    initiativeCost: 20,
    warEscalationDelta: 1,
    tiers: [
      { prob: 35, delta: { military: 2, approval: 2, army_morale: 2 } },
      { prob: 30, delta: { military: 1, diplomacy: -2 } },
      { prob: 35, delta: { diplomacy: -3, stability: -1, peace_progress: -5 } },
    ],
  },
  accept: {
    initiativeCost: 0,
    tiers: [
      { prob: 25, delta: { approval: -1 } },
      { prob: 75, delta: {} },
    ],
  },
};
function uaResponsePreviewFor(responseType) {
  return UA_RESPONSE_PREVIEW[responseType] || UA_RESPONSE_PREVIEW.accept;
}
function fmtUaDelta(delta) {
  const entries = Object.entries(delta).filter(([, v]) => v !== 0);
  if (entries.length === 0) return "без изменений статов";
  return entries.map(([k, v]) => `${STAT_RU[k] || k} ${v > 0 ? "+" : ""}${v}`).join(", ");
}
// Компактная разбивка вероятностей прямо под кнопкой ответа — 2-3 строки, шанс : дельта, плюс
// постоянная цена (инициатива/риск эскалации), которая применяется независимо от ролла.
function UaResponsePreviewLine({ responseType, muted }) {
  const config = uaResponsePreviewFor(responseType);
  const color = muted ? "#4a3838" : "#8a7070";
  const opacity = muted ? 0.8 : 1;
  return (
    <div className="mono-font" style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 1 }}>
      {config.tiers.map((t, i) => (
        <div key={i} style={{ fontSize: 9.5, color, opacity }}>
          {t.prob}%: {fmtUaDelta(t.delta)}
        </div>
      ))}
      {(config.initiativeCost > 0 || config.warEscalationDelta > 0) && (
        <div style={{ fontSize: 9.5, color: muted ? "#5a4040" : "#a08050", opacity }}>
          всегда: {[config.initiativeCost > 0 ? `−${config.initiativeCost} инициативы` : null, config.warEscalationDelta > 0 ? `+${config.warEscalationDelta} к счётчику эскалации войны` : null].filter(Boolean).join(", ")}
        </div>
      )}
    </div>
  );
}

function UkraineResponseScreen({ items, onDone, gameId, gameStats }) {
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

  // Детерминированный совет на основе ситуации.
  // БАЛАНС (2026-07-04): раньше тема события угадывалась по ключевым словам в item.text —
  // для половины типов событий (war_crimes_tribunal, info_warfare, soldier_leaks,
  // sanctions_push, rail_sabotage — их текст не содержит "дрон"/"удар"/"наступлени"/"перегово")
  // совпадений не было НИКОГДА, и совет всегда падал в общий fallback "сохраняем инициативу
  // для наступления" — бессмысленный для, например, трибунала МУС или лоббирования санкций.
  // meta.type — это UA_ACTIONS.type с бэкенда (turns.js), надёжный enum, а не текст на удачу.
  const UA_TYPE_THEME = {
    drone_strike: "strike", dnipro_push: "strike", weapons_delivery: "strike", black_sea_strike: "strike",
    rail_sabotage: "sabotage", partisan_resistance: "sabotage",
    counterattack: "front", donbass_breakthrough: "front",
    diplomatic_offensive: "diplomatic", foreign_volunteers: "diplomatic",
    war_crimes_tribunal: "legal",
    info_warfare: "info", soldier_leaks: "info", pow_exchange_pr: "info",
    sanctions_push: "sanctions", grain_corridor_pressure: "sanctions",
    ceasefire_betrayal: "betrayal", ceasefire_betrayal_final: "betrayal",
    // "Полная симметрия" (2026-07-06) — 7 широких категорий UA_RULES_TABLE (backend/src/rules/
    // ukraine-rules-engine.js) вместо 17 канонических событий выше. Темы совпадают 1:1 со
    // старыми (strike/sabotage/front/diplomatic/legal/info/sanctions), поэтому вся логика совета
    // ниже (uaAdvisor) продолжает работать без изменений — старые ключи выше не удалены, старые
    // newsfeed_items уже сыгранных партий по-прежнему рендерятся корректно.
    ua_strike_infra: "strike", ua_sabotage: "sabotage", ua_counteroffensive: "front",
    ua_diplomatic: "diplomatic", ua_legal: "legal", ua_info: "info", ua_sanctions: "sanctions",
  };
  const uaAdvisor = (() => {
    const mil = gameStats?.military ?? 50;
    const stab = gameStats?.stability ?? 50;
    const eco = gameStats?.economy ?? 50;
    const dip = gameStats?.diplomacy ?? 50;
    const appr = gameStats?.approval ?? 50;
    const peace = gameStats?.peace_progress ?? 0;
    const theme = UA_TYPE_THEME[meta?.type] || UA_TYPE_THEME[item.type];

    let rec, reasoning;
    if (theme === "diplomatic") {
      rec = responses.find(r => r.type === "accept" || r.type === "defend")?.type || responses[0]?.type;
      reasoning = peace > 20
        ? "Украина делает шаг к диалогу — поддержите, это ускорит мирный трек."
        : "Дипломатическое зондирование. Сохраните нейтралитет — не давайте поводов для эскалации.";
    } else if (theme === "legal") {
      rec = dip < 40 ? "accept" : (responses.find(r => r.type === "defend")?.type || responses[0]?.type);
      reasoning = dip < 40
        ? `Дипломатия и так под давлением (${dip}) — жёсткий ответ на трибунал ускорит изоляцию без реальной пользы на фронте.`
        : "Юридическое давление не меняет расстановку сил на фронте — контрпропаганда снижает эффект без риска дальнейшей изоляции.";
    } else if (theme === "info") {
      rec = stab < 45 ? (responses.find(r => r.type === "defend")?.type || responses[0]?.type) : "accept";
      reasoning = stab < 45
        ? `Стабильность просела (${stab}) — информационную волну нужно гасить, пока она не задела улицу.`
        : `Стабильность (${stab}) пока держится — точечная реакция без лишнего резонанса безопаснее, чем раздувать тему ответом.`;
    } else if (theme === "sanctions") {
      rec = responses.find(r => r.type === "defend")?.type || responses[0]?.type;
      reasoning = eco < 45
        ? `Экономика уже под давлением (${eco}) — укрепление связей с посредниками важнее ответной риторики.`
        : "Санкционное лоббирование бьёт по торговым партнёрам, не по фронту — дипломатическая работа с посредниками эффективнее угроз.";
    } else if (theme === "sabotage") {
      rec = responses.find(r => r.type === "defend")?.type || responses[0]?.type;
      reasoning = `Диверсия угрожает снабжению, а не фронту напрямую — зачистка тыла и охрана логистики важнее ответного удара (готовность войск: ${gameStats?.readiness ?? 50}).`;
    } else if (theme === "betrayal") {
      const isFinalBetrayal = (meta?.type || item.type) === "ceasefire_betrayal_final";
      if (isFinalBetrayal) {
        rec = mil > 55 ? (responses.find(r => r.type === "retaliate")?.type || responses[0]?.type) : (responses.find(r => r.type === "defend")?.type || responses[0]?.type);
        reasoning = mil > 55
          ? `Переговоры мертвы — Киев предал дважды. Армия (${mil}) готова, вопрос решается силой.`
          : `Переговоры мертвы, но армия (${mil}) не готова к большому наступлению — сначала закрепите позиции.`;
      } else {
        rec = mil > 60 ? (responses.find(r => r.type === "retaliate")?.type || responses[0]?.type) : (peace > 15 ? "accept" : (responses.find(r => r.type === "defend")?.type || responses[0]?.type));
        reasoning = mil > 60
          ? `Киев ударил первым во время переговоров. Армия (${mil}) достаточно сильна, чтобы ответить, не теряя инициативу.`
          : peace > 15
            ? `Мирный трек (${peace}) уже продвинут — не рвать его из-за одной провокации, но предупредить жёстко.`
            : `Мирный трек и так слаб (${peace}) — сдержанный ответ сохранит ресурсы для фронта.`;
      }
    } else if (theme === "strike" && mil < 50) {
      rec = responses.find(r => r.type === "defend")?.type || responses[0]?.type;
      reasoning = `Армия ослаблена (${mil}). Защитные меры снизят потери без риска встречной эскалации.`;
    } else if (theme === "front" && mil > 65) {
      rec = responses.find(r => r.type === "retaliate")?.type || responses[0]?.type;
      reasoning = `Военный потенциал высокий (${mil}). Ответный удар укрепит позиции на фронте.`;
    } else if (stab < 40 || eco < 40) {
      rec = "accept";
      reasoning = `Стабильность (${stab}) и экономика (${eco}) под давлением. Принятие ситуации сохранит ресурсы для важных ходов.`;
    } else {
      rec = responses.find(r => r.type === "defend")?.type || responses[0]?.type;
      reasoning = appr < 45
        ? `Рейтинг под давлением (${appr}) — сдержанный ответ безопаснее резких мер.`
        : "Ситуация не требует резких мер — сдержанный ответ сохраняет ресурсы для более важных решений.";
    }
    const recOption = responses.find(r => r.type === rec) || responses[0];
    return { rec, recOption, reasoning };
  })();

  async function handleChoice(responseType, actionType) {
    if (choosing) return;
    setChoosing(true);
    try {
      const result = await sendUkraineResponse(gameId, responseType, actionType || meta?.type, item.turn);
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
          {/* БАЛАНС (2026-07-04): само действие Украины уже применило свои дельты на бэкенде
              (territory/stats) ДО того, как игрок увидел этот экран — раньше эти цифры нигде не
              показывались, только нарратив. meta.deltas — то, что реально уже применилось. */}
          {(() => {
            const already = Object.entries(meta?.deltas || {}).filter(([, v]) => v !== 0);
            if (already.length === 0) return null;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid #3a1515" }}>
                {already.map(([k, v]) => (
                  <span key={k} className="mono-font" style={{ fontSize: 10.5, color: v > 0 ? "#7fae93" : "#e09090" }}>
                    {statLabel(k, ALL_STAT_LABELS[k] || STAT_RU[k] || k)}: {v > 0 ? "+" : ""}{v}
                  </span>
                ))}
              </div>
            );
          })()}
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

        {/* Советник — для экрана Украины */}
        {!effectResult && (
          <div style={{ background: "#141c14", border: "1px solid #2a4020", borderLeft: "3px solid #4a7a3a", borderRadius: 6, padding: "10px 14px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 8, color: "#4a7a3a", marginBottom: 5, letterSpacing: "0.12em" }}>👤 СОВЕТНИК</div>
            <div className="doc-font" style={{ fontSize: 12.5, color: "#a8c8a0", lineHeight: 1.5, marginBottom: 8 }}>{uaAdvisor.reasoning}</div>
            {uaAdvisor.recOption && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#4a7a3a" }}>РЕКОМЕНДУЮ:</span>
                <span className="doc-font" style={{ fontSize: 11.5, color: "#7fae93", fontStyle: "italic" }}>«{uaAdvisor.recOption.label}»</span>
              </div>
            )}
          </div>
        )}

        {/* Варианты ответа */}
        {!effectResult && (
          <>
            <div className="mono-font" style={{ fontSize: 9, color: "#7a4040", marginBottom: 10, letterSpacing: "0.08em" }}>ВЫБЕРИТЕ ОТВЕТНЫЕ МЕРЫ:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {responses.map((r, i) => {
                const isRec = r.type === uaAdvisor.rec;
                return (
                  <button
                    key={i}
                    onClick={() => handleChoice(r.type, meta?.type)}
                    disabled={choosing}
                    style={{ background: isRec ? "#1a2010" : "#1a0e0e", border: `1px solid ${isRec ? "#3a6a2a" : "#3a1a1a"}`, borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13.5, color: choosing ? "#4a3030" : "#e8d8d8", cursor: choosing ? "default" : "pointer", textAlign: "left", lineHeight: 1.45, position: "relative" }}
                    onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#a8313a")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = isRec ? "#3a6a2a" : "#3a1a1a")}
                  >
                    <span style={{ color: "#a8313a", marginRight: 8 }}>{i + 1}.</span>{r.label}
                    {isRec && <span className="mono-font" style={{ position: "absolute", top: 6, right: 8, fontSize: 7, color: "#4a7a3a", background: "#0d1a08", borderRadius: 2, padding: "1px 4px" }}>★ советник</span>}
                    <UaResponsePreviewLine responseType={r.type} />
                  </button>
                );
              })}
              <button
                onClick={() => handleChoice("accept", meta?.type)}
                disabled={choosing}
                style={{ background: "none", border: "1px solid #2a1a1a", borderRadius: 5, padding: "10px 14px", fontFamily: "'PT Serif',serif", fontSize: 13, color: "#6a4040", cursor: choosing ? "default" : "pointer", textAlign: "left" }}
                onMouseEnter={e => !choosing && (e.currentTarget.style.borderColor = "#6a3030")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a1a1a")}
              >
                Принять ситуацию и продолжить курс
                <UaResponsePreviewLine responseType="accept" muted />
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
  ally_trust: "Доверие союзников", isolation: "Изоляция",
  elite_satisfaction: "Элиты", corruption: "Коррупция", middle_class: "Средний класс", lower_class_mood: "Народ",
  treasury: "Казна", peace_progress: "Мирный трек",
  donetsk_control: "Контроль Донецка", luhansk_control: "Контроль Луганска",
  zaporizhzhia_control: "Контроль Запорожья", kherson_control: "Контроль Херсона", kharkiv_control: "Контроль Харькова",
  military_streak: "Воен. стрик",
  ua_army: "Армия ВСУ", ua_west_support: "Поддержка Запада", ua_morale: "Боевой дух ВСУ",
};

// Группировка дельт превью по подкатегориям (Петя, 2026-07-05: "много полей в прогнозе — можно
// разбить на подкатегории?"). Переиспользует ТУ ЖЕ группировку, что уже есть в SUBSTAT_META
// (economy/military/diplomacy/stability/approval — там суб-статы уже привязаны к своему базовому
// стату для вкладки "Показатели"), просто раньше в превью дельты шли одним плоским потоком.
const DELTA_GROUPS = [
  { key: "economy",   label: "Экономика",  stats: ["economy", "gdp_growth", "employment", "inflation", "reserves", "treasury"] },
  { key: "military",  label: "Военные",    stats: ["military", "army_morale", "equipment", "readiness", "veterans", "donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"] },
  { key: "diplomacy", label: "Дипломатия", stats: ["diplomacy", "ally_trust", "isolation", "peace_progress"] },
  { key: "stability", label: "Стабильность", stats: ["stability"] },
  { key: "approval",  label: "Общество",   stats: ["approval", "elite_satisfaction", "corruption", "middle_class", "lower_class_mood"] },
  { key: "resources", label: "Ресурсы",    stats: ["initiative"] },
  // Прямая цена для Украины от военных/тайных операций игрока (Петя, 2026-07-09: "должно быть
  // понятно, как это повлияло на Украину") — см. UA_IMPACT_FROM_PLAYER в rules-engine.js.
  { key: "ukraine",   label: "Украина",    stats: ["ua_army", "ua_morale", "ua_stability", "ua_west_support"] },
];

// Раскладывает плоский список [stat, delta] по DELTA_GROUPS + "Прочее" — общая логика для
// PreviewCard (превью указа) и EndTurnScreen (результаты хода), обе страдали от одной и той же
// "перегруженности" (Петя, 2026-07-07). Второй заход в тот же день — игрок придумал более
// простую схему взамен аккордеона по категориям: ОСНОВНЫЕ 5 статов всегда на виду с барами,
// ВСЁ остальное (субметрики/территории/казна/инициатива/мирный трек) — за ОДНИМ переключателем
// "Показать ещё N показателей", тоже барами (раньше часть рендерилась плоским текстом).
const PRIMARY_STAT_KEYS = ["economy", "military", "stability", "diplomacy", "approval"];
function partitionPrimarySecondary(deltas) {
  const primary = deltas.filter(([s]) => PRIMARY_STAT_KEYS.includes(s));
  const secondary = deltas.filter(([s]) => !PRIMARY_STAT_KEYS.includes(s) && !s.startsWith("_") && s !== "military_streak");
  return { primary, secondary };
}
// Полный рендер пункта дельты — бар для всего, включая казну (своя шкала −100..100, см.
// PreviewStatBar min/max) — раньше казна была единственным исключением с плоским текстом.
function renderStatDeltaItem(stat, delta, current) {
  if (stat === "initiative") {
    return <PreviewStatBar key="initiative" statKey="initiative" label="Инициатива" color="#9c8347" current={current?.initiative ?? 100} delta={delta} />;
  }
  if (stat === "treasury") {
    // "Казна" тут — ОЧКИ (условная стата −100..100), не деньги — добавляем рублёвый эквивалент
    // тем же курсом, что и вкладка «Казна» (TREASURY_PER_TRILLION), под баром.
    const rubHint = `${delta > 0 ? "+" : ""}₽${(delta * TREASURY_PER_TRILLION).toFixed(1)}${getLang() === "en" ? "T" : " трлн"}`;
    return (
      <div key="treasury">
        <PreviewStatBar statKey="treasury" label="Казна" color="#9c8347" current={current?.treasury ?? 52} delta={delta} min={-100} max={100} />
        <div className="mono-font" style={{ fontSize: 9, color: "#8a8fa0", marginTop: 2 }}>{rubHint}</div>
      </div>
    );
  }
  if (statMeta[stat] || EXTRA_BAR_META[stat]) {
    return <PreviewStatBar key={stat} statKey={stat} current={current?.[stat] ?? 50} delta={delta} />;
  }
  return (
    <span key={stat} className="mono-font" style={{ fontSize: 12, color: deltaColor(stat, delta) }}>
      {statLabel(stat, ALL_STAT_LABELS[stat] ?? stat)} {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}
// Основные статы всегда видны; остальное — за одним переключателем "Показать ещё N".
// showSecondary/toggleSecondary — состояние держит каждый экран сам (превью и результаты хода
// не должны шарить, раскрыт ли список у одного, когда открывается у другого).
// Второстепенные статы больше не одной общей плиткой — раскладываем по DELTA_GROUPS (та же
// таблица категорий, что раньше приводила к отдельному аккордеону), чтобы Техника/Боеготовность/
// Опыт войск оказались рядом с Армией, Рост ВВП/Занятость/Резервы — рядом с Экономикой, и т.д.
// (Петя, 2026-07-07: "статы техники, боеготовности, опыта — расположить к армии, и дальше
// растащить остальные статы к основным большим"). Внутри "Показать ещё" — не единая шапка
// категории с раскрытием (это и был старый аккордеон, от которого игрок отказался), а лёгкие
// подписи-разделители групп — сворачивать/разворачивать тут больше нечего, всё уже открыто разом.
function groupSecondaryEntries(secondary) {
  const groups = DELTA_GROUPS
    .map(g => ({ key: g.key, label: g.label, items: secondary.filter(([s]) => g.stats.includes(s)) }))
    .filter(g => g.items.length > 0);
  const groupedKeys = new Set(groups.flatMap(g => g.items.map(([s]) => s)));
  const leftover = secondary.filter(([s]) => !groupedKeys.has(s));
  return { groups, leftover };
}
function PrimarySecondaryDeltas({ deltas, current, showSecondary, toggleSecondary }) {
  const { primary, secondary } = partitionPrimarySecondary(deltas);
  if (primary.length === 0 && secondary.length === 0) {
    return <span className="mono-font" style={{ fontSize: 11, color: "#8a8472" }}>{t("delta.no_change")}</span>;
  }
  const { groups: secondaryGroups, leftover: secondaryLeftover } = groupSecondaryEntries(secondary);
  return (
    <>
      {primary.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: secondary.length > 0 ? 8 : 0 }}>
          {primary.map(([stat, delta]) => renderStatDeltaItem(stat, delta, current))}
        </div>
      )}
      {secondary.length > 0 && (
        <div>
          <button
            onClick={toggleSecondary}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: showSecondary ? 6 : 0,
            }}
          >
            <span className="mono-font" style={{ fontSize: 9, color: "#6a7080", letterSpacing: "0.06em" }}>
              {showSecondary ? t("delta.hide_details") : t("delta.show_more", { n: secondary.length })}
            </span>
            <span style={{ color: "#6a7080", fontSize: 9, transform: showSecondary ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
          </button>
          {showSecondary && (
            <div style={{ display: "grid", gap: 10 }}>
              {secondaryGroups.map(g => (
                <div key={g.key}>
                  <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{statLabel(g.key, g.label)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {g.items.map(([stat, delta]) => renderStatDeltaItem(stat, delta, current))}
                  </div>
                </div>
              ))}
              {secondaryLeftover.length > 0 && (
                <div>
                  <div className="mono-font" style={{ fontSize: 8, color: "#5a6070", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{t("delta.other")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {secondaryLeftover.map(([stat, delta]) => renderStatDeltaItem(stat, delta, current))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Разведданные по Украине — отдельная панель в StatsTab (не влияет на условия победы игрока)
const UA_STAT_META = {
  ua_army:         { label: "Армия ВСУ",          icon: Swords,   color: "#7a8fae", desc: "Боевая мощь ВСУ — растёт от западных поставок, падает от ударов" },
  ua_west_support: { label: "Поддержка Запада",   icon: Globe2,   color: "#8c6b3a", desc: "Готовность Запада поставлять оружие и деньги Киеву" },
  ua_morale:       { label: "Боевой дух ВСУ",     icon: Shield,   color: "#6b8c6b", desc: "Моральное состояние — зависит от военного баланса на фронте" },
  // "Полная симметрия" (2026-07-06) — зеркалит 5 базовых статов России для Украины. Аддитивно:
  // старые сейвы без этих полей подхватят дефолт из SUBSTAT_DEFAULTS на бэкенде (?? в рендере).
  ua_economy:   { label: "Экономика Украины", icon: Landmark,   color: "#7a9e7a", desc: "Устойчивость экономики под санкционным давлением и войной" },
  ua_diplomacy: { label: "Дипломатия Украины", icon: Globe2,     color: "#9c8347", desc: "Международная поддержка и дипломатический вес Киева" },
  ua_stability: { label: "Стабильность Украины", icon: ScrollText, color: "#8a8fa0", desc: "Внутренняя устойчивость власти — усталость от войны, единство элит" },
};
// Метрики где рост = плохо (инвертированные: красный при росте, зелёный при снижении)
const INVERTED_STATS = new Set(["corruption", "inflation", "isolation", "war_escalation_counter"]);

// Инфляция хранится как внутренний индекс давления 0–100 (стартует с 64) — это
// НЕ проценты, но цифра "64" выглядит как пугающий уровень инфляции и сбивает с толку.
// Переводим в г/г % линейно: 1 балл индекса = 1 п.п. инфляции, со сдвигом так,
// чтобы старт партии (64) совпадал с реальной инфляцией РФ на июнь 2026 (~6%).
const INFLATION_PCT_OFFSET = 58; // балл 64 (старт) → 6%
function inflationPercent(score) {
  const s = Math.max(0, Math.min(100, score ?? 64));
  return Math.max(0, s - INFLATION_PCT_OFFSET);
}
// Доля заполнения индикатора — от % (нормировано к максимуму на балле 100), а не от
// сырого балла. Иначе полоса заполняется на 64% уже при стартовых 6% инфляции и
// выглядит как "почти всё плохо".
const INFLATION_PCT_MAX = 100 - INFLATION_PCT_OFFSET; // 42% — потолок при балле 100
function inflationBarFraction(score) {
  return Math.min(100, (inflationPercent(score) / INFLATION_PCT_MAX) * 100);
}

// Рост ВВП — внутренний балл 0-100 (старт 36) переводим в правдоподобный % г/г.
// В отличие от инфляции (1 балл = 1 п.п.) наклон смягчён до 0.3 п.п./балл — иначе
// один указ (обычно двигает gdp_growth на 2-4 балла) взрывал бы % в 3-4 раза за ход.
// Старт партии (36) откалиброван на текст карточки статы ("0,6-1% г/г"). НЕ клэмпим
// снизу нулём — отрицательный рост (рецессия) реалистичен и должен быть виден как есть.
const GDP_GROWTH_PCT_BASE = 1;     // % при балле 36 (старт партии)
const GDP_GROWTH_PCT_SLOPE = 0.3;  // п.п. за 1 балл отклонения от старта
function gdpGrowthPercent(score) {
  const s = Math.max(0, Math.min(100, score ?? 36));
  return GDP_GROWTH_PCT_BASE + (s - 36) * GDP_GROWTH_PCT_SLOPE;
}

// Занятость хранится как внутренний балл "здоровья рынка труда" 0-100 (старт 74).
// Показываем как % занятых (не безработицу) — старт партии откалиброван на 95%,
// а не на фактические реальные ~97,5% РФ: если стартовать почти у потолка (100%),
// игроку сразу некуда расти визуально, хотя реальная польза для казны (налоговый
// множитель) растёт вплоть до балла 100. Небольшой запас "вверх" даёт ощущение
// прогресса без вранья про то, куда указы реально ведут экономику.
const EMPLOYMENT_PCT_BASE = 95;     // % при балле 74 (старт партии)
const EMPLOYMENT_PCT_SLOPE = 0.15;  // п.п. за 1 балл отклонения — мягче остальных (0.3),
                                     // чтобы весь диапазон 0-100 давал плавный %, не упираясь
                                     // в потолок 99% уже на середине шкалы
function employmentRatePercent(score) {
  const s = Math.max(0, Math.min(100, score ?? 74));
  return Math.max(70, Math.min(99, EMPLOYMENT_PCT_BASE + (s - 74) * EMPLOYMENT_PCT_SLOPE));
}

// Номинальный ВВП — производная величина для отображения (не хранится как стата).
// Привязана к экономике (баллы 0-100) и якорится на реальном ВВП РФ 2024-2026
// (≈₽190 трлн / ≈$2.2 трлн при курсе ≈₽80/$ и экономике-балле 50).
const GDP_NOMINAL_BASE_RUB_TRILLION = 190;
const GDP_NOMINAL_RUB_PER_POINT = 2.2;
function nominalGdpRubTrillion(economyScore) {
  const s = Math.max(0, Math.min(100, economyScore ?? 50));
  return Math.max(20, GDP_NOMINAL_BASE_RUB_TRILLION + (s - 50) * GDP_NOMINAL_RUB_PER_POINT);
}
function nominalGdpUsdTrillion(rubTrillion, usdRubRate) {
  return rubTrillion / (usdRubRate || 80);
}
// Резервы (ФНБ) — тоже балл 0-100, а не реальные деньги. Якорим линейно на
// историческом диапазоне ФНБ РФ: пик ≈₽13 трлн (февраль 2022, балл 100),
// пусто = ₽0 (балл 0). Балл 48 (старт партии) даёт ≈₽6.2 трлн — это
// примерно текущий (2025-2026) уровень ликвидной части фонда после трат
// на СВО. Никакого искусственного "бесконечного роста": балл всё так же
// зажат 0-100 в модели, просто отображается в реальных деньгах.
const RESERVES_RUB_TRILLION_PER_POINT = 0.13;
function reservesRubTrillion(score) {
  const s = Math.max(0, Math.min(100, score ?? 48));
  return s * RESERVES_RUB_TRILLION_PER_POINT;
}
function reservesUsdBillion(rubTrillion, usdRubRate) {
  return (rubTrillion * 1000) / (usdRubRate || 80);
}
// Казна — тот же принцип, что резервы выше: балл 0-100, реальные деньги для отображения.
// БАЛАНС (2026-07-04): было 0.8 — месячный доход казны (~20 очков при экономике 50)
// отображался как ≈₽16 трлн/мес (≈₽192 трлн/год) — почти весь номинальный ВВП модели
// (₽190 трлн при экономике 50, см. GDP_NOMINAL_BASE_RUB_TRILLION выше) исправно собирался
// налогами КАЖДЫЙ год, при реальной доле доходов федерального бюджета РФ к ВВП ≈18-20%.
// Приведено к тому же курсу, что и резервы — конвертация ФНБ→казна (treasury.js) двигает
// одни и те же рубли между двумя пулами очков, курс обязан совпадать, иначе конвертация
// физически создаёт/уничтожает деньги. Держать в синхроне с backend/src/rules/rules-engine.js
// (TREASURY_PER_TRILLION) — общего модуля между backend/frontend нет.
const TREASURY_PER_TRILLION = 0.13;
// Карточки категорий («Кремль») пишут цену очками ("15 иниц. / 3 казны") — игрок явно видит
// эту цену перед выбором, поэтому после пересчёта курса казны (см. выше) стоит явно показать
// и реалистичный рублёвый эквивалент рядом, а не только очки. Мелкие действия (разведка,
// переговоры) теперь честно уходят в млрд, а не трлн — раньше по курсу 0.8 казалось, что даже
// разведоперация стоит триллионы.
function formatCategoryCost(costStr) {
  if (!costStr) return costStr;
  const m = costStr.match(/(\d+(?:\.\d+)?)\s*казны/);
  if (!m) return costStr;
  const rubT = parseFloat(m[1]) * TREASURY_PER_TRILLION;
  const rubLabel = rubT >= 1 ? `≈₽${rubT.toFixed(1)} трлн` : `≈₽${Math.round(rubT * 1000)} млрд`;
  return `${costStr} (${rubLabel})`;
}
// Общий форматтер для substat-карточек (инфляция/ВВП/занятость показываются в %,
// остальное — сырым баллом 0-100). Используется во всех местах, где рендерятся substats.
function formatSubstatValue(key, value) {
  if (key === "inflation") return `${inflationPercent(value).toFixed(1)}% г/г`;
  if (key === "gdp_growth") { const p = gdpGrowthPercent(value); return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`; }
  if (key === "employment") return `${employmentRatePercent(value).toFixed(1)}%`;
  if (key === "reserves") return `₽${reservesRubTrillion(value).toFixed(1)} трлн`;
  // БАЛАНС (2026-07-04): было "X/100 (CPI)" — читалось как процент/доля бара, но бар везде
  // рисуется от сырого 0-100 балла (см. Bar value={s.value} в substat-карточках), а не от CPI
  // (сжат в реалистичный диапазон 10-46, см. corruptionCpiEquivalent). При балле 55 бар был
  // заполнен наполовину, а рядом стояло «26/100» — выглядело как рассинхрон. CPI — не доля
  // бара, а отдельная реалистичная оценка по методике Transparency International.
  if (key === "corruption") return `CPI ${corruptionCpiEquivalent(value)}`;
  return value;
}
function deltaColor(stat, delta) {
  if (delta === 0) return "#5a6070";
  const bad = INVERTED_STATS.has(stat) ? delta > 0 : delta < 0;
  return bad ? "#e09090" : "#7fae93";
}

// Тип политики: программа / реформа / указ
const POLICY_CATEGORY = {
  operation: { label: "ВОЕННАЯ ОПЕРАЦИЯ", color: "#a8313a", section: "ОПЕРАЦИИ", hint: "боевая операция, не указ" },
  program: { label: "ПРОГРАММА", color: "#9c7ab0", section: "ПРОГРАММЫ", hint: "крупная многолетняя программа" },
  reform:  { label: "РЕФОРМА",  color: "#3a8a7a", section: "РЕФОРМЫ",  hint: "системная реформа" },
  decree:  { label: "УКАЗ",     color: "#5b6b8c", section: "УКАЗЫ",    hint: "оперативный указ" },
};
const POLICY_CATEGORY_ORDER = ["operation", "program", "reform", "decree"];

// "↑↑ Армия, ↑ Готовность" — что вырастет при успехе
function boostStrings(effectStats) {
  if (!effectStats) return [];
  return Object.entries(effectStats).map(([k, mag]) => {
    const arrows = "↑".repeat(Math.max(1, Math.min(3, Math.abs(mag || 1))));
    return `${arrows} ${statLabel(k, ALL_STAT_LABELS[k] || k)}`;
  });
}
// Последствия отмены: [{label, delta, good}]
function penaltyEntries(cancelPenalty) {
  if (!cancelPenalty) return [];
  return Object.entries(cancelPenalty).map(([k, v]) => {
    // Для инфляции/изоляции/коррупции рост = плохо
    const inverse = ["inflation", "isolation", "corruption"].includes(k);
    const good = inverse ? v < 0 : v > 0;
    return { label: statLabel(k, ALL_STAT_LABELS[k] || k), delta: v, good };
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

// ЧЕСТНЫЙ прогноз давления на экономику: с тех пор как RULES_TABLE перестала бить по economy
// напрямую у военных/дипломатии/шпионажа/большинства указов (см. rules-engine.js), их влияние
// на экономику идёт ТОЛЬКО через gdp_growth/employment/казну — а это невидимо там, где игрок
// видит только итоговые дельты: превью до подписи ("Армия +3, Рост ВВП −2" без намёка, что это
// значит для экономики) И экран результатов после подписи ("Экономика 52 → 52" серым, будто война
// вообще не задела экономику). Считаем по ТЕМ ЖЕ формулам и делителям, что бэкенд (turns.js,
// секции "РОСТ ВВП → ЭКОНОМИКА" / "ЗАНЯТОСТЬ → ЭКОНОМИКА" / "СПИРАЛЬ КАЗНА") от РЕАЛЬНЫХ статов —
// не гадаем число, а честно показываем, во что переведётся ЭТО отклонение в конце месяца, если
// продержится (округление то же самое). Общая функция для PreviewCard и EndTurnScreen — одно
// место дублирования формулы вместо двух.
// БАЛАНС (2026-07-04): раньше канал добавлялся в notes ТОЛЬКО если задержанный эффект
// (округлённая "корзина" 0-100→целое число вклада в экономику) менял значение В ЭТОТ ХОД —
// если делта была маленькой и не перетягивала через границу корзины (типично: рост ВВП −2,
// занятость −1 за один ход), заметка не появлялась вообще, и игрок видел "Экономика 57" без
// единого намёка, что она вообще-то тихо подтачивается — именно это заметил игрок ("экономика
// не показывает минус, хотя должна"). Теперь показываем ТЕКУЩИЙ (после этого хода) вклад канала
// всегда, когда он ненулевой — не только на ходу, где сама корзина сдвинулась. Это честнее:
// постоянное скрытое давление на экономику должно быть видно каждый ход, а не только в момент
// пересечения порога.
function computeEconomyForecastNotes(beforeStats, statDeltas) {
  const notes = {};
  const economyNow = beforeStats?.economy ?? 50;

  const gdpDelta = statDeltas?.gdp_growth ?? 0;
  {
    const before = beforeStats?.gdp_growth ?? 36;
    const after = Math.max(0, Math.min(100, before + gdpDelta));
    // Стагнация/спад ВВП (Петя, 2026-07-05, добавлено в backend/turns.js в тот же день) —
    // отдельный канал поверх обычного компаундинга: рост ≤1% г/г — это уже штраф, не ноль.
    // Раньше этот файл не обновили вместе с бэкендом — прогноз в превью не совпадал с тем,
    // что реально применится в конце месяца.
    const gdpEffectRaw = (v) => {
      const pct = 1 + (v - 36) * 0.3;
      const compound = Math.round((v - 36) / 8);
      const stagnation = pct <= 1 ? Math.min(-1, Math.round((pct - 1) / 2)) : 0;
      return compound + stagnation;
    };
    const effBefore = gdpEffectRaw(before);
    const effAfter = gdpEffectRaw(after);
    if (effAfter !== 0 || effBefore !== 0) notes.gdp_growth = { before: effBefore, after: effAfter };
  }
  const emplDelta = statDeltas?.employment ?? 0;
  {
    const before = beforeStats?.employment ?? 74;
    const after = Math.max(0, Math.min(100, before + emplDelta));
    const effBefore = Math.round((before - 74) / 10);
    const effAfter = Math.round((after - 74) / 10);
    if (effAfter !== 0 || effBefore !== 0) notes.employment = { before: effBefore, after: effAfter };
  }
  const treasuryDelta = statDeltas?.treasury ?? 0;
  {
    const before = beforeStats?.treasury ?? 52;
    const after = Math.max(-100, Math.min(100, before + treasuryDelta));
    const treasuryEffect = (t) => t < 0 ? -2 : t < 15 ? -1 : (t > 65 && economyNow < 82) ? 1 : 0;
    const effBefore = treasuryEffect(before);
    const effAfter = treasuryEffect(after);
    if (effAfter !== 0 || effBefore !== 0) notes.treasury = { before: effBefore, after: effAfter };
  }
  // БАЛАНС (2026-07-04): раньше прогноз показывал только 3 из ~9 реальных каналов, которыми
  // economy двигается на end-month (см. turns.js) — военные и инфляционные эффекты были
  // невидимы игроку ДО хода, хотя они не менее реальны. Добавлены два детерминированных канала,
  // завязанных на конкретный стат (как и выше) — те же формулы, что в turns.js:
  // ВПК/военное бремя (military) и инфляционный шторм (inflation). Ставку ЦБ и "организационный
  // рост" (мирный дивиденд) сюда не добавляем — это автономные месячные эффекты, не завязанные
  // на дельту ОДНОГО конкретного хода, прогнозировать их по одному указу не получится честно.
  const milDelta = statDeltas?.military ?? 0;
  {
    const before = beforeStats?.military ?? 50;
    const after = Math.max(0, Math.min(100, before + milDelta));
    const milEconEffect = (m) => m > 80 ? -(Math.floor((m - 80) / 10) + 1) : m >= 50 ? Math.floor((m - 50) / 15) : 0;
    const effBefore = milEconEffect(before);
    const effAfter = milEconEffect(after);
    if (effAfter !== 0 || effBefore !== 0) notes.military = { before: effBefore, after: effAfter };
  }
  const inflDelta = statDeltas?.inflation ?? 0;
  {
    const before = beforeStats?.inflation ?? 64;
    const after = Math.max(0, Math.min(100, before + inflDelta));
    const inflEconEffect = (i) => i > 73 ? -Math.min(3, Math.floor((i - 73) / 10) + 1) : 0;
    const effBefore = inflEconEffect(before);
    const effAfter = inflEconEffect(after);
    if (effAfter !== 0 || effBefore !== 0) notes.inflation = { before: effBefore, after: effAfter };
  }
  // Суммарный прогноз по ВСЕМ каналам сразу (Петя, 2026-07-05: "включить экономику в список
  // эффектов после действия, пояснить, что это не напрямую от действия, а от побочных эффектов") —
  // раньше это пояснение пряталось мелким текстом ПОД каждым отдельным статом (ВВП/занятость/...),
  // легко было не заметить, что экономика вообще собирается двигаться. Один явный итог.
  const channels = Object.values(notes);
  if (channels.length > 0) {
    notes.total = {
      before: channels.reduce((s, n) => s + n.before, 0),
      after: channels.reduce((s, n) => s + n.after, 0),
    };
  }
  return notes;
}
function fmtEcoEffect(n) { return `${n > 0 ? "+" : ""}${n}`; }
// note.before/after теперь могут совпадать (канал уже был смещён от базы ДО этого хода, этот ход
// его не сдвинул дальше через границу корзины) — тогда "X → X/мес" выглядит как опечатка, а не
// как "не изменилось". Отдельная формулировка для этого случая.
function fmtEcoNote(note) {
  if (note.before === note.after) return `сейчас: ${fmtEcoEffect(note.after)}/мес`;
  return `${fmtEcoEffect(note.before)} → ${fmtEcoEffect(note.after)}/мес`;
}

// Мини-бар с "призраком" прогноза: текущее значение сплошной заливкой, изменение —
// полупрозрачной полосой поверх до проектной отметки (тонкая линия = где окажется стата
// после подтверждения). Наглядно показывает "какие будут изменения" прямо на шкале,
// а не только числом рядом.
function PreviewStatBar({ statKey, current, delta, label, color, inverted: invertedProp, min = 0, max = 100 }) {
  // label/color — необязательный оверрайд для ключей вне statMeta/EXTRA_BAR_META (напр.
  // "initiative" — та же шкала 0-100, что и у 5 базовых статов, но не входит в statMeta, чтобы не
  // попасть в основную сетку статов на вкладке «Показатели» — это расходуемый ресурс хода, а не
  // национальная стата). EXTRA_BAR_META — субметрики/территории/мирный трек (см. выше), они тоже
  // 0-100, но раньше рисовались только плоским текстом — игрок попросил бары и для них тоже.
  // min/max — для "Казны" (шкала −100..100, не 0-100, как у остальных) — тоже получила бар
  // (Петя, 2026-07-07: "и всё с барами").
  const extraMeta = EXTRA_BAR_META[statKey];
  const meta = statMeta[statKey] || extraMeta || (label ? { label, color: color || "#8a8fa0", inverted: !!invertedProp } : null);
  if (!meta) return null;
  const inverted = !!meta.inverted;
  const projected = Math.max(min, Math.min(max, current + delta));
  const good = inverted ? delta < 0 : delta > 0;
  const toPct = (v) => ((v - min) / (max - min)) * 100;
  const lo = toPct(Math.min(current, projected));
  const hi = toPct(Math.max(current, projected));
  return (
    <div style={{ minWidth: 130, flex: "1 1 130px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span className="mono-font" style={{ fontSize: 9.5, color: "#8a8fa0" }}>{statLabel(statKey, meta.label)}</span>
        <span className="mono-font" style={{ fontSize: 10.5, fontWeight: 700, color: good ? "#7fae93" : "#c47a7a" }}>
          {current}→{projected} ({delta > 0 ? "+" : ""}{delta})
        </span>
      </div>
      <div style={{ position: "relative", height: 7, background: "#2a3040", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${lo}%`, background: meta.color }} />
        <div style={{ position: "absolute", left: `${lo}%`, top: 0, height: "100%", width: `${hi - lo}%`, background: good ? "#7fae9377" : "#c47a7a77" }} />
        <div style={{ position: "absolute", left: `${toPct(projected)}%`, top: -1, width: 2, height: 9, background: "#ece7d8" }} />
      </div>
    </div>
  );
}

function PreviewCard({ preview, currentStats, onConfirm, onCancel, confirming, gameId, onObjectionWithdrawn }) {
  if (!preview) return null;

  const [objection, setObjection] = useState(preview.advisorObjection || null);
  const [arguing, setArguing] = useState(false);
  const [argumentText, setArgumentText] = useState("");
  const [advisorReply, setAdvisorReply] = useState(null);
  const [sendingArg, setSendingArg] = useState(false);
  const [revisedNote, setRevisedNote] = useState(null);
  // Второстепенные показатели скрыты по умолчанию (Петя, 2026-07-07: "основные метрики, и по
  // клику — побочные, и всё с барами") — 5 базовых статов всегда на виду, остальное за одним
  // переключателем, см. PrimarySecondaryDeltas.
  const [showSecondary, setShowSecondary] = useState(false);

  const deltas = Object.entries(preview.statDeltasPreview || {}).filter(([, d]) => d !== 0);
  const econNotes = computeEconomyForecastNotes(currentStats, preview.statDeltasPreview);

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
        {econNotes.total && (
          <div style={{ background: "#161b26", border: `1px solid ${econNotes.total.after < 0 ? "#4a2a2a" : econNotes.total.after > 0 ? "#2a4a30" : "#2a3040"}`, borderRadius: 4, padding: "7px 10px", marginBottom: 10 }}>
            <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: econNotes.total.after < 0 ? "#c47a7a" : econNotes.total.after > 0 ? "#7fae93" : "#8a8fa0" }}>
              Экономика: {fmtEcoNote(econNotes.total)}
            </span>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8fa0", marginTop: 2 }}>
              ⤷ это не прямой эффект указа — экономика отреагирует с лагом через ВВП, занятость, армию и инфляцию (детали ниже)
            </div>
          </div>
        )}
        {/* Пояснение про лаг ("на экономику подействует не сразу...") сказано один раз выше
            (econNotes.total) — не повторяется под каждым статом ниже, это и было главным
            источником "перегруженности" (Петя, 2026-07-07). */}
        <PrimarySecondaryDeltas deltas={deltas} current={currentStats} showSecondary={showSecondary} toggleSecondary={() => setShowSecondary(v => !v)} />
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

// Раскрытие тайной операции (covert_*) — показывается ПОСЛЕ подтверждения хода,
// никогда в preview (см. backend revealCovertOutcome). Игрок узнаёт исход только
// когда решение уже необратимо, поэтому подано как отдельный, весомый блок.
function CovertOutcomeReveal({ exposed }) {
  const color = exposed ? "#c0453a" : "#7fae93";
  const bg = exposed ? "#1c0e0c" : "#0d1a10";
  const border = exposed ? "#4a2420" : "#2a4030";
  return (
    <div className="covert-reveal-pop" style={{ background: bg, border: `1px solid ${border}`, borderLeft: `3px solid ${color}`, borderRadius: 4, padding: "10px 12px", marginBottom: 12 }}>
      <style>{`
        @keyframes covertRevealPop { 0% { opacity: 0; transform: scale(0.96) translateY(-4px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .covert-reveal-pop { animation: covertRevealPop 0.35s ease-out; }
      `}</style>
      <div className="mono-font" style={{ fontSize: 9, color, letterSpacing: "0.1em", marginBottom: 4 }}>
        🕵 ИСХОД ТАЙНОЙ ОПЕРАЦИИ
      </div>
      <div className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: exposed ? "#e0847a" : "#a0c090", marginBottom: exposed ? 4 : 0 }}>
        {exposed ? "ОПЕРАЦИЯ РАСКРЫТА" : "ОПЕРАЦИЯ ОСТАЛАСЬ В ТЕНИ"}
      </div>
      {exposed && (
        <div className="doc-font" style={{ fontSize: 12, color: "#c09088", lineHeight: 1.5 }}>
          Причастность вскрылась — дипломатический скандал неизбежен. Дополнительный удар по дипломатии и стабильности уже применён к статам.
        </div>
      )}
    </div>
  );
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
  defeat_military_collapse: "ФРОНТ РУХНУЛ",
  defeat_donbass_lost:      "ДОНБАСС ОТБИТ",
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
      {(stats?.military ?? 100) < 35 && (
        <div style={{ marginTop: 4, padding: "4px 8px", background: "#3a1515", borderRadius: 3, fontSize: 10.5, color: "#ef9a9a" }}>
          ⚠ Армия небоеспособна — угроза развала фронта (&lt;30)
        </div>
      )}
      {((stats?.donetsk_control ?? 100) < 55 || (stats?.luhansk_control ?? 100) < 55) && (
        <div style={{ marginTop: 4, padding: "4px 8px", background: "#3a1515", borderRadius: 3, fontSize: 10.5, color: "#ef9a9a" }}>
          ⚠ ВСУ теснят фронт в Донбассе — поражение при Донецке и Луганске ниже 40%
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

// Только у Донецка и Луганска есть порог поражения — оба ниже одновременно = ВСУ отбили Донбасс
// (см. detectGameOutcome в backend/turns.js, defeat_donbass_lost)
const TERRITORY_DEFEAT_FLOOR = { donetsk_control: 40, luhansk_control: 40 };

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
            const floor = TERRITORY_DEFEAT_FLOOR[key];
            const belowFloor = floor != null && pct < floor;
            const nearFloor = floor != null && !belowFloor && pct < floor + 15;
            const color = belowFloor ? "#c03030" : territoryColor(pct, req);
            const meetsReq = pct >= req;
            return (
              <div key={key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ color: "#7a8090", fontSize: 11 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {floor != null && <span style={{ fontSize: 10, color: "#6a4040" }}>поражение &lt;{floor}%</span>}
                    <span style={{ fontSize: 10, color: "#3a4050" }}>цель {req}%</span>
                    <span style={{ color, fontWeight: 700, fontSize: 11 }}>{Math.round(pct)}%{meetsReq ? " ✓" : ""}</span>
                  </div>
                </div>
                <div style={{ background: "#0e0e14", borderRadius: 2, height: 4, overflow: "hidden", position: "relative" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${req}%`, width: 1, height: "100%", background: "#4a5878" }} />
                  {floor != null && (
                    <div style={{ position: "absolute", top: 0, left: `${floor}%`, width: 1, height: "100%", background: "#a8313a" }} />
                  )}
                </div>
                {belowFloor && (
                  <div style={{ marginTop: 2, fontSize: 9.5, color: "#e09090" }}>⚠ ниже порога поражения</div>
                )}
                {nearFloor && (
                  <div style={{ marginTop: 2, fontSize: 9.5, color: "#9c8347" }}>приближается к порогу поражения</div>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 4, fontSize: 10, color: "#3a4050", lineHeight: 1.4 }}>
            Военная победа: Донецк+Луганск по 100% и ещё 2 региона выше цели · Бездействие отдаёт территории<br/>
            Поражение: Донецк и Луганск оба ниже 40% одновременно — ВСУ отбили Донбасс (риск растёт при слабой армии)
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- EndGameScreen ----------
// Приглушённая, десатурированная палитра — вайб премиального политического триллера
// (House of Cards / "24"), не мобильная игра-ачивка. Ни один цвет не "светится".
const OUTCOME_COLORS = {
  victory:          { bg: "#0d1611", border: "#4f7d5c", title: "#c3d6c8" },
  victory_military: { bg: "#0c1220", border: "#4a6690", title: "#c3cede" },
  victory_combined: { bg: "#0c1917", border: "#3f7a72", title: "#bdd6d2" },
  partial_peace:    { bg: "#10160c", border: "#6a8047", title: "#cdd6bd" },
  partial:          { bg: "#181307", border: "#8a7346", title: "#d6c9a8" },
  partial_military: { bg: "#0e1220", border: "#5b6690", title: "#c3c9de" },
  defeat_time:      { bg: "#170f05", border: "#8a5a28", title: "#d6b385" },
  defeat_coup:      { bg: "#170707", border: "#8a3a3d", title: "#d9a3a3" },
  defeat_collapse:  { bg: "#170707", border: "#8a3a3d", title: "#d9a3a3" },
  defeat_unrest:    { bg: "#170707", border: "#8a3a3d", title: "#d9a3a3" },
  defeat_isolation: { bg: "#150710", border: "#7a4a80", title: "#cdb0d1" },
  defeat_war:       { bg: "#170905", border: "#8a4a2e", title: "#d6a685" },
  defeat_military_collapse: { bg: "#170707", border: "#8a3a3d", title: "#d9a3a3" },
  defeat_donbass_lost:      { bg: "#170707", border: "#8a3a3d", title: "#d9a3a3" },
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

  // Та же палитра/структура, что на стартовом экране (main.jsx StartScreen) — Петя явно
  // одобрил её цвета (тёмно-синий #1a1f2c + кремовый текст + золотой акцент #9c8347) и
  // спросил, почему не переиспользовать. Исходный цвет акцента заменён на colors.border,
  // чтобы сохранить смысловую окраску исхода (зелёный/красный/т.д.), сам каркас — идентичен.
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, background: "#1a1f2c",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
      overflowY: "auto",
    }}>
      <div style={{
        width: "100%", background: "linear-gradient(180deg,#0f1318 0%,#1a1f2c 100%)",
        borderBottom: `2px solid ${colors.border}`, padding: "32px 20px 24px", textAlign: "center",
      }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.2em", color: colors.border, marginBottom: 10 }}>
          {isVictory ? "ИТОГ ПРАВЛЕНИЯ" : "ИГРА ОКОНЧЕНА"}
        </div>
        <div className="doc-font" style={{ margin: "0 0 6px", fontSize: 32, fontWeight: 700, letterSpacing: "0.02em", color: "#ece7d8", textTransform: "uppercase" }}>
          {outcomeTitle}
        </div>
        <div className="mono-font" style={{ fontSize: 11, color: "#5a6070", letterSpacing: "0.08em" }}>
          дело № {(gameId || "").slice(0, 8).toUpperCase()} · ход {turn}/24
        </div>
      </div>

      {legacy?.verdict && (
        <div className="doc-font" style={{ maxWidth: 700, textAlign: "center", fontSize: 15, color: "#9a9a9e", lineHeight: 1.6, fontStyle: "italic", margin: "24px 20px 0" }}>
          "{legacy.verdict}"
        </div>
      )}

      {loading && (
        <div style={{ color: "#555", fontFamily: "monospace", fontSize: 13, margin: "30px 20px 0" }}>
          Хроникёр составляет летопись…
        </div>
      )}

      {legacy && (
        <div style={{ maxWidth: 720, width: "100%", padding: "24px 20px 0", display: "flex", flexDirection: "column", gap: 20 }}>
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

      {/* Stats summary — та же карточка, что "quote box" на стартовом экране (#1f2733/#2a3040),
          приглушённые (не мультяшно-яркие) semantic-цвета вместо пастельного зелёного/жёлтого/красного */}
      <div style={{ maxWidth: 720, width: "100%", padding: "24px 20px 0", display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { label: "Экономика", key: "economy" },
          { label: "Армия", key: "military" },
          { label: "Стабильность", key: "stability" },
          { label: "Дипломатия", key: "diplomacy" },
          { label: "Рейтинг", key: "approval" },
          { label: "Мирный трек", key: "peace_progress" },
        ].map(s => {
          const val = stats?.[s.key] ?? 0;
          const clr = val >= 65 ? "#8ba88f" : val >= 40 ? "#c2a06a" : "#b57b7b";
          return (
            <div key={s.key} style={{
              background: "#1f2733", border: "1px solid #2a3040", borderLeft: `3px solid ${colors.border}`,
              borderRadius: 4, padding: "10px 16px", textAlign: "center", minWidth: 90,
            }}>
              <div className="doc-font" style={{ fontSize: 18, fontWeight: 700, color: clr }}>{val}</div>
              <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 32, marginBottom: 40 }}>
        <button onClick={onRestart} style={{
          background: colors.border, color: "#14181f", border: "none", borderRadius: 4,
          padding: "11px 30px", fontSize: 14, fontWeight: 700, cursor: "pointer",
          fontFamily: "'PT Serif',serif", letterSpacing: 1,
        }}>
          НОВАЯ ПАРТИЯ
        </button>
      </div>
    </div>
  );
}

// Содержимое окна подтверждения перед перегруппировкой/передышкой — та же информация, что в
// Ликбезе (СПЕЦИАЛЬНЫЕ ДЕЙСТВИЯ), но показывается ПЕРЕД исполнением, а не только по запросу
// в справочнике (Петя, 2026-07-04: "пусть выскочит окно с предупреждением — что функция делает,
// и какие побочки").
const SPECIAL_ACTION_CONFIRM = {
  regroup: {
    title: "⚙ Перегруппировка",
    body: "Подтягивает снабжение и резервы, восстанавливает инициативу (+75). Главный эффект: открывает второй военный удар в этом же месяце.",
    costs: [
      "В этом месяце доступны только военные операции — указы и дипломатия недоступны.",
      "Следующий месяц боевые операции заблокированы (кроме разведки) — армия восстанавливается.",
      "Украина видит паузу и может воспользоваться ей для контратаки.",
    ],
  },
  skip: {
    title: "🏠 Гражданская передышка",
    body: "Президент занимается тылом — рейтинг, стабильность и занятость восстанавливаются.",
    costs: [
      "Военные операции в этот месяц недоступны.",
      "Пока Россия отдыхает, ВСУ восстанавливают боевой дух и личный состав — фронт не двигается в вашу пользу.",
      "Доступна не чаще 1 раза за месяц.",
    ],
  },
};

function SpecialActionConfirmModal({ kind, onConfirm, onCancel }) {
  const info = SPECIAL_ACTION_CONFIRM[kind];
  if (!info) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(13,16,22,0.85)", zIndex: 3600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1a1f2c", border: "1px solid #3a4156", borderRadius: 8, width: "min(92vw,440px)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", padding: "18px 20px" }}>
        <div className="doc-font" style={{ fontSize: 16, fontWeight: 700, color: "#ece7d8", marginBottom: 10 }}>{info.title}</div>
        <div className="doc-font" style={{ fontSize: 13.5, color: "#cdd3e0", lineHeight: 1.5, marginBottom: 12 }}>{info.body}</div>
        <div style={{ background: "#2a1f14", border: "1px solid #5a4520", borderRadius: 5, padding: "10px 12px", marginBottom: 16 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#c8a857", letterSpacing: "0.08em", marginBottom: 6 }}>ПОБОЧНЫЕ ЭФФЕКТЫ</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {info.costs.map((c, i) => (
              <li key={i} className="doc-font" style={{ fontSize: 12.5, color: "#d8b890", lineHeight: 1.45, marginBottom: 4 }}>{c}</li>
            ))}
          </ul>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "none", border: "1px solid #3a4156", borderRadius: 4, padding: "7px 16px", color: "#a8a294", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>Отмена</button>
          <button onClick={onConfirm} style={{ background: "#5a8050", border: "none", borderRadius: 4, padding: "7px 16px", color: "#fff", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

// Предупреждение министра финансов Силина (Петя, 2026-07-05: "нужны дисклеймеры от министра
// финансов, который говорит караул — сейчас нигде не сказано, что всё идёт по пизде"). Данные —
// то же economySummary, что бэкенд уже кладёт в ответ /turns/end-month (before/after/effects/
// capped) и что раньше молча уходило только в текст новости "Минэкономразвития: Итоги месяца",
// легко теряясь среди остальной ленты. Персона Силина — та же, что в advisors.js: сухой
// бухгалтер, начинает с денег, мрачный юмор, никогда не паникует явно, просто перечисляет риски.
function FinanceMinisterWarningModal({ summary, onClose }) {
  const { before, after, effects = [], capped, cap } = summary;
  const netChange = after - before;
  const critical = after <= 30; // порог поражения defeat_collapse
  const severe = after <= 35;
  const negatives = effects.filter(e => e.delta < 0).sort((a, b) => a.delta - b.delta);
  const positives = effects.filter(e => e.delta > 0);

  const heading = critical
    ? "Господин Президент, это уже не «однако необходимо учитывать» — это караул."
    : severe
    ? "Господин Президент, цифры больше не позволяют мне быть вежливым."
    : "Господин Президент, вынужден отвлечь ваше внимание от текущих дел.";

  const closing = critical
    ? "Ещё один такой месяц — и отчитываться о состоянии казны будет уже не передо мной."
    : severe
    ? "Денег на манёвр почти не осталось. Дальше — на ваше усмотрение, но я предупредил."
    : "Пока не катастрофа, но тренд явно не в нашу пользу — предпочёл сказать прямо, а не дожидаться, пока сами заметите.";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(13,16,22,0.85)", zIndex: 3700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1a1f2c", border: `1px solid ${critical ? "#8a3a3d" : "#3a4156"}`, borderRadius: 8, width: "min(94vw,480px)", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ background: "#14181f", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${critical ? "#8a3a3d" : "#9c8347"}` }}>
          <div>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: critical ? "#e09090" : "#9c8347" }}>СЛУЖЕБНАЯ ЗАПИСКА · МИНФИН</div>
            <div className="doc-font" style={{ fontSize: 14, fontWeight: 700, color: "#ece7d8", marginTop: 2 }}>Силин А.Г., министр финансов</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          <div className="doc-font" style={{ fontSize: 14, color: "#cdd3e0", lineHeight: 1.55, marginBottom: 14, fontStyle: "italic" }}>
            «{heading}»
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
            <span className="mono-font" style={{ fontSize: 22, fontWeight: 700, color: critical ? "#e09090" : severe ? "#d8a860" : "#cdd3e0" }}>
              {before} → {after}
            </span>
            <span className="mono-font" style={{ fontSize: 12, color: netChange < 0 ? "#e09090" : "#8fbf8f" }}>
              ({netChange >= 0 ? "+" : ""}{netChange} за месяц)
            </span>
          </div>

          {negatives.length > 0 && (
            <div style={{ background: "#1a0c0c", border: "1px solid #4a2020", borderRadius: 5, padding: "10px 12px", marginBottom: 10 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#e09090", letterSpacing: "0.06em", marginBottom: 6 }}>ЧТО ТЯНЕТ ВНИЗ</div>
              {negatives.map((e, i) => (
                <div key={i} className="doc-font" style={{ fontSize: 12.5, color: "#d8b0b0", lineHeight: 1.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{e.label}</span><span className="mono-font">{e.delta}</span>
                </div>
              ))}
            </div>
          )}
          {positives.length > 0 && (
            <div style={{ background: "#0c1a0f", border: "1px solid #204a2a", borderRadius: 5, padding: "10px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8fbf8f", letterSpacing: "0.06em", marginBottom: 6 }}>ЧТО ЕЩЁ ДЕРЖИТ НА ПЛАВУ</div>
              {positives.map((e, i) => (
                <div key={i} className="doc-font" style={{ fontSize: 12.5, color: "#b0d8b8", lineHeight: 1.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{e.label}</span><span className="mono-font">+{e.delta}</span>
                </div>
              ))}
            </div>
          )}
          {capped && (
            <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", fontStyle: "italic", marginBottom: 14 }}>
              Автоматические потери месяца превысили потолок в −{cap} — часть эффекта уже компенсирована, иначе было бы хуже.
            </div>
          )}

          <div className="doc-font" style={{ fontSize: 13, color: "#a8a294", lineHeight: 1.5, marginBottom: 16 }}>
            {closing}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ background: critical ? "#8a3a3d" : "#9c8347", border: "none", borderRadius: 4, padding: "8px 18px", color: "#14181f", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Принято к сведению
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App({ gameId, playerName, onNewGame, showWelcome: initialShowWelcome = false }) {
  const lang = useLang(); // ре-рендер шапки/таб-бара при переключении RU/EN
  // Баг (2026-07-08, Петя: "переключился на английский, но все новости на русском остались") —
  // переключатель языка в шапке меняет только статичные UI-строки, не games.language (то, на
  // каком языке ИИ пишет НОВЫЙ нарратив — см. languageInstruction в games.js). Синхронизируем
  // при каждой смене языка внутри партии; пропускаем самый первый рендер (initial mount не
  // должен слать запрос, только реальное переключение).
  const langMountedRef = useRef(false);
  useEffect(() => {
    if (!langMountedRef.current) { langMountedRef.current = true; return; }
    updateGameLanguage(gameId, lang);
  }, [lang, gameId]);
  const [state, setState] = useState(null);
  const [assistMode, setAssistMode] = useState("advisor"); // закреплён на старте партии: "advisor" | "hardcore"
  const [tab, setTab] = useState("overview");
  // Порядок вкладок — перетаскивание мышью, как в браузере (Петя, 2026-07-05). Храним только
  // порядок id в localStorage (не сами вкладки — их список меняется между версиями игры).
  const [tabOrder, setTabOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rp_tab_order") || "null");
      return Array.isArray(saved) ? saved : null;
    } catch { return null; }
  });
  const [draggedTabId, setDraggedTabId] = useState(null);
  const [tabDragOffset, setTabDragOffset] = useState(null); // {dx,dy} — вкладка реально едет за курсором
  // Срочный фикс (2026-07-07): onPointerDown раньше запускал drag СРАЗУ, без порога движения —
  // на обычный клик тоже успевал выставиться pointerEvents:none, и клик по вкладке до onClick
  // не долетал ("вкладки не нажимаются, только в режиме переноса"). Флаг переживает между
  // pointerdown-замыканиями одного жеста, не рендер-стейт — иначе лишние ре-рендеры на каждый px.
  const tabDragSuppressClickRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(initialShowWelcome);
  const [showFeedback, setShowFeedback] = useState(false);
  // Ликбез — отдельная кнопка в шапке (не таб в скролл-баре): всегда на виду независимо от
  // текущей вкладки, на мобильной и десктопной версии одинаково (Петя, 2026-07-04).
  const [showWiki, setShowWiki] = useState(false);
  // Подтверждение перед перегруппировкой/передышкой — раньше кнопка сразу исполняла действие,
  // игрок узнавал о побочках (блок военных операций и т.п.) постфактум из title-тултипа, который
  // на мобильных вообще не виден (Петя, 2026-07-04). null | { kind: "regroup"|"skip", action: fn }
  const [confirmSpecialAction, setConfirmSpecialAction] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [draftInput, setDraftInput] = useState("");
  const [actionMode, setActionMode] = useState("decree_fast");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [turnError, setTurnError] = useState(null);
  const [endTurnResult, setEndTurnResult] = useState(null);
  // Предупреждение Силина (Петя, 2026-07-05: "нигде не сказано, что всё идёт по пизде" —
  // экономика молча проседает, разбивка тонет в ленте новостей). Бэкенд уже отдаёт
  // economySummary в ответе /turns/end-month (before/after/effects/capped) — раньше фронтенд
  // просто ничего с этим не делал. Показываем ТОЛЬКО когда месяц реально плохой, не каждый раз.
  const [financeWarning, setFinanceWarning] = useState(null);
  const [lastActionResult, setLastActionResult] = useState(null); // результат последнего действия (не завершает ход)
  // Все решения текущего месяца (Петя, 2026-07-07: "в конце хода показан только последний
  // указ, а не все") — lastActionResult перезаписывается на каждое решение, поэтому по
  // «Завершить месяц» до сих пор долетал только самый последний. Копим отдельно, чтобы
  // на итоговом экране показать ВСЕ указы месяца, а не один.
  const [monthActions, setMonthActions] = useState([]);
  const [sessionTurnStart, setSessionTurnStart] = useState(null); // ход в начале сессии действий
  const [diplomaticReactions, setDiplomaticReactions] = useState(null);
  const [pendingNextState, setPendingNextState] = useState(null);
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const nuclearConfirmRef = useRef(false); // ref для catch-замыкания
  const [gameOutcome, setGameOutcome] = useState(null);
  const draftTextareaRef = useRef(null);
  const [nuclearConfirmError, setNuclearConfirmError] = useState(null);
  const [nuclearAftermath, setNuclearAftermath] = useState(null);

  // Расход ИИ (Петя, 2026-07-08): вместо одного вызова, возвращающего мнения всех пяти
  // советников автоматически, — состояние на каждого советника отдельно, запрос идёт только
  // по явному клику "Жду ваш совет" на конкретной карточке (см. AdvisorsTab).
  const [advisorState, setAdvisorState] = useState(() => Object.fromEntries(ADVISOR_INFO.map(a => [a.id, { status: "idle", data: null, error: null }])));
  const actionModeRef = useRef("decree_fast");

  const [showTreasuryTip, setShowTreasuryTip] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const data = await fetchGameState(gameId);
      setState(data);
      if (data.assistMode) setAssistMode(data.assistMode);
      // БАЛАНС (2026-07-04): F5-баг — games.status ("defeat_..."/"victory_...", проставляется
      // в /turns/end-month) раньше нигде не читался при обычной загрузке партии, только из
      // ответа confirm/endMonth сразу после хода, который её вызвал. Если игра уже закончилась
      // (поражение/победа) и игрок обновил страницу — партия рендерилась как активная, будто
      // ничего не произошло. Теперь при каждой загрузке состояния статус партии проверяется явно.
      if (data.status && data.status !== "active") {
        setGameOutcome(data.status);
      }
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

  // Heartbeat для индикатора "онлайн" в админке — пингуем, пока вкладка реально видима
  // (не просто открыта в фоне), раз в 25с + сразу при возврате фокуса на вкладку.
  useEffect(() => {
    function pingIfVisible() { if (document.visibilityState === "visible") pingGame(gameId); }
    pingIfVisible();
    const interval = setInterval(pingIfVisible, 25000);
    document.addEventListener("visibilitychange", pingIfVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", pingIfVisible); };
  }, [gameId]);

  // Синхронизируем ref с actionMode чтобы handleConsultAdvisor всегда читал свежее значение,
  // и сбрасываем карточки советников на "не спрошено" — старый совет был под другой масштаб
  // решения, показывать его как актуальный было бы неверно. НЕ запрашиваем автоматически:
  // раньше смена масштаба/загрузка партии/переключение вкладки сами по себе дёргали ИИ на всех
  // пятерых советников сразу — теперь только явный клик "Жду ваш совет" на конкретной карточке.
  // БАГ (Петя, 2026-07-09: "укрепил экономику по совету в первом ходу, на втором ходу тот же
  // совет висит") — эффект зависел ТОЛЬКО от actionMode, но не от смены хода/месяца. Карточка
  // с текстом рекомендации из прошлого месяца оставалась на экране нетронутой — не потому что
  // backend снова посоветовал то же самое (computeOptimalMove уже умеет не повторять недавно
  // подписанную реформу, см. ECON_REFORM_CATEGORIES в advisors.js), а потому что фронтенд просто
  // никогда не запрашивал совет заново и не убирал устаревшую карточку. Добавлен state.turn —
  // смена месяца (через /turns/end-month) сбрасывает карточки так же, как смена масштаба.
  useEffect(() => {
    actionModeRef.current = actionMode;
    setAdvisorState(Object.fromEntries(ADVISOR_INFO.map(a => [a.id, { status: "idle", data: null, error: null }])));
  }, [actionMode, state?.turn]);

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
    // Снапшот до подтверждения — нужен для отображения реального delta
    const preConfirmStats = state?.stats ? { ...state.stats } : null;
    try {
      const confirmResult = await confirmTurn(gameId);
      nuclearConfirmRef.current = false;
      setShowNuclearConfirm(false);
      const confirmedActionResult = {
        narrative: preview?.narrative,
        statDeltasPreview: preview?.statDeltasPreview,
        actionMode,
        gmActionType: preview?.gmActionType,
        statChangelog: confirmResult?.statChangelog || null,
        actualPrevStats: confirmResult?.prevStats || preConfirmStats,
        // Исход раскрытия тайной операции — известен ТОЛЬКО сейчас, после confirm
        // (см. revealCovertOutcome в rules-engine.js). undefined для не-шпионских категорий.
        covertExposed: confirmResult?.covertExposed,
      };
      setLastActionResult(confirmedActionResult);
      if (state?.multiActionTurns) setMonthActions(prev => [...prev, confirmedActionResult]);
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

    // Потом: дипломатические реакции мира (максимум 3 — остальные уже в ленте)
    const notable = (worldReactions || []).filter(r => r.text && r.source).slice(0, 3);
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
        setLastActionResult(r); setMonthActions(prev => [...prev, r]); setDraftInput(""); await loadState();
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
        setLastActionResult(r); setMonthActions(prev => [...prev, r]); setDraftInput(""); await loadState();
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
        if (res.gameOutcome) { setLastActionResult(null); setMonthActions([]); setGameOutcome(res.gameOutcome); return; }
        // Предупреждение Силина — только если месяц реально плохой (заметный спад ИЛИ уже
        // приближаемся к порогу поражения economy<30), не на каждое небольшое колебание.
        const es = res.economySummary;
        if (es && (es.after - es.before <= -2 || es.after <= 35)) {
          setFinanceWarning(es);
        }
        // Показываем обзор накопленных за месяц реакций мира / действий Украины.
        // res.statDeltas — реальный диф месяца (decay/бюджет/ставка ЦБ/Украина и т.д.), а не
        // пустышка: раньше без lastActionResult (игрок завершил месяц без единого указа) сюда
        // подставлялся {} и "Результаты хода" показывали статы плоско, без изменений, хотя
        // на самом деле за месяц многое произошло (Петя, 2026-07-07: "завершил месяц без
        // указов, и вообще ничего не произошло в статах" — на деле произошло, просто не
        // было видно).
        //
        // ВАЖНО (Петя, 2026-07-07: "показан только последний указ... непонятно куда тает
        // экономика"): раньше здесь подставлялся lastActionResult целиком — т.е. если месяц
        // содержал НЕСКОЛЬКО указов, "Результаты хода" показывали narrative И statDeltas
        // ТОЛЬКО последнего из них, полностью теряя вклад более ранних указов и реальных
        // автоэффектов месяца (ставка ЦБ, военное бремя, инфляция и т.д.) — числа на экране
        // могли не совпадать с тем, что реально произошло. Теперь statDeltasPreview/economySummary
        // берутся ТОЛЬКО из res (реальный, полный, всегда точный итог месяца), а narrative —
        // список ВСЕХ указов месяца (actions), не один последний. statChangelog (разбивка
        // указ/события ОДНОГО решения) больше не применим к месяцу из нескольких указов —
        // явно убираем, чтобы не вводить в заблуждение.
        setEndTurnResult({
          narrative: monthActions.length > 0 ? monthActions[monthActions.length - 1].narrative : `Месяц завершён. Наступает месяц ${res.nextMonth}.`,
          actions: monthActions,
          statDeltasPreview: res.statDeltas || {},
          economySummary: res.economySummary || null,
          actionMode: monthActions.length > 0 ? monthActions[monthActions.length - 1].actionMode : "decree",
          gmActionType: monthActions.length > 0 ? monthActions[monthActions.length - 1].gmActionType : undefined,
          actualPrevStats: monthActions[0]?.actualPrevStats,
          statChangelog: null,
        });
        setLastActionResult(null);
        setMonthActions([]);
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

  async function handleConsultAdvisor(advisorId, questionText) {
    if (advisorState[advisorId]?.status === "loading") return;
    const modeForThisRequest = actionModeRef.current;
    setAdvisorState(prev => ({ ...prev, [advisorId]: { status: "loading", data: null, error: null } }));
    try {
      const result = await consultAdvisor(gameId, advisorId, questionText, modeForThisRequest);
      // Если пока запрос шёл пользователь сменил масштаб решения — результат уже не актуален,
      // молча отбрасываем (карточка и так сброшена на "idle" эффектом смены actionMode).
      if (actionModeRef.current !== modeForThisRequest) return;
      setAdvisorState(prev => ({ ...prev, [advisorId]: { status: "loaded", data: result.advisor, error: null } }));
    } catch (err) {
      if (actionModeRef.current !== modeForThisRequest) return;
      setAdvisorState(prev => ({ ...prev, [advisorId]: { status: "error", data: null, error: err.message } }));
    }
  }

  // useIsMobile/useRawIsMobile ДОЛЖНЫ вызываться до любых early return — иначе на первом
  // рендере (loaded=false, ранний возврат) хуков вызывается меньше, чем на следующем
  // (loaded=true, доходит досюда), что нарушает Rules of Hooks ("Rendered more hooks than
  // during the previous render") и роняет всё приложение в белый экран без ErrorBoundary.
  const isMobile = useIsMobile();
  const rawMobile = useRawIsMobile();

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
    return <UkraineResponseScreen items={ukraineReactions.items} onDone={handleUkraineDone} gameId={gameId} gameStats={state?.stats} />;
  }

  if (diplomaticReactions) {
    return <DiplomaticResponseScreen reactions={diplomaticReactions} onRespond={handleDiplomaticRespond} onSkip={handleDiplomaticDone} gameId={gameId} gameStats={state?.stats} />;
  }

  const tabs = [
    { id: "overview", label: t("tab.overview"), icon: Globe2 },
    { id: "kremlin", label: t("tab.kremlin"), icon: KremlinStarIcon },
    { id: "treasury", label: t("tab.treasury"), icon: Landmark },
    { id: "map", label: t("tab.map"), icon: Globe2 },
    { id: "stats", label: t("tab.stats"), icon: Shield },
    { id: "world", label: t("tab.world"), icon: Globe2 },
    { id: "advisors", label: t("tab.advisors"), icon: Users },
    { id: "policies", label: t("tab.policies"), icon: FileText },
    { id: "relations", label: t("tab.relations"), icon: Landmark },
    { id: "newsfeed", label: t("tab.newsfeed"), icon: ScrollText },
    { id: "log", label: t("tab.log"), icon: ScrollText },
  ];

  // Применяем сохранённый порядок, но защищаемся от устаревшего списка id (новая вкладка
  // добавилась в игру, а в localStorage её ещё нет — просто дописываем в конец).
  const tabIds = tabs.map(t => t.id);
  const savedOrderIds = tabOrder ? tabOrder.filter(id => tabIds.includes(id)) : null;
  const missingTabIds = tabIds.filter(id => !savedOrderIds?.includes(id));
  const orderedTabIds = savedOrderIds ? [...savedOrderIds, ...missingTabIds] : tabIds;
  const orderedTabs = orderedTabIds.map(id => tabs.find(t => t.id === id));

  // fromId передаётся явно самой кнопкой (тот же фикс, что и у виджетов Казны — onUp,
  // созданный в момент pointerdown, иначе замыкается на handleTabDrop ТОГО рендера, где
  // draggedTabId ещё не обновился, и на pointerup читает устаревшее значение).
  function handleTabDrop(fromId, overId) {
    if (!fromId || !overId || fromId === overId) { setDraggedTabId(null); return; }
    const ids = orderedTabs.map(t => t.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(overId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    setTabOrder(ids);
    localStorage.setItem("rp_tab_order", JSON.stringify(ids));
    setDraggedTabId(null);
  }

  // Драг вкладок за счёт pointer-событий (не нативный HTML5 draggable) — вкладка визуально
  // едет за курсором, цель определяется через elementsFromPoint на отпускании (та же схема,
  // что и у виджетов Казны — см. WidgetCard).
  function handleTabPointerDown(e, tabId) {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const isTouch = e.pointerType === "touch";
    const targetEl = e.currentTarget;
    let dragStarted = false;
    let cancelled = false;
    // На тач-устройствах бар вкладок в первую очередь листают свайпом (overflow-x: auto) —
    // обычное движение пальца должно скроллить, а не сразу хватать вкладку для переноса.
    // Поэтому drag на touch стартует только после короткого удержания на месте (long-press),
    // а не от первого же движения, как на мыши (там конфликта со скроллом нет). Пока long-press
    // не сработал, у кнопки touch-action: pan-x (см. style ниже) — палец свободно скроллит бар.
    // В момент активации drag временно переключаем на touch-action: none — иначе браузер может
    // перехватить последующее горизонтальное движение как нативный скролл и оборвать drag на полпути.
    const longPressTimer = isTouch ? setTimeout(() => {
      if (!cancelled) {
        dragStarted = true;
        targetEl.style.touchAction = "none";
        setDraggedTabId(tabId);
      }
    }, 350) : null;
    function onMove(ev) {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!dragStarted) {
        if (isTouch) {
          // Палец сдвинулся раньше срабатывания long-press — это скролл, не drag:
          // отменяем таймер и полностью выходим, оставляя жест браузеру.
          if (dist > 6) { cancelled = true; clearTimeout(longPressTimer); onUp(ev); }
          return;
        }
        // Порог движения — 6px — прежде чем реально войти в режим drag (см. коммент выше).
        // Обычный клик (мышь не сдвинулась) не трогает draggedTabId/pointerEvents вообще.
        if (dist < 6) return;
        dragStarted = true;
        setDraggedTabId(tabId);
      }
      setTabDragOffset({ dx: ev.clientX - startX, dy: ev.clientY - startY });
    }
    function onUp(ev) {
      clearTimeout(longPressTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setTabDragOffset(null);
      if (isTouch) targetEl.style.touchAction = "pan-x";
      if (!dragStarted) return; // обычный клик/скролл — пусть onClick сам переключит вкладку
      tabDragSuppressClickRef.current = true;
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .find(el => el.dataset && el.dataset.tabId && el.dataset.tabId !== tabId);
      handleTabDrop(tabId, hit ? hit.dataset.tabId : null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

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
        <WelcomeModal state={state} playerName={playerName} assistMode={assistMode} onClose={() => setShowWelcome(false)} onOpenWiki={() => setShowWiki(true)} />
      )}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} gameId={gameId} />}
      {showWiki && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,16,22,0.9)", zIndex: 3500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowWiki(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#f5f1e6", borderRadius: 8, width: "min(95vw,760px)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
            <div style={{ position: "sticky", top: 0, background: "#1a1f2c", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
              <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#c8a857" }}>ЛИКБЕЗ</span>
              <button onClick={() => setShowWiki(false)} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "18px 20px 24px" }}>
              <WikiTab />
            </div>
          </div>
        </div>
      )}
      {confirmSpecialAction && (
        <SpecialActionConfirmModal
          kind={confirmSpecialAction.kind}
          onCancel={() => setConfirmSpecialAction(null)}
          onConfirm={() => { const a = confirmSpecialAction.action; setConfirmSpecialAction(null); a(); }}
        />
      )}
      {financeWarning && (
        <FinanceMinisterWarningModal summary={financeWarning} onClose={() => setFinanceWarning(null)} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');
        @import url('https://cdnjs.cloudflare.com/ajax/libs/flag-icons/7.2.3/css/flag-icons.min.css');
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
            <h1 className="doc-font" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.04em", color: isNuclearWorld ? "#e88080" : "#ece7d8" }}>REALPOLITIK</h1>
            <div className="mono-font" style={{ fontSize: 11, color: isNuclearWorld ? "#9a5050" : "#a8a294", marginTop: 2 }}>
              {state.date} · {t("app.turn_short")}{state.turn + 1}{playerName ? ` · ${playerName}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LangToggle />
              <span style={{ fontSize: 8, color: "#c8a857", background: "#2a2010", border: "1px solid #5a4520", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace", letterSpacing: "0.08em" }}>{t("app.alpha_badge")}</span>
            </div>
            {assistMode !== "hardcore" && (
              <button onClick={() => setShowWiki(true)}
                style={{ background: "transparent", border: `1px solid ${NK.accent}`, borderRadius: 3, color: NK.accent, fontFamily: "monospace", fontSize: 9, letterSpacing: "0.06em", padding: "3px 7px", cursor: "pointer", fontWeight: 700 }}
              >
                {t("app.wiki_button")}
              </button>
            )}
            <button onClick={() => setShowFeedback(true)}
              style={{ background: "transparent", border: "1px solid #3a4156", borderRadius: 3, color: "#5a6070", fontFamily: "monospace", fontSize: 9, letterSpacing: "0.06em", padding: "3px 7px", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c8347"; e.currentTarget.style.color = "#9c8347"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#3a4156"; e.currentTarget.style.color = "#5a6070"; }}
            >
              {t("app.bug_button")}
            </button>
            {onNewGame && (
              <button
                onClick={() => { if (window.confirm(t("app.new_game_confirm"))) onNewGame(); }}
                style={{ background: "transparent", border: "1px solid #3a4156", borderRadius: 3, color: "#5a6070", fontFamily: "monospace", fontSize: 9, letterSpacing: "0.06em", padding: "3px 7px", cursor: "pointer" }}
              >
                {t("app.new_game_button")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="scroll-hide" style={{ display: "flex", gap: 6, padding: "10px 16px 8px", overflowX: "auto", background: NK.tabBarBg }}>
        {orderedTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const dragging = draggedTabId === t.id;
          return (
            <button
              key={t.id}
              data-tab-id={t.id}
              className="tab-btn"
              onPointerDown={(e) => handleTabPointerDown(e, t.id)}
              onClick={() => {
                if (tabDragSuppressClickRef.current) { tabDragSuppressClickRef.current = false; return; }
                setTab(t.id);
              }}
              title="Перетащите, чтобы изменить порядок вкладок"
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "9px 14px",
                background: active
                  ? `linear-gradient(180deg, ${NK.tabActiveBg} 0%, ${NK.tabActiveBg} 100%)`
                  : "linear-gradient(180deg,#262d3f 0%,#1e2433 100%)",
                color: active ? NK.tabActiveColor : NK.tabInactiveColor,
                border: "none", borderRadius: 10, fontFamily: "'PT Serif',serif",
                fontSize: 13, fontWeight: active ? 700 : 400, whiteSpace: "nowrap", flexShrink: 0,
                boxShadow: dragging
                  ? "0 10px 26px rgba(0,0,0,0.5)"
                  : active
                    ? "0 3px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.15)"
                    : "0 2px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)",
                transform: dragging && tabDragOffset ? `translate(${tabDragOffset.dx}px, ${tabDragOffset.dy}px) scale(1.05) rotate(-1.5deg)` : "none",
                zIndex: dragging ? 50 : 1,
                pointerEvents: dragging ? "none" : "auto",
                cursor: "grab", touchAction: dragging ? "none" : "pan-x",
                transition: dragging ? "none" : "transform 0.15s, box-shadow 0.15s",
                position: "relative",
              }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ background: tab !== "overview" ? "#161b26" : NK.contentBg, color: tab !== "overview" ? "#ece7d8" : NK.contentColor, minHeight: "60vh", padding: "20px 16px 32px" }}>
        {tab === "overview" && <OverviewTab state={state} />}
        {tab === "kremlin" && (
          <FactionsTab state={state} gameId={gameId} onStateRefresh={loadState} />
        )}
        {tab === "map" && <MapTab state={state} />}
        {tab === "stats" && <StatsTab state={state} gameId={gameId} />}
        {tab === "world" && <WorldTab state={state} />}
        {tab === "advisors" && (
          <AdvisorsTab
            advisorState={advisorState}
            actionMode={actionMode}
            onConsultAdvisor={handleConsultAdvisor}
            onSelectMode={setActionMode}
            onSelectCategory={(template, mode) => {
              // Форма подписи (композер/предпросмотр) рендерится ниже вкладок независимо от
              // того, какая вкладка активна — менять вкладку не нужно. Прокручиваем к полю.
              setDraftInput(template);
              if (["decree_fast","decree_reform","decree_program","intel","military","diplomacy_op"].includes(mode)) setActionMode(mode);
              setTimeout(() => {
                draftTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                draftTextareaRef.current?.focus();
              }, 50);
            }}
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
      </div>

      {/* Mission panel — always visible above action area */}
      <div style={{ padding: "0 16px 10px" }}>
        <MissionPanel stats={state?.stats} turn={state?.turn ?? 0} maxTurns={24} />
        <TerritoryPanel stats={state?.stats} />
      </div>

      {preview ? (
        <PreviewCard preview={preview} currentStats={state?.stats} onConfirm={handleConfirmClick} onCancel={handleCancel} confirming={confirming} gameId={gameId} onObjectionWithdrawn={() => {}} />
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

          {/* Раскрытие тайной операции — известно ТОЛЬКО после подписи приказа (см. backend
              revealCovertOutcome). Отдельный блок, чтобы не потерялось среди обычного нарратива. */}
          {lastActionResult && typeof lastActionResult.covertExposed === "boolean" && (
            <CovertOutcomeReveal exposed={lastActionResult.covertExposed} />
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
            {assistMode === "hardcore" && (
              <span className="mono-font" title="Режим «Сам по себе» — игровые подсказки отключены на старте партии" style={{ border: "1px solid #4a2020", borderRadius: 4, padding: "3px 8px", fontSize: 9, color: "#8a4040", flexShrink: 0, letterSpacing: "0.04em" }}>
                🎖 сам по себе
              </span>
            )}
          </div>

          {turnError && (
            <div className="doc-font" style={{
              color: "#e09090", fontSize: 12.5, marginBottom: 8, background: "#1a0c0c",
              border: "1px solid #5a2020", borderRadius: 4, padding: "8px 10px",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10,
            }}>
              <span>Ошибка: {turnError}</span>
              <button
                onClick={() => setTurnError(null)}
                title="Закрыть"
                style={{ background: "none", border: "none", color: "#e09090", cursor: "pointer", fontSize: 16, lineHeight: 1, flexShrink: 0, padding: 0 }}
              >
                ×
              </button>
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
            // БАЛАНС (2026-07-04): курс синхронизирован с TREASURY_PER_TRILLION в TreasuryTab
            // (см. ниже) и с backend/src/rules/rules-engine.js — держать все три в синхроне.
            const T = TREASURY_PER_TRILLION;
            const treasury = state?.stats?.treasury ?? 52;
            const economy = state?.stats?.economy ?? 50;
            const MONEY ={ military: 20, decree_program: 15, decree_reform: 8, decree: 8, decree_fast: 3, diplomacy_op: 5, intel: 5, crisis: 4 };
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

          {/* Тип действия: обычный выбор (указ/реформа/программа/разведка/военная/дипломатия)
              переехал во вкладку «Кремль» — там теперь и категория, и формулировка выбираются
              вместе. Здесь остаётся только антикризисная кнопка (особый принудительный режим,
              не входящий в обычные категории Кремля) и свободное поле ниже. */}
          {!!(state?.overview?.crisis_mode) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              <button
                onClick={() => setActionMode("crisis")}
                title="Экстренный указ. Дёшево, быстро, краткосрочно."
                style={{
                  background: actionMode === "crisis" ? "#1f2733" : "transparent",
                  border: `1px solid ${actionMode === "crisis" ? "#9c8347" : "#2a3040"}`,
                  color: actionMode === "crisis" ? "#9c8347" : "#5a6070",
                  borderRadius: 4, padding: "4px 8px",
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 9,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                }}
              >
                ⚡ Антикризисный
                <span style={{ color: "#5a6070" }}>−15</span>
                <span style={{ color: "#3a4050", fontSize: 8 }}>1–2 мес.</span>
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={draftTextareaRef}
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              placeholder={
                actionMode === "intel" ? "Опишите тайную операцию против противника (дестабилизация, диверсия, дезинформация)…"
                : actionMode === "military" ? "Опишите военную операцию — от разведки и точечного удара до наступления…"
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
            </div>
          </div>

          {/* Завершить ход / месяц */}
          <div id="action-buttons-anchor" style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {state?.multiActionTurns ? (
              /* Мульти-режим: действия внутри месяца + явное завершение месяца */
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  onClick={() => setConfirmSpecialAction({ kind: "regroup", action: handleRegroupTurn })}
                  disabled={confirming}
                  title="Перегруппировка — инициатива +75, армия отдыхает. Действие внутри месяца."
                  style={{ ...btnStyle("#1a2a1a", "#5a8050"), border: "1px solid #2a4030", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                >
                  {confirming ? "…" : "⚙ Перегруппировка"}
                </button>
                <button
                  onClick={() => setConfirmSpecialAction({ kind: "skip", action: handleSkipTurn })}
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
                      onClick={() => setConfirmSpecialAction({ kind: "regroup", action: handleRegroupTurn })}
                      disabled={confirming}
                      title="Перегруппировка — инициатива +75, армия отдыхает. Мягкие эффекты, нет штрафов"
                      style={{ ...btnStyle("#1a2a1a", "#5a8050"), border: "1px solid #2a4030", fontSize: 11, padding: "5px 14px", opacity: confirming ? 0.5 : 1 }}
                    >
                      {confirming ? "…" : "⚙ Перегруппировка (+75 инициативы)"}
                    </button>
                    <button
                      onClick={() => setConfirmSpecialAction({ kind: "skip", action: handleEndTurn })}
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

      {rawMobile && (
        <div style={{ textAlign: "center", padding: "10px 0 0", background: "#1a1f2c" }}>
          <DesktopViewToggle />
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
  intel:          { label: "🕵️ Шпионаж",           color: "#7a9cb0" },
  military:       { label: "⚔️ Военная операция",  color: "#c07070" },
  diplomacy_op:   { label: "🤝 Диппереговоры",     color: "#5b8cb0" },
  crisis:         { label: "⚡ Антикризисный",     color: "#c09030" },
};

const CABINET_TIER_OPTIONS = ["decree_fast", "decree_reform", "decree_program"];

// Расход ИИ (Петя, 2026-07-08): статичные данные советников на фронте — id/имя/роль/инициалы
// нужны ДО любого обращения к ИИ, чтобы нарисовать портрет и приветствие без единого вызова.
// Порядок и id строго совпадают с ADVISORS в backend/src/ai/advisors.js.
const ADVISOR_INFO = [
  { id: "defense", name: "Белоев А.Р.", role: "Министр обороны", initials: "БА" },
  { id: "foreign", name: "Лавин С.В.", role: "Министр иностранных дел", initials: "ЛС" },
  { id: "finance", name: "Силин А.Г.", role: "Министр финансов", initials: "СА" },
  { id: "security", name: "Патров Н.П.", role: "Секретарь Совета Безопасности", initials: "ПН" },
  { id: "press", name: "Пестов Д.С.", role: "Пресс-секретарь Президента", initials: "ПД" },
];

// Портрет — /advisors/{id}.png в frontend/public (Петя рисует отдельно). Пока файла нет —
// <img> падает на onError и рендер уходит на инициалы, никакого кода менять не придётся,
// достаточно положить файл по пути.
function AdvisorPortrait({ id, initials, size = 48 }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", background: "#2a3040", border: "1px solid #3a4156", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span className="mono-font" style={{ fontSize: size * 0.32, color: "#9c8347", fontWeight: 700 }}>{initials}</span>
      </div>
    );
  }
  return (
    <img
      src={`/advisors/${id}.png`}
      onError={() => setFailed(true)}
      alt=""
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "#2a3040", border: "1px solid #3a4156" }}
    />
  );
}

// Чисто декоративные приветствия — НЕ ИИ, статичный пул на каждого советника (в стиле его
// персоны из advisors.js), рендерятся до первого клика "Жду ваш совет". Не несут игровой
// информации специально, чтобы не создавать иллюзию содержательного совета без реального запроса.
const ADVISOR_GREETINGS = {
  defense: ["Слушаю, господин Президент. Докладывайте.", "Жду приказа. Время не ждёт.", "Обстановка на фронте под контролем. Что решаете?"],
  foreign: ["Господин Президент... я вас слушаю.", "Партнёры ждут нашего хода. Что скажете?", "Как в семьдесят третьем — всё повторяется. Ваше мнение?"],
  finance: ["Казна на месте, господин Президент. Что обсуждаем?", "Цифры перед вами. Готов доложить.", "Деньги любят счёт. Слушаю вас."],
  security: ["Господин Президент. Ситуация под наблюдением.", "Докладываю по готовности.", "Слушаю. Тихо, но внимательно."],
  press: ["Готов обсудить, как это подать, господин Президент.", "Пресса ждёт. Что говорим?", "Слушаю — надо продумать подачу."],
};
function pickGreeting(id, seedKey) {
  const pool = ADVISOR_GREETINGS[id] || ["Слушаю, господин Президент."];
  // Детерминированный псевдослучайный выбор по ключу (advisorId+actionMode) — не меняется от
  // ре-рендера к ре-рендеру, но меняется при смене масштаба решения.
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  const ruText = pool[hash % pool.length];
  return advisorGreeting(id, ruText, pool);
}

function AdvisorsTab({ advisorState, actionMode, onSelectMode, onConsultAdvisor, onSelectAdvice, onSelectCategory }) {
  const badge = ACTION_MODE_BADGE[actionMode] || ACTION_MODE_BADGE.decree_fast;
  // Свой текст на каждого советника отдельно (не общий черновик указа) — можно спросить
  // конкретного министра о чём-то своём, а можно просто нажать "Получить совет" пустым полем.
  const [questionDrafts, setQuestionDrafts] = useState({});
  // Министры исполняют распоряжения (Петя, 2026-07-09: "министры выполняют мои распоряжения, а
  // элиты в башнях кремля пытаются на меня повлиять") — браузер категорий переехал сюда из
  // бывшего KremlinTab, по одному министру на область, вместо общего браузера всех доменов.
  const [expandedMinisterId, setExpandedMinisterId] = useState(null);
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.1em", marginBottom: 6 }}>{t("advisors.scale_label")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CABINET_TIER_OPTIONS.map((tier) => {
            const b = ACTION_MODE_BADGE[tier];
            const active = actionMode === tier;
            return (
              <button
                key={tier}
                onClick={() => onSelectMode(tier)}
                style={{
                  background: active ? b.color + "22" : "transparent",
                  border: `1px solid ${active ? b.color : "#3a4156"}`,
                  color: active ? b.color : "#5a6070",
                  borderRadius: 4, padding: "6px 12px",
                  fontFamily: "'PT Serif',serif", fontSize: 12.5,
                  cursor: "pointer", fontWeight: active ? 700 : 400,
                }}
              >
                {actionModeLabel(tier, b.label)}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono-font" style={{ fontSize: 9, color: "#5a6070", letterSpacing: "0.1em" }}>{t("advisors.mode_advice_label")}</span>
        <span style={{ background: badge.color + "22", border: `1px solid ${badge.color}55`, borderRadius: 4, padding: "3px 10px", color: badge.color, fontFamily: "'PT Serif',serif", fontSize: 12 }}>{actionModeLabel(actionMode, badge.label)}</span>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {ADVISOR_INFO.map((info) => {
          const st = advisorState[info.id] || { status: "idle" };
          const adv = st.data;
          const toneColor = adv ? (ADVISOR_TONE_COLOR[adv.tone] || "#a8a294") : "#3a4156";
          return (
            <div
              key={info.id}
              style={{
                background: "#161b26",
                border: `1px solid #2a3040`,
                borderLeft: `4px solid ${toneColor}`,
                borderRadius: 4,
                padding: "13px 14px",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <AdvisorPortrait id={info.id} initials={info.initials} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                    <div>
                      <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, color: "#ece7d8" }}>{info.name}</div>
                      <div className="mono-font" style={{ fontSize: 10, color: "#a8a294", letterSpacing: "0.06em" }}>{advisorRoleLabel(info.id, info.role).toUpperCase()}</div>
                    </div>
                    {adv && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        {adv.is_optimal && (
                          <span className="mono-font" title={t("advisors.optimal_tooltip")}
                            style={{ fontSize: 9, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 3, background: "#1a3a2a", color: "#5adc8c", border: "1px solid #2a6a4a", fontWeight: 700 }}>
                            {t("advisors.optimal_badge")}
                          </span>
                        )}
                        <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 3, background: toneColor + "22", color: toneColor }}>
                          {advisorToneLabel(adv.tone, ADVISOR_TONE_LABEL[adv.tone] || adv.tone)?.toUpperCase()}
                        </span>
                        {adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                          <span className="mono-font" style={{ fontSize: 9, color: "#a8a294" }}>
                            → {directionLabel(adv.suggested_direction, DIRECTION_LABEL[adv.suggested_direction] || adv.suggested_direction)}
                          </span>
                        )}
                        {adv.suggested_scale && (
                          <span className="mono-font" style={{ fontSize: 8, padding: "2px 6px", borderRadius: 2, background: adv.suggested_scale === "decree_program" ? "#2a1f3a" : adv.suggested_scale === "decree_reform" ? "#1a2a1f" : "#1f2a2a", color: adv.suggested_scale === "decree_program" ? "#9c7ab0" : adv.suggested_scale === "decree_reform" ? "#7ab09c" : "#7a9cb0", letterSpacing: "0.06em" }}>
                            {actionScaleLabel(adv.suggested_scale, { decree_fast: "БЫСТРЫЙ УКАЗ", decree_reform: "РЕФОРМА", decree_program: "ПРОГРАММА", intel: "РАЗВЕДКА", military: "ВОЕННАЯ ОП." }[adv.suggested_scale] || adv.suggested_scale)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {st.status === "idle" && (
                    <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.5, color: "#a8a294", fontStyle: "italic", marginBottom: 10 }}>
                      «{pickGreeting(info.id, info.id + actionMode)}»
                    </div>
                  )}
                  {st.status === "loading" && (
                    <div className="mono-font" style={{ fontSize: 12, color: "#c8a96a", marginBottom: 10, animation: "pulse 1.2s infinite" }}>
                      {t("advisors.thinking")}
                    </div>
                  )}
                  {st.status === "error" && (
                    <div className="doc-font" style={{ fontSize: 12.5, color: "#e09090", marginBottom: 10 }}>
                      {t("advisors.error_prefix")}{st.error}
                    </div>
                  )}
                  {st.status === "loaded" && adv && (
                    <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.55, color: "#cdd3e0", marginBottom: 10 }}>
                      {adv.recommendation}
                    </div>
                  )}

                  {st.status === "loaded" && adv?.proposed_decree && adv.suggested_direction && adv.suggested_direction !== "null_action" && (
                    <div style={{ background: "#1f1a10", borderLeft: "3px solid #9c8347", borderRadius: 3, padding: "6px 9px", marginBottom: 10 }}>
                      <div className="mono-font" style={{ fontSize: 8, color: "#c8a96a", letterSpacing: "0.08em", marginBottom: 2 }}>{t("advisors.proposed_decree")}</div>
                      <div className="doc-font" style={{ fontSize: 12.5, color: "#e0c878", fontStyle: "italic", lineHeight: 1.45 }}>«{adv.proposed_decree}»</div>
                    </div>
                  )}

                  <textarea
                    value={questionDrafts[info.id] || ""}
                    onChange={(e) => setQuestionDrafts(prev => ({ ...prev, [info.id]: e.target.value }))}
                    placeholder={t("advisors.question_placeholder")}
                    rows={2}
                    disabled={st.status === "loading"}
                    style={{
                      width: "100%", resize: "vertical", marginBottom: 4, padding: "6px 8px",
                      background: "#0f131c", border: "1px solid #2a3040", borderRadius: 3,
                      fontFamily: "'PT Serif',serif", fontSize: 12.5, color: "#ece7d8", boxSizing: "border-box",
                    }}
                  />
                  {!questionDrafts[info.id]?.trim() && st.status !== "loading" && (
                    <div className="doc-font" style={{ fontSize: 11, color: "#a8a294", fontStyle: "italic", marginBottom: 6 }}>
                      {t("advisors.empty_hint")}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <button
                      onClick={() => onConsultAdvisor(info.id, questionDrafts[info.id] || "")}
                      disabled={st.status === "loading"}
                      style={{
                        background: st.status === "loading" ? "#5a5040" : "#9c8347", color: "#1a1f2c", border: "none",
                        borderRadius: 3, padding: "6px 14px", fontFamily: "'PT Serif',serif", fontSize: 12.5,
                        cursor: st.status === "loading" ? "default" : "pointer", fontWeight: 700, opacity: st.status === "loading" ? 0.7 : 1,
                      }}
                    >
                      {st.status === "loading" ? t("advisors.btn_thinking") : t("advisors.btn_get_advice")}
                    </button>
                    {st.status === "loaded" && adv?.suggested_direction && adv.suggested_direction !== "null_action" && (
                      <button
                        onClick={() => onSelectAdvice(adv)}
                        title={adv.proposed_decree ? t("advisors.accept_tooltip", { decree: adv.proposed_decree }) : undefined}
                        style={{
                          background: "transparent", color: "#9c8347", border: "1px solid #9c8347",
                          borderRadius: 3, padding: "6px 14px",
                          fontFamily: "'PT Serif',serif", fontSize: 12.5,
                          cursor: "pointer", fontWeight: 700,
                        }}
                      >
                        {t("advisors.btn_accept")}
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedMinisterId(expandedMinisterId === info.id ? null : info.id)}
                      style={{
                        marginLeft: "auto", background: "transparent", color: "#c8a857", border: "1px solid #3a4050",
                        borderRadius: 3, padding: "6px 14px", fontFamily: "'PT Serif',serif", fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      {t("advisors.btn_orders")} {expandedMinisterId === info.id ? "▲" : "▼"}
                    </button>
                  </div>

                  {expandedMinisterId === info.id && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a3040" }}>
                      <MinisterCategoryBrowser ministerId={info.id} onSelectCategory={onSelectCategory} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
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

// Seed-данные стран (context/profile/countryName) пока только на русском — Фаза 4 плана i18n.
// Для {country} в welcome.dossier_text используем английское имя, если оно есть в этой мини-карте
// (сейчас доступна только Россия) — иначе показываем как есть, не ломаем остальные страны.
const COUNTRY_NAME_EN = { "Россия": "Russia" };
function WelcomeModal({ state, playerName, assistMode, onClose, onOpenWiki }) {
  const stats = state?.stats || {};
  const countryName = state?.countryName || "страну";
  const countryAcc = COUNTRY_ACCUSATIVE[countryName] || countryName;
  const countryDisplay = getLang() === "en" ? (COUNTRY_NAME_EN[countryName] || countryName) : countryName;
  const context = state?.contextSummary || null;
  const profile = state?.countryProfile || null;
  const [expandedStat, setExpandedStat] = useState(null);
  const [showSituation, setShowSituation] = useState(false);
  const [openSections, setOpenSections] = useState(new Set());
  const toggleSection = (id) => setOpenSections(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const BriefSection = ({ id, label, color = "#5b6b8c", children }) => {
    const open = openSections.has(id);
    return (
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => toggleSection(id)}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: open ? "#1a2030" : "transparent", border: `1px solid ${open ? color + "66" : "#2a3040"}`, borderRadius: 4, padding: "8px 12px", cursor: "pointer", textAlign: "left" }}>
          <span className="mono-font" style={{ fontSize: 9, color: open ? color : "#5a6070", letterSpacing: "0.1em" }}>{label}</span>
          <span style={{ color: open ? color : "#3a4156", fontSize: 13, lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && <div style={{ border: `1px solid ${color}22`, borderTop: "none", borderRadius: "0 0 4px 4px", padding: "12px 12px 14px", background: "#141a24" }}>{children}</div>}
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ background: "#14181f", border: "1px solid #3a4156", borderTop: "3px solid #9c8347", borderRadius: 6, maxWidth: 600, width: "100%", maxHeight: "92vh", overflow: "auto", boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>

        {/* Шапка */}
        <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid #2a3040", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#a8313a", marginBottom: 3 }}>{t("app.classified")}</div>
            <div className="mono-font" style={{ fontSize: 12, color: "#9c8347", letterSpacing: "0.12em", fontWeight: 700 }}>{t("welcome.briefing")}</div>
          </div>
          <div className="mono-font" style={{ fontSize: 11, color: "#3a4156", letterSpacing: "0.1em" }}>REALPOLITIK</div>
        </div>

        <div style={{ padding: "22px 22px 28px" }}>

          {/* Личное дело */}
          <div style={{ borderLeft: "3px solid #9c8347", paddingLeft: 16, marginBottom: 24 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 8 }}>{t("welcome.dossier")}</div>
            <div className="doc-font" style={{ fontSize: 22, fontWeight: 700, color: "#ece7d8", marginBottom: 6 }}>
              {playerName || t("welcome.default_title")}
            </div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#a8a294", lineHeight: 1.6 }}>
              {t("welcome.dossier_text", { country: getLang() === "en" ? countryDisplay : countryAcc })}
            </div>
          </div>

          {/* Профиль страны: кто мы, сильные/слабые стороны (статично) */}
          {profile && (
            <div style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "14px 16px", marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", paddingTop: 2 }}>{t("welcome.country_prefix")}{countryName.toUpperCase()}</div>
                {context && (
                  <button
                    onClick={() => setShowSituation(true)}
                    style={{ background: "transparent", border: "1px solid #9c8347", color: "#9c8347", borderRadius: 3, padding: "4px 10px", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.05em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    {t("welcome.current_info")}
                  </button>
                )}
              </div>
              <div className="doc-font" style={{ fontSize: 13, color: "#c8c4b8", lineHeight: 1.65, marginBottom: (profile.strengths?.length || profile.weaknesses?.length) ? 14 : 0 }}>
                {profile.description}
              </div>
              {(profile.strengths?.length > 0 || profile.weaknesses?.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {profile.strengths?.length > 0 && (
                    <div>
                      <div className="mono-font" style={{ fontSize: 8.5, color: "#4a8a6a", letterSpacing: "0.1em", marginBottom: 6 }}>{t("welcome.strengths")}</div>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {profile.strengths.map((s, i) => (
                          <li key={i} className="doc-font" style={{ fontSize: 11, color: "#a8a294", lineHeight: 1.45, marginBottom: 5, paddingLeft: 13, position: "relative" }}>
                            <span style={{ position: "absolute", left: 0, color: "#4a8a6a", fontWeight: 700 }}>+</span>{s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {profile.weaknesses?.length > 0 && (
                    <div>
                      <div className="mono-font" style={{ fontSize: 8.5, color: "#c05050", letterSpacing: "0.1em", marginBottom: 6 }}>{t("welcome.weaknesses")}</div>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {profile.weaknesses.map((s, i) => (
                          <li key={i} className="doc-font" style={{ fontSize: 11, color: "#a8a294", lineHeight: 1.45, marginBottom: 5, paddingLeft: 13, position: "relative" }}>
                            <span style={{ position: "absolute", left: 0, color: "#c05050", fontWeight: 700 }}>−</span>{s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Фоллбэк для партий без country_profile: старый блок с текущим контекстом инлайн */}
          {!profile && context && (
            <div style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 4, padding: "14px 16px", marginBottom: 22 }}>
              <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#5a6070", marginBottom: 8 }}>{t("welcome.geo_context")}{countryName.toUpperCase()}</div>
              <div className="doc-font" style={{ fontSize: 13, color: "#c8c4b8", lineHeight: 1.65 }}>{context}</div>
            </div>
          )}

          {/* Показатели */}
          <BriefSection id="stats" label={t("welcome.stats_section")} color="#9c8347">
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
                                  <span className="mono-font" style={{ fontSize: 11, color: clr, fontWeight: 700 }}>{formatSubstatValue(s.key, s.value)}</span>
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
          </BriefSection>

          {/* Цель — всегда видна, краткая */}
          <div style={{ border: "1px solid #9c8347", borderRadius: 4, padding: "14px 16px", marginBottom: 14 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#9c8347", marginBottom: 8 }}>ЦЕЛЬ ОПЕРАЦИИ · 24 ХОДА (2 ГОДА)</div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#ece7d8", lineHeight: 1.65 }}>
              Завершите мирный процесс по Украине и стабилизируйте страну к <strong style={{ color: "#9c8347" }}>концу 2027 года</strong>.
            </div>
          </div>

          {/* Условия победы — всегда видны */}
          <div style={{ marginBottom: 14 }}>
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
          </div>

          {/* Три пути к победе — аккордеон */}
          <BriefSection id="paths" label="⚔️ ТРИ ПУТИ К ПОБЕДЕ" color="#5b6b8c">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
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
          </BriefSection>

          {/* Важно про мирный трек — аккордеон */}
          <BriefSection id="peace" label="☮ ВАЖНО ПРО МИРНЫЙ ТРЕК" color="#5b6b8c">
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
          </BriefSection>

          <BriefSection id="resources" label="⚡ РЕСУРСЫ: МЕСЯЦ, ИНИЦИАТИВА, КАЗНА" color="#9c8347">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { label: "🗓 Несколько действий в месяц", desc: "За один месяц можно принять несколько решений, пока хватает инициативы. Месяц продвигается только по кнопке «Завершить месяц».", color: "#9c8347" },
                { label: "⚡ Инициатива", desc: "Политическая воля — бюджет действий на месяц. Тратится на каждое решение, восстанавливается в конце месяца.", color: "#7fae93" },
                { label: "💰 Казна (бюджет)", desc: "Деньги. Действия стоят казны (война — дороже всего). Доход: экономика + налоги. Расход: содержание программ. Казна и экономика связаны: пустая казна тянет экономику вниз, здоровая — вверх; слабая экономика сушит доход. Дефицит — спираль вниз.", color: "#c8b87a" },
                { label: "📈 Экономика — индикатор, не рычаг", desc: "Военные операции, дипломатия, шпионаж и большинство указов не бьют по экономике напрямую — их влияние идёт через рост ВВП, занятость и инфляцию, которые эти действия и двигают. Прямо управляют экономикой только экономические указы — это их прямое назначение.", color: "#3a8a7a" },
                { label: "🛢 Нефть и курс доллара", desc: "Цена нефти и курс ₽/$ дрейфуют каждый месяц и реагируют на геополитику (Иран, ОПЕК+, санкции). Дорогая нефть и слабый рубль увеличивают доход казны (экспорт в долларах), но слабый рубль разгоняет инфляцию.", color: "#c89060" },
                { label: "⚙ Перегруппировка / 🏠 Передышка", desc: "Перегруппировка — отдых фронта (мораль, готовность, инициатива), даёт второй военный удар в этом месяце, но в этот месяц доступны только военные действия. Передышка — восстановление тыла (рейтинг, стабильность, занятость), но военные операции в этот месяц недоступны.", color: "#5a8050" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>
          </BriefSection>

          <BriefSection id="decisiontypes" label={<><span style={{ color: "#c0392b" }}>★</span> ВКЛАДКА «БАШНИ КРЕМЛЯ»</>} color="#9c8347">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { label: "⚔️ Военное", desc: "Разведка, удары, наступления, оборона — от 15 до 80 инициативы.", color: "#9c6347" },
                { label: "🕵️ Разведка", desc: "Тайные операции: дезинформация, дестабилизация, диверсии, ликвидации. Риск раскрытия растёт с тяжестью операции.", color: "#b08ad8" },
                { label: "🤝 Дипломатия", desc: "Переговоры, договоры, давление, коалиции, мирные инициативы.", color: "#4a6b8c" },
                { label: "📜 Указы", desc: "Экономика, военно-административные, политика, информационные — 13 категорий.", color: "#5a9c6a" },
              ].map(({ label, desc, color }) => (
                <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "7px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 9, color, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.3 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div className="doc-font" style={{ fontSize: 10.5, color: "#5a6070", lineHeight: 1.4, marginTop: 8 }}>
              30 готовых категорий. Откройте карточку — появятся 3 готовые формулировки указа или поле для своего текста. Можно также писать правительству напрямую в свободном поле внизу экрана.
            </div>
          </BriefSection>

          <BriefSection id="policies" label="⚙ ДЕЙСТВУЮЩИЕ ПОЛИТИКИ" color="#9c7ab0">
            <div style={{ background: "#1a2030", borderRadius: 3, padding: "8px 11px" }}>
              <div className="doc-font" style={{ fontSize: 11, color: "#7a8090", lineHeight: 1.45 }}>
                Вкладка «Политики» сгруппирована: <span style={{ color: "#9c7ab0" }}>программы</span>, <span style={{ color: "#3a8a7a" }}>реформы</span>, <span style={{ color: "#5b6b8c" }}>указы</span>. У каждой видно, что вырастет при успехе и последствия отмены. Налоговые (НДС, утильсбор) <b>пополняют казну</b>, но бьют по рейтингу; программы <b>стоят на содержание</b>. Отмена непопулярной политики может поднять рейтинг — но лишит дохода.
              </div>
            </div>
          </BriefSection>

          <BriefSection id="defeat" label="💀 УСЛОВИЯ ПОРАЖЕНИЯ" color="#a8313a">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[
                { cond: "Рейтинг < 30", res: "Переворот", color: "#a8313a" },
                { cond: "Экономика < 30", res: "Коллапс", color: "#a8313a" },
                { cond: "Стабильность < 25", res: "Волнения", color: "#a8313a" },
                { cond: "Дипломатия < 15", res: "Изоляция", color: "#ab47bc" },
                { cond: "3+ наступления подряд без отдыха", res: "Спираль войны", color: "#ff5722" },
                { cond: "Армия < 30", res: "Фронт рухнул", color: "#a8313a" },
                { cond: "Донецк и Луганск < 40%", res: "Донбасс отбит", color: "#a8313a" },
              ].map(({ cond, res, color }) => (
                <div key={cond} style={{ background: "#2a1a1a", borderRadius: 3, padding: "7px 9px", borderTop: `2px solid ${color}` }}>
                  <div className="mono-font" style={{ fontSize: 8.5, color: "#6a4040", marginBottom: 2 }}>{cond}</div>
                  <div className="mono-font" style={{ fontSize: 9.5, color, fontWeight: 700 }}>{res}</div>
                </div>
              ))}
            </div>
          </BriefSection>

          <BriefSection id="howto" label="📖 КАК ИГРАТЬ" color="#5a6070">
            <div style={{ display: "grid", gap: 10 }}>
              {[
                ["1", "Читайте «Обстановку»", "Очаги напряжённости кликабельны. Вкладка «Мир» — ходы других стран, «Политики» — что уже действует."],
                ["2", "Откройте «Башни Кремля»", "30 готовых категорий по четырём направлениям (военное, разведка, дипломатия, указы). Разверните карточку — 3 готовые формулировки указа или своё поле для текста. Выбор остаётся во вкладке «Башни Кремля», текст сам подставится в форму подписи внизу."],
                ["3", "Или сформулируйте своё", "Свободное поле «написать правительству» внизу экрана принимает любое реалистичное решение своими словами — под полем видно цену ⚡ инициативы и 💰 казны."],
                ["4", "«Рассмотреть →» и подтвердите", "ИИ-геймместер покажет прогноз и возражение советника. Подтверждение тратит инициативу и казну, но месяц НЕ заканчивает."],
                ["5", "Несколько решений за месяц", "Пока хватает инициативы — принимайте ещё решения. Это и есть «несколько действий за месяц»."],
                ["6", "«Завершить месяц»", "Восстановит инициативу, начислит доход в казну, спишет содержание программ, покажет реакцию противников и союзников. Месяц сменится."],
                ["7", t("welcome.howto_step7_title"), t("welcome.howto_step7_desc")],
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
          </BriefSection>

          {/* Напоминание прочитать Ликбез — перенесено вниз (после того, как игрок увидел
              актуальную сводку), чтобы не отвлекать от неё сразу под личным делом. Скрыто
              в hardcore-режиме — там сознательно нет подсказок. */}
          {assistMode !== "hardcore" && onOpenWiki && (
            <div style={{ background: "#241a10", border: "1px solid #9c8347", borderRadius: 4, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="doc-font" style={{ fontSize: 12.5, color: "#e0c878", lineHeight: 1.5 }}>
                {richText(t("welcome.wiki_banner"), { fontWeight: 700 })}
              </div>
              <button
                onClick={onOpenWiki}
                style={{ background: "#9c8347", color: "#1a1f2c", border: "none", borderRadius: 4, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {t("welcome.wiki_banner_btn")}
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            style={{ width: "100%", background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "14px", fontFamily: "'PT Serif',serif", fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
          >
            {t("welcome.cta")}
          </button>
        </div>
      </div>

      {/* Попап «Что сейчас происходит» — актуальные события, отдельно от статичного профиля страны */}
      {showSituation && context && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => setShowSituation(false)}
        >
          <div
            style={{ background: "#14181f", border: "1px solid #3a4156", borderTop: "3px solid #9c8347", borderRadius: 6, maxWidth: 520, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 30px 80px rgba(0,0,0,0.8)", padding: "20px 22px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#9c8347", fontWeight: 700 }}>АКТУАЛЬНАЯ ИНФОРМАЦИЯ · {countryName.toUpperCase()}</div>
              <button
                onClick={() => setShowSituation(false)}
                style={{ background: "transparent", border: "none", color: "#5a6070", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div className="doc-font" style={{ fontSize: 13.5, color: "#c8c4b8", lineHeight: 1.7 }}>{context}</div>
          </div>
        </div>
      )}
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
  "Россия": { capital: "Москва", gov: "Президентская федерация", flag: "🇷🇺", desc: "Крупнейшая страна мира. Постоянный член СБ ООН, ядерная держава. С 2022 г. ведёт военную операцию на Украине, находится под масштабными западными санкциями.", gdp: "≈$2,2 трлн", population: "≈146 млн", alliance: "ОДКБ, ЕАЭС, БРИКС, СНГ", language: "Русский" },
  "США": { capital: "Вашингтон", gov: "Президентская республика", flag: "🇺🇸", desc: "Единственная сверхдержава. Доминирует в НАТО, контролирует мировые финансы через доллар. Крупнейшая экономика и военный бюджет мира.", gdp: "≈$27 трлн", population: "≈335 млн", alliance: "НАТО, G7", language: "Английский" },
  "Китай": { capital: "Пекин", gov: "Однопартийная республика", flag: "🇨🇳", desc: "Вторая экономика мира, стремительно наращивает военную мощь. Конкурирует с США за мировое лидерство, претендует на Тайвань.", gdp: "≈$18 трлн", population: "≈1,41 млрд", alliance: "ШОС, БРИКС", language: "Китайский (путунхуа)" },
  "Германия": { capital: "Берлин", gov: "Федеративная республика", flag: "🇩🇪", desc: "Локомотив ЕС. Крупнейший экономический партнёр России в Европе до 2022 г., теперь лидирует в санкционной политике и военной поддержке Украины.", gdp: "≈$4,5 трлн", population: "≈84 млн", alliance: "НАТО, ЕС", language: "Немецкий" },
  "Франция": { capital: "Париж", gov: "Президентская республика", flag: "🇫🇷", desc: "Ядерная держава, постоянный член СБ ООН. Активно продвигает европейскую стратегическую автономию, поддерживает Украину.", gdp: "≈$3,1 трлн", population: "≈68 млн", alliance: "НАТО, ЕС", language: "Французский" },
  "Великобритания": { capital: "Лондон", gov: "Конституционная монархия", flag: "🇬🇧", desc: "Постоянный член СБ ООН, ядерная держава. Один из главных поставщиков оружия Украине, лидирует в санкционном давлении на Россию.", gdp: "≈$3,3 трлн", population: "≈68 млн", alliance: "НАТО, G7", language: "Английский" },
  "Украина": { capital: "Киев", gov: "Президентская республика", flag: "🇺🇦", desc: "В состоянии вооружённого конфликта с Россией с февраля 2022 г. Получает масштабную военную и финансовую помощь Запада.", gdp: "≈$180 млрд", population: "≈38 млн", alliance: "кандидат в ЕС, партнёр НАТО", language: "Украинский" },
  "Беларусь": { capital: "Минск", gov: "Президентская республика", flag: "🇧🇾", desc: "Ближайший союзник России. Предоставила территорию для наступления в феврале 2022 г., находится под западными санкциями.", gdp: "≈$73 млрд", population: "≈9,2 млн", alliance: "ОДКБ, ЕАЭС, Союзное государство с РФ", language: "Белорусский, русский" },
  "Польша": { capital: "Варшава", gov: "Парламентская республика", flag: "🇵🇱", desc: "Крупнейший сухопутный плацдарм НАТО на восточном фланге. Один из главных поставщиков помощи Украине.", gdp: "≈$810 млрд", population: "≈37 млн", alliance: "НАТО, ЕС", language: "Польский" },
  "Турция": { capital: "Анкара", gov: "Президентская республика", flag: "🇹🇷", desc: "Многовекторный игрок. Член НАТО, но сохраняет отношения с Россией, выступает посредником в переговорах.", gdp: "≈$1,1 трлн", population: "≈85 млн", alliance: "НАТО", language: "Турецкий" },
  "Израиль": { capital: "Иерусалим", gov: "Парламентская республика", flag: "🇮🇱", desc: "Ближневосточная ядерная держава. Ведёт операции против ХАМАС и Хезболлы, балансирует между Западом и Россией.", gdp: "≈$525 млрд", population: "≈9,8 млн", alliance: "стратегический партнёр США (не формальный блок)", language: "Иврит" },
  "Индия": { capital: "Нью-Дели", gov: "Федеративная республика", flag: "🇮🇳", desc: "Крупнейший покупатель российской нефти после введения санкций. Проводит стратегически независимую политику.", gdp: "≈$3,7 трлн", population: "≈1,44 млрд", alliance: "ШОС, БРИКС", language: "Хинди, английский" },
  "Япония": { capital: "Токио", gov: "Конституционная монархия", flag: "🇯🇵", desc: "Союзник США в АТР. Ввела масштабные санкции против России, активно вооружается на фоне угроз КНДР и Китая.", gdp: "≈$4,2 трлн", population: "≈124 млн", alliance: "договор безопасности с США, G7", language: "Японский" },
  "Южная Корея": { capital: "Сеул", gov: "Президентская республика", flag: "🇰🇷", desc: "Союзник США. Крупный производитель оружия, оказывает косвенную помощь Украине через третьи страны." },
  "Северная Корея": { capital: "Пхеньян", gov: "Тоталитарная монархия", flag: "🇰🇵", desc: "Поставляет России боеприпасы и военнослужащих. Ядерная держава, изолированная от мировой экономики.", gdp: "≈$18 млрд (оценка)", population: "≈26 млн", alliance: "нет формального — де-факто союзник России и Китая", language: "Корейский" },
  "Саудовская Аравия": { capital: "Эр-Рияд", gov: "Абсолютная монархия", flag: "🇸🇦", desc: "Крупнейший экспортёр нефти, лидер ОПЕК+. Проводит политику диверсификации, нормализует отношения с Ираном при посредничестве Китая.", gdp: "≈$1,1 трлн", population: "≈36 млн", alliance: "ОПЕК+, Лига арабских государств", language: "Арабский" },
  "Казахстан": { capital: "Астана", gov: "Президентская республика", flag: "🇰🇿", desc: "Крупнейший партнёр России в Центральной Азии. После 2022 г. дистанцируется от Москвы, привлекает западные инвестиции." },
  "Азербайджан": { capital: "Баку", gov: "Президентская республика", flag: "🇦🇿", desc: "Контролирует нефтегазовые маршруты в обход России. В 2023 г. установил контроль над Нагорным Карабахом." },
  "Сирия": { capital: "Дамаск", gov: "Переходная власть", flag: "🇸🇾", desc: "Россия потеряла военные базы после падения режима Асефа в конце 2024 г. Страна переходит под новое управление." },
  "Иран": { capital: "Тегеран", gov: "Исламская республика", flag: "🇮🇷", desc: "Поставляет России дроны-камикадзе Shahed. Противостоит США и Израилю, развивает ядерную программу.", gdp: "≈$400 млрд", population: "≈89 млн", alliance: "ШОС", language: "Персидский (фарси)" },
  "Бразилия": { capital: "Бразилиа", gov: "Президентская республика", flag: "🇧🇷", desc: "Крупнейшая экономика Латинской Америки. Придерживается нейтралитета в конфликте, участвует в БРИКС." },
  "Финляндия": { capital: "Хельсинки", gov: "Парламентская республика", flag: "🇫🇮", desc: "Вступила в НАТО в 2023 г. Имеет самую длинную границу с Россией среди стран альянса — 1340 км." },
  "Швеция": { capital: "Стокгольм", gov: "Конституционная монархия", flag: "🇸🇪", desc: "Вступила в НАТО в 2024 г., завершив 200 лет нейтралитета. Поставляет Украине современное вооружение." },
  "Монголия": { capital: "Улан-Батор", gov: "Парламентская республика", flag: "🇲🇳", desc: "Зажата между Россией и Китаем. Не арестовала президента России по ордеру МУС во время его визита в 2024 г." },
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
  "Венгрия": { capital: "Будапешт", gov: "Парламентская республика", flag: "🇭🇺", desc: "Член ЕС и НАТО, но проводит пророссийский курс. Блокировала ряд решений ЕС по санкциям и помощи Украине.", gdp: "≈$215 млрд", population: "≈9,6 млн", alliance: "НАТО, ЕС", language: "Венгерский" },
  "Афганистан": { capital: "Кабул", gov: "Исламский эмират (Талибан)", flag: "🇦🇫", desc: "После вывода войск США в 2021 г. власть перешла к Талибану. Россия установила рабочие контакты с новым режимом." },
  "Ливия": { capital: "Триполи", gov: "Расколотое государство", flag: "🇱🇾", desc: "Страна разделена между западным правительством и восточными силами. Россия поддерживает восточную коалицию через ЧВК." },
  "Эфиопия": { capital: "Аддис-Абеба", gov: "Федеративная республика", flag: "🇪🇹", desc: "Крупнейшая страна Африканского Рога. Преодолевает последствия гражданской войны 2020–2022 гг., наращивает сотрудничество с Китаем и Россией." },
  "Нигерия": { capital: "Абуджа", gov: "Президентская федерация", flag: "🇳🇬", desc: "Крупнейшая экономика Африки и самая населённая страна континента. Борется с исламским экстремизмом на севере и сепаратизмом на юге." },
  "ЮАР": { capital: "Претория", gov: "Президентская республика", flag: "🇿🇦", desc: "Лидирующая экономика Африки. Воздержалась при голосовании ООН по Украине, проводит активную политику в БРИКС." },
  "Аргентина": { capital: "Буэнос-Айрес", gov: "Президентская республика", flag: "🇦🇷", desc: "Крупнейшая испаноязычная страна. В 2023 г. к власти пришёл радикальный либертарианец Милес, кардинально изменивший внешнеполитический курс." },
  "Мексика": { capital: "Мехико", gov: "Президентская федерация", flag: "🇲🇽", desc: "Вторая экономика Латинской Америки. Торговый партнёр США №1, придерживается нейтралитета по Украине." },
  "Вьетнам": { capital: "Ханой", gov: "Однопартийная республика", flag: "🇻🇳", desc: "Крупный покупатель российского оружия и нефти. Балансирует между США, Китаем и Россией, стремительно развивает экономику." },
  "Таиланд": { capital: "Бангкок", gov: "Конституционная монархия", flag: "🇹🇭", desc: "Страна АСЕАН. Придерживается нейтралитета, сохраняет деловые отношения с Россией, туристический хаб для россиян." },
  "Мьянма": { capital: "Нейпьидо", gov: "Военная хунта", flag: "🇲🇲", desc: "После военного переворота 2021 г. страна охвачена гражданской войной. Россия — главный поставщик оружия хунте, заблокировала санкции ООН." },
  "Малайзия": { capital: "Куала-Лумпур", gov: "Конституционная монархия", flag: "🇲🇾", desc: "Развивающаяся экономика ЮВА. Придерживается нейтралитета, наращивает торговлю с Китаем и Россией." },
  "Филиппины": { capital: "Манила", gov: "Президентская республика", flag: "🇵🇭", desc: "Союзник США. При президенте Маркосо-мл. восстановил тесные отношения с Вашингтоном на фоне территориального конфликта с Китаем в Южно-Китайском море." },
  "Бангладеш": { capital: "Дакка", gov: "Парламентская республика", flag: "🇧🇩", desc: "Одна из самых густонаселённых стран мира. В 2024 г. массовые протесты свергли премьера Хасимову, страна переходит к демократии при временном правительстве." },
  "Шри-Ланка": { capital: "Коломбо", gov: "Президентская республика", flag: "🇱🇰", desc: "В 2022 г. пережила тяжелейший экономический кризис. Балансирует между Китаем и Индией, получает кредиты МВФ для восстановления." },
  "Непал": { capital: "Катманду", gov: "Федеративная республика", flag: "🇳🇵", desc: "Горная страна между Индией и Китаем. Традиционно ориентирована на Индию, но наращивает связи с Китаем по инициативе Пояса и Пути." },
  "Испания": { capital: "Мадрид", gov: "Конституционная монархия", flag: "🇪🇸", desc: "Четвёртая экономика еврозоны. Поддерживает Украину, принимает значительную украинскую диаспору. Член НАТО и ЕС." },
  "Италия": { capital: "Рим", gov: "Парламентская республика", flag: "🇮🇹", desc: "Третья экономика ЕС. Была крупнейшим европейским потребителем российского газа. Поддерживает Украину, несмотря на исторически тесные деловые связи с Россией." },
  "Нидерланды": { capital: "Амстердам", gov: "Конституционная монархия", flag: "🇳🇱", desc: "Транспортный и финансовый хаб ЕС. Потеряли 298 граждан в катастрофе MH17 в 2014 г. — активно поддерживают международные расследования." },
  "Бельгия": { capital: "Брюссель", gov: "Конституционная монархия", flag: "🇧🇪", desc: "Штаб-квартира НАТО и ключевых институтов ЕС находится в Брюсселе. Активно участвует в координации западной поддержки Украины." },
  "Швейцария": { capital: "Берн", gov: "Федеративная республика", flag: "🇨🇭", desc: "Исторически нейтральная страна. Впервые с 1939 г. присоединилась к западным санкциям против России, что вызвало острые споры о нейтралитете." },
  "Австрия": { capital: "Вена", gov: "Федеративная республика", flag: "🇦🇹", desc: "Нейтральная страна, не член НАТО. Вена традиционно использовалась для российско-западных переговоров. Сильно зависела от российского газа." },
  "Чехия": { capital: "Прага", gov: "Парламентская республика", flag: "🇨🇿", desc: "Активный сторонник Украины, один из крупнейших поставщиков оружия в пересчёте на ВВП. Инициировала закупку артиллерийских снарядов для Украины по всему миру." },
  "Словакия": { capital: "Братислава", gov: "Парламентская республика", flag: "🇸🇰", desc: "После прихода к власти Фицака в 2023 г. заблокировала военную помощь Украине. Транзитная страна для российского газа в Европу." },
  "Греция": { capital: "Афины", gov: "Парламентская республика", flag: "🇬🇷", desc: "Член НАТО с 1952 г. Традиционно имела тесные культурные связи с Россией (православие). Поддерживает Украину, но осторожнее других по вопросам санкций." },
  "Португалия": { capital: "Лиссабон", gov: "Президентская республика", flag: "🇵🇹", desc: "Атлантический форпост НАТО. Активно поддерживает Украину, принимает украинских беженцев. Исторически тесные связи с Бразилией и Анголой." },
  "Дания": { capital: "Копенгаген", gov: "Конституционная монархия", flag: "🇩🇰", desc: "Страна НАТО, граничит с Балтийским морем. Один из крупнейших доноров Украины в пересчёте на ВВП. Контролирует Гренландию — стратегически важный арктический регион." },
  "Болгария": { capital: "София", gov: "Парламентская республика", flag: "🇧🇬", desc: "Православная балканская страна, исторически близкая к России. Присоединилась к санкциям как член ЕС, но внутри страны сильны пророссийские настроения." },
  "Хорватия": { capital: "Загреб", gov: "Президентская республика", flag: "🇭🇷", desc: "Член ЕС и НАТО. Активно помогает Украине военной техникой, при этом президент Миланич занимает более сдержанную позицию." },
  "Литва": { capital: "Вильнюс", gov: "Парламентская республика", flag: "🇱🇹", desc: "Один из самых активных сторонников Украины среди малых стран. Первой ввела санкции против Беларуси, перекрыла транзит в Калининград." },
  "Латвия": { capital: "Рига", gov: "Парламентская республика", flag: "🇱🇻", desc: "Прибалтийская страна НАТО. Принимает крупный контингент НАТО. Активно выдворяет российских дипломатов и поддерживает Украину." },
  "Эстония": { capital: "Таллин", gov: "Парламентская республика", flag: "🇪🇪", desc: "Самая цифровая страна мира. Лидер по военной помощи Украине в % от ВВП. Граничит с Россией и активно наращивает оборонный потенциал." },
  "Молдова": { capital: "Кишинёв", gov: "Президентская республика", flag: "🇲🇩", desc: "Маленькая страна между Украиной и Румынией. На её территории находится пророссийское Приднестровье с российскими войсками. Курс на вступление в ЕС." },
  "Алжир": { capital: "Алжир", gov: "Президентская республика", flag: "🇩🇿", desc: "Крупнейший по площади африканской страны. Главный поставщик газа в Европу из Африки, активно замещает российские поставки. Исторически тесные связи с Россией." },
  "Марокко": { capital: "Рабат", gov: "Конституционная монархия", flag: "🇲🇦", desc: "Стабильная монархия на севере Африки. Углубляет отношения с США и Израилем (Абрахамские соглашения 2020 г.), крупный потребитель российского зерна." },
  "Тунис": { capital: "Тунис", gov: "Президентская республика", flag: "🇹🇳", desc: "Единственная арабская страна, где Арабская весна привела к демократии. После 2021 г. президент Саиди концентрирует власть, откатывая демократические достижения." },
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
  "Чад": { capital: "Нджамена", gov: "Переходный военный совет", flag: "🇹🇩", desc: "Ключевой партнёр Франции в Сахеле. После смерти Дебри в 2021 г. его сын укрепляет власть. Французские базы постепенно выводятся из региона." },
  "ДР Конго": { capital: "Киншаса", gov: "Президентская республика", flag: "🇨🇩", desc: "Огромные запасы полезных ископаемых (кобальт, колтан) при хроническом конфликте на востоке. Китай и Россия активно осваивают ресурсную базу страны." },
  "Конго": { capital: "Браззавиль", gov: "Президентская республика", flag: "🇨🇬", desc: "Нефтеэкспортёр с авторитарным режимом. Поддерживает тесные связи с Россией и Китаем, принимал президента России в 2023 г." },
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
  "Уганда": { capital: "Кампала", gov: "Президентская республика", flag: "🇺🇬", desc: "Авторитарный режим Мусавени у власти с 1986 г. Россия усилила военное сотрудничество. Принят закон о криминализации гомосексуальности, вызвавший западные санкции." },
  "Иордания": { capital: "Амман", gov: "Конституционная монархия", flag: "🇯🇴", desc: "Стабильная монархия в неспокойном регионе. Координирует ПВО с Израилем и Западом против иранских дронов. Принимает более 650 тыс. сирийских беженцев." },
  "Ливан": { capital: "Бейрут", gov: "Парламентская республика", flag: "🇱🇧", desc: "Государство на грани коллапса. Глубокий экономический кризис с 2019 г., взрыв в порту 2020 г., война с Израилем в 2024 г. нанесла тяжелейший удар по Хезболле." },
  "Йемен": { capital: "Сана", gov: "Расколотое государство", flag: "🇾🇪", desc: "Гражданская война с 2015 г. Хуситы, поддерживаемые Ираном, контролируют север и атакуют торговые суда в Красном море с 2023 г., угрожая мировой торговле." },
  "Оман": { capital: "Маскат", gov: "Абсолютная монархия", flag: "🇴🇲", desc: "Традиционно нейтральный посредник Персидского залива. Поддерживает дипломатические каналы со всеми сторонами, включая Иран и Израиль." },
  "Кувейт": { capital: "Эль-Кувейт", gov: "Конституционная монархия", flag: "🇰🇼", desc: "Небольшое нефтяное государство. Принимает американские военные базы. Помнит иракскую оккупацию 1990 г. и опирается на американские гарантии безопасности." },
  "Катар": { capital: "Доха", gov: "Абсолютная монархия", flag: "🇶🇦", desc: "Крупнейший мировой экспортёр СПГ. После кризиса 2022 г. поставляет газ в Европу. Принимает американскую базу CENTCOM и политических беженцев из разных стран." },
  "ОАЭ": { capital: "Абу-Даби", gov: "Федеральная монархия", flag: "🇦🇪", desc: "Финансовый хаб региона. Дубай стал крупнейшим центром для россиян, обходящих санкции. Балансирует между США и Китаем, поддерживает рабочие отношения с Россией.", gdp: "≈$540 млрд", population: "≈9,9 млн", alliance: "Лига арабских государств, ОПЕК+", language: "Арабский" },
  "ЕС": { capital: "Брюссель (штаб-квартира)", gov: "Наднациональное объединение (27 стран-членов)", flag: "🇪🇺", desc: "Крупнейший торговый блок мира. После 2022 г. — основной источник санкционного давления на Россию и один из ключевых доноров Украины.", gdp: "≈$18 трлн (агрегат)", population: "≈450 млн", alliance: "Европейский союз", language: "Многоязычный (24 официальных)" },
  "Бахрейн": { capital: "Манама", gov: "Конституционная монархия", flag: "🇧🇭", desc: "Небольшой островной архипелаг. Принимает штаб 5-го флота США — главный американский военно-морской центр в Персидском заливе." },
  "Колумбия": { capital: "Богота", gov: "Президентская республика", flag: "🇨🇴", desc: "Крупнейший поставщик кокаина в мире. После десятилетий вооружённого конфликта с ФАРК пытается достичь мира. Президент Педрос проводит левый курс, критикуя США." },
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

// Заголовки ленты должны быть короткими и примерно одной длины — иначе блок
// «прыгает» по высоте при каждой смене (особенно заметно на мобильных, где
// игровые новости — это целые абзацы, а не короткие тэглайны).
const HEADLINE_MAX_LEN = 130;
function truncateHeadline(text) {
  if (!text) return "";
  return text.length > HEADLINE_MAX_LEN ? text.slice(0, HEADLINE_MAX_LEN).trim() + "…" : text;
}

function NewsLiveFeed({ state }) {
  // Берём реальные новости из state.newsfeed, дополняем статичными если мало
  const headlines = useMemo(() => {
    const fromGame = (state?.newsfeed || [])
      .filter(n => n.text && n.source)
      .map(n => ({ src: n.source, text: truncateHeadline(n.text), fullText: n.text }))
      .reverse(); // последние первыми
    const combined = [...fromGame, ...LIVE_HEADLINES];
    return combined.slice(0, 20);
  }, [state?.turn]); // обновляем при смене хода

  const [visibleIdx, setVisibleIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const [expanded, setExpanded] = useState(null);

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
    }, 8000);
    return () => clearInterval(interval);
  }, [headlines]);

  if (headlines.length === 0) return null;
  const item = headlines[visibleIdx];
  const next = headlines[(visibleIdx + 1) % headlines.length];
  const prev = headlines[(visibleIdx - 1 + headlines.length) % headlines.length];

  return (
    <div style={{ marginBottom: 14, background: "#f0ebe0", border: "1px solid #c8c2af", borderRadius: 4, overflow: "hidden" }}>
      {/* Шапка ленты */}
      <div style={{ background: "#a8313a", padding: "5px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6060", display: "inline-block", animation: "pulse-red 1s infinite" }} />
        <span className="mono-font" style={{ fontSize: 9, color: "#fff", letterSpacing: "0.14em", fontWeight: 700 }}>LIVE · МИРОВЫЕ НОВОСТИ</span>
        <style>{`@keyframes pulse-red { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      </div>

      {/* Главная новость — свободная высота, полный текст */}
      <div
        onClick={() => setExpanded(item)}
        style={{ padding: "10px 12px 10px", transition: "opacity 0.4s", opacity: fade ? 1 : 0, cursor: "pointer" }}
        title="Нажмите, чтобы прочитать полностью"
      >
        <div className="mono-font" style={{ fontSize: 8, color: "#a8313a", letterSpacing: "0.1em", marginBottom: 5 }}>{item.src.toUpperCase()}</div>
        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.5, color: "#1e1c18", fontWeight: 700 }}>{item.text}</div>
      </div>

      {expanded && (
        <Modal title={expanded.src.toUpperCase()} onClose={() => setExpanded(null)}>
          <div className="doc-font" style={{ fontSize: 15, lineHeight: 1.6, color: "#1e1c18" }}>
            {expanded.fullText || expanded.text}
          </div>
        </Modal>
      )}

      {/* Следующие заголовки */}
      <div style={{ borderTop: "1px solid #d8d2bf" }}>
        {[next, prev].map((h, i) => (
          <div
            key={i}
            onClick={() => setExpanded(h)}
            style={{ padding: "6px 12px", borderBottom: i === 0 ? "1px solid #e8e2cf" : "none", display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}
          >
            <span className="mono-font" style={{ fontSize: 8, color: "#8c6b3a", flexShrink: 0 }}>{h.src}</span>
            <span className="doc-font" style={{ fontSize: 11.5, color: "#3a362e", lineHeight: 1.4 }}>{h.text.length > 100 ? h.text.slice(0, 100) + "…" : h.text}</span>
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
            ХОД {state.turn + 1}
          </div>
          <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
            {modal.region}
          </div>
          <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.65, color: "#3a362e" }}>
            {modal.text}
          </div>
        </Modal>
      )}

      <MarketTicker stats={state.stats || {}} />
      <NewsVideoPanel state={state} />

      <div style={{ borderLeft: "3px solid #a8313a", paddingLeft: 12, marginBottom: 14 }}>
        <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a8313a", marginBottom: 4 }}>
          ГЛАВНОЕ СЕЙЧАС · ХОД {state.turn + 1}
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

// Реальная ширина экрана, без учёта ручного переключателя "Обычная версия" ниже — нужна
// отдельно, чтобы решить, показывать ли саму кнопку переключения (на десктопе она бессмысленна).
function useRawIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 600);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// isMobile для раскладки — учитывает ручной форс "Обычная версия" (Петя, 2026-07-09: "нужна
// кнопка чтоб переключиться на обычную в мобильной") поверх реальной ширины экрана.
function useIsMobile() {
  const raw = useRawIsMobile();
  const forced = useForceDesktop();
  return forced ? false : raw;
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
    if (v >= 70) return t("map.rel_ally");
    if (v >= 40) return t("map.rel_partner");
    if (v >= 10) return t("map.rel_neutral");
    if (v >= -20) return t("map.rel_tension");
    return t("map.rel_hostility");
  }

  return (
    <div style={{ background: "#14181f", margin: "-20px -16px -32px", padding: "14px 14px 20px", minHeight: "60vh" }}>
      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#a8313a", marginBottom: 10 }}>
        {t("map.header", { n: state.turn + 1 })}
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: "flex-start" }}>
        {/* Карта */}
        <div style={{ flex: "1 1 0", width: "100%", minWidth: 0, background: nuclearStrike ? "#0a0a0a" : "#0d1420", borderRadius: 6, position: "relative" }}>
          {nuclearStrike && (
            <div className="mono-font" style={{ padding: "4px 8px", background: "#2a0a0a", color: "#ff4444", fontSize: 9, letterSpacing: "0.1em", borderBottom: "1px solid #5a1a1a" }}>
              {t("map.nuclear_banner", { target: nuclearStrike.city ? t("map.nuclear_target", { city: nuclearStrike.city.toUpperCase() }) : "" })}
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
            {t("map.click_hint")}
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
                  {(countryModal.info.gdp || countryModal.info.population || countryModal.info.alliance || countryModal.info.language) && (
                    <div className="mono-font" style={{ fontSize: 9.5, color: "#8a9aaa", lineHeight: 1.7, marginBottom: 8 }}>
                      {countryModal.info.gdp && <div>💰 {t("relations.factsheet_gdp")}: <span style={{ color: "#c8c0b0" }}>{countryModal.info.gdp}</span></div>}
                      {countryModal.info.population && <div>👥 {t("relations.factsheet_population")}: <span style={{ color: "#c8c0b0" }}>{countryModal.info.population}</span></div>}
                      {countryModal.info.alliance && <div>🤝 {t("relations.factsheet_alliance")}: <span style={{ color: "#c8c0b0" }}>{countryModal.info.alliance}</span></div>}
                      {countryModal.info.language && <div>🗣 {t("relations.factsheet_language")}: <span style={{ color: "#c8c0b0" }}>{countryModal.info.language}</span></div>}
                    </div>
                  )}
                </>
              )}
              {countryModal.rel ? (
                <>
                  <div className="mono-font" style={{ fontSize: 9, color: "#5a6070", marginBottom: 4, letterSpacing: "0.06em" }}>{t("map.current_relations")}</div>
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
                <div className="mono-font" style={{ fontSize: 9, color: "#4a5060" }}>{t("map.no_data")}</div>
              ) : null}
              <button onClick={() => setCountryModal(null)} style={{ marginTop: 8, background: "none", border: "none", color: "#4a5060", cursor: "pointer", fontSize: 10, padding: 0 }}>{t("map.close")}</button>
            </div>
          )}

          {/* Инфо о хотспоте */}
          {hotspotModal && (
            <div style={{ background: "#2a1a1a", border: "1px solid #5a2a2a", borderRadius: 5, padding: "10px 10px" }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 4 }}>{t("map.hotspot_header")}</div>
              <div className="doc-font" style={{ fontSize: 12, fontWeight: 700, color: "#ece7d8", marginBottom: 6, lineHeight: 1.3 }}>{hotspotModal.region}</div>
              <div className="doc-font" style={{ fontSize: 11, color: "#c8c0b0", lineHeight: 1.45 }}>{hotspotModal.text}</div>
              <button onClick={() => { setHotspotModal(null); setActiveHotspotIdx(null); }} style={{ marginTop: 8, background: "none", border: "none", color: "#4a5060", cursor: "pointer", fontSize: 10, padding: 0 }}>{t("map.close")}</button>
            </div>
          )}

          {/* Список очагов */}
          <div style={{ background: "#1a1f2c", border: "1px solid #2a3040", borderRadius: 5, padding: "8px 10px" }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#a8313a", letterSpacing: "0.08em", marginBottom: 8 }}>{t("map.conflicts_header")}</div>
            {hotspots.length === 0 ? (
              <div className="mono-font" style={{ fontSize: 9, color: "#3a4050" }}>{t("map.no_data")}</div>
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
    { key: "inflation",   label: "Инфляция",    color: "#c06050", desc: "ЦБ удерживает высокую ставку, чтобы сдержать рост цен. Бьёт по реальным доходам.", inverted: true },
    { key: "employment",  label: "Занятость",   color: "#4a7a5c", desc: "Рынок труда перегрет: мобилизация и ВПК вытянули рабочих, безработица рекордно низкая." },
    // БАЛАНС (2026-07-04): раньше тут было "доступны только около $290 млрд" — устаревшая цифра
    // из времён ДО перевода резервов в реальные единицы (задача "Реальные единицы для резервов
    // ФНБ"), противоречащая динамическому значению на вкладке Казна (там ≈$60-80 млрд при
    // старте партии, см. reservesUsdBillion/RESERVES_RUB_TRILLION_PER_POINT). $300 млрд — это
    // реальные ЗАМОРОЖЕННЫЕ валютные резервы ЦБ (отдельный от ФНБ фонд) — оставлен как факт о
    // санкциях, но убрана вводящая в заблуждение вторая цифра.
    { key: "reserves",    label: "Резервы",     color: "#9c8347", desc: "ФНБ расходуется на покрытие дефицита. Отдельно от ФНБ — валютные резервы ЦБ (~$300 млрд) заморожены Западом. Ликвидная часть ФНБ — см. вкладку «Казна» в реальных деньгах." },
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
  ],
  stability: [],
  approval: [
    { key: "elite_satisfaction", label: "Элиты",        color: "#8c6b3a", desc: "Силовики и госкорпорации в выигрыше от ВПК. Бизнес страдает от ставки ЦБ и санкций." },
    { key: "corruption",         label: "Коррупция",    color: "#a8313a", desc: "Военные контракты и параллельный импорт открыли новые схемы. Transparency: 137-е место.", inverted: true },
    { key: "middle_class",       label: "Средний класс",color: "#5b6b8c", desc: "Ипотека под 18%+, инфляция, утечка мозгов. Средний класс теряет позиции и уезжает." },
    { key: "lower_class_mood",   label: "Народ",        color: "#4a6b5c", desc: "Рост цен перекрывает надбавки участникам СВО. Деревня держится, города напряжены." },
  ],
};

// БАЛАНС (2026-07-04): плоский key→{label,color,inverted} индекс по SUBSTAT_META + территории +
// мирный трек — все они 0-100 внутри, как и 5 базовых статов, просто не входили в statMeta (не
// хотим засорять основную сетку статов на "Показателях"). Игрок попросил бары и для субметрик —
// раньше они были только плоским текстом в PreviewCard/EndTurnScreen. Теперь PreviewStatBar может
// рисовать бар для любого из этих ключей через label/color/inverted пропсы. Казна (-100..100,
// другой масштаб) и Инициатива (уже есть отдельный кейс) сюда не входят.
const EXTRA_BAR_META = {};
for (const group of Object.values(SUBSTAT_META)) {
  for (const s of group) EXTRA_BAR_META[s.key] = { label: s.label, color: s.color, inverted: !!s.inverted };
}
for (const k of ["donetsk_control", "luhansk_control", "zaporizhzhia_control", "kherson_control", "kharkiv_control"]) {
  EXTRA_BAR_META[k] = { label: ALL_STAT_LABELS[k], color: "#7a8fae", inverted: false };
}
EXTRA_BAR_META.peace_progress = { label: "Мирный трек", color: "#5b8c6b", inverted: false };
// Прямая цена для Украины от указа игрока (UA_IMPACT_FROM_PLAYER, см. rules-engine.js) — те же
// label/color, что уже используются в панели "Разведданные по Украине" (UA_STAT_META), просто
// чтобы бар в превью/итогах хода выглядел так же, как и в StatsTab.
for (const k of ["ua_army", "ua_morale", "ua_stability", "ua_west_support"]) {
  EXTRA_BAR_META[k] = { label: UA_STAT_META[k].label, color: UA_STAT_META[k].color, inverted: false };
}

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

  // Механика влияния — простыми предложениями, без стрелок и сокращений. EN — инлайн-тернарник
  // по getLang(), не отдельная константа модуля: MECHANIC_NOTES и так пересоздаётся на каждый
  // рендер компонента (не module-level), так что "устаревания" языка при переключении, как у
  // statLabel()-подобных случаев, здесь нет.
  const en = getLang() === "en";
  const MECHANIC_NOTES = {
    economy: [
      { text: en ? "A large army is expensive: if military strength is above 80, army upkeep is deducted from the economy every month — 1 to 3 points, more the further above the threshold." : "Большая армия дорого обходится: если военная мощь выше 80, каждый месяц с экономики списывается содержание армии — от 1 до 3 пунктов, тем больше, чем сильнее армия превышает порог.", warn: (state.stats.military ?? 50) > 80 },
      { text: en ? "A prolonged war costs the economy on its own, regardless of army size: starting from the 4th combat operation in a row without a civilian breather, 1-2 points are deducted every month — manpower and resources drain to the front. Regrouping doesn't reset the counter (it's also a military decision) — only a non-military action resets it." : "Затяжная война сама по себе стоит экономике, независимо от размера армии: начиная с 4-й боевой операции подряд без гражданской передышки каждый месяц списывается 1-2 пункта — рабочие руки и ресурсы уходят на фронт. Перегруппировка не сбрасывает счётчик (это тоже военное решение), сбрасывает только не-военное действие.", warn: (state.stats.military_streak ?? 0) >= 4 },
      { text: en ? "High inflation hits the economy: above 15% annualized, monthly losses begin — up to 3 points at 100% inflation." : "Высокая инфляция бьёт по экономике: выше 15% годовых начинают идти ежемесячные потери — до 3 пунктов при инфляции 100%.", warn: (state.stats.inflation ?? 64) > 73 },
      { text: en ? "An empty treasury means a deficit: with a negative treasury, the economy loses 2 points a month and inflation accelerates. A treasury below 15 of 100 also gradually presses on the economy." : "Пустая казна — это дефицит: при отрицательной казне экономика теряет 2 пункта в месяц, а инфляция ускоряется. Казна ниже 15 из 100 тоже понемногу давит на экономику.", warn: (state.stats.treasury ?? 52) < 15 },
      { text: en ? "A healthy treasury reserve (above 65) gives a small economy boost — there's money for investment." : "Здоровый запас в казне (выше 65) даёт небольшой плюс к экономике — есть деньги на инвестиции.", warn: false },
      { text: en ? "Stimulus measures boost the economy but also raise inflation somewhat — over time this can backfire if inflation is already high." : "Стимулирующие меры разгоняют экономику, но одновременно немного повышают инфляцию — на дистанции это может навредить, если инфляция и так высокая.", warn: false },
      { text: en ? "Austerity raises the economy more than stimulus and lowers inflation — but hits approval and stability." : "Жёсткая экономия поднимает экономику сильнее, чем стимулирование, и снижает инфляцию — но бьёт по рейтингу и стабильности.", warn: false },
      { text: en ? "All automatic monthly economy losses (army, inflation, deficit, random crises) are capped at a combined −6 per month — a sharp one-turn collapse can no longer happen." : "Все автоматические месячные потери экономики (армия, инфляция, дефицит, случайные кризисы) суммарно ограничены −6 за один месяц — резкий обвал за один ход больше не случится.", warn: false },
    ],
    military: [
      { text: en ? "If military strength is above 80, army upkeep is deducted from the economy every month — 1 to 3 points." : "Если военная мощь выше 80, каждый месяц с экономики списывается содержание армии — от 1 до 3 пунктов.", warn: (state.stats.military ?? 50) > 80 },
      { text: en ? "Three or more offensives in a row without rest reduce the payoff of each next strike by 15%." : "Три и более наступления подряд без отдыха снижают отдачу от каждого следующего удара на 15%.", warn: false },
      { text: en ? "Regrouping restores 30–50 initiative points and gives a bonus to the next operation, but military action will be unavailable next month." : "Перегруппировка восстанавливает 30–50 очков инициативы и даёт бонус к следующей операции, но следующий месяц военные действия будут недоступны.", warn: false },
    ],
    stability: [
      { text: en ? "A negative treasury lowers stability by 1 point a month — a budget deficit destabilizes the country." : "Отрицательная казна снижает стабильность на 1 пункт в месяц — дефицит бюджета дестабилизирует страну.", warn: (state.stats.treasury ?? 52) < 0 },
      { text: en ? "Repression temporarily raises stability, but increases corruption and lowers approval." : "Репрессии временно поднимают стабильность, но повышают коррупцию и снижают рейтинг.", warn: false },
    ],
    diplomacy: [
      { text: en ? "Above 70 international isolation, sanctions pressure intensifies and the economy becomes more vulnerable." : "При международной изоляции выше 70 санкционное давление усиливается, а экономика становится более уязвимой.", warn: (state.stats.isolation ?? 68) > 70 },
      { text: en ? "Diplomatic steps lower inflation and isolation; confrontation, conversely, lowers diplomacy and raises isolation." : "Дипломатические шаги снижают инфляцию и изоляцию; конфронтация, наоборот, снижает дипломатию и повышает изоляцию.", warn: false },
    ],
    approval: [
      { text: en ? "Inflation above 15% annualized automatically lowers approval by 1–2 points a month." : "Инфляция выше 15% годовых автоматически снижает рейтинг на 1–2 пункта в месяц.", warn: (state.stats.inflation ?? 64) > 73 },
      { text: en ? "If the economy falls below 40, the risk of losing public support to domestic crises rises." : "Если экономика падает ниже 40, растёт риск потерять поддержку населения из-за внутренних кризисов.", warn: (state.stats.economy ?? 50) < 40 },
    ],
  };

  const substats = (SUBSTAT_META[statKey] || []).map(sm => ({ ...sm, value: state.stats[sm.key] ?? 50 }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.85)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f5f1e6", borderRadius: 8, width: "min(95vw,520px)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div style={{ background: "#1a1f2c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: meta?.color }} />
            <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>{t("stats.detail_title", { label: statLabel(statKey, meta?.label)?.toUpperCase() })}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>
          {/* Текущее значение */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: meta?.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{currentValue}</div>
            <div>
              <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, color: "#3a362e" }}>{statLabel(statKey, meta?.label)}</div>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginTop: 2 }}>
                {currentValue >= 70 ? t("stats.level_high") : currentValue >= 40 ? t("stats.level_medium") : t("stats.level_low")}
              </div>
            </div>
          </div>

          {/* График */}
          {historyValues.length >= 2 && (
            <div style={{ marginBottom: 18, background: "#ece7d8", borderRadius: 4, padding: "12px 14px" }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>{t("stats.dynamics_header")}</div>
              <Sparkline data={historyValues} color={meta?.color} width={440} height={48} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>{t("stats.turn_n", { n: history[0]?.turn_n })}</span>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>{t("stats.now")}</span>
              </div>
            </div>
          )}

          {/* Субметрики */}
          {substats.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 10 }}>{t("stats.detailed_metrics")}</div>
              <div style={{ display: "grid", gap: 10 }}>
                {substats.map(s => {
                  const isInflation = s.key === "inflation";
                  // Инфляция — три ступени (норма/повышенная/шторм) вместо резкого бинарного
                  // красный/зелёный на пороге 60, который красит стартовое значение в красный.
                  const inflColor = s.value > 70 ? "#a8313a" : s.value > 60 ? "#9c8347" : "#4a7a5a";
                  const color = isInflation ? inflColor : s.inverted ? (s.value > 60 ? "#a8313a" : "#4a6b5c") : (s.value >= 60 ? "#4a6b5c" : s.value >= 40 ? "#9c8347" : "#a8313a");
                  return (
                    <div key={s.key}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <div>
                          <span className="doc-font" style={{ fontSize: 13, fontWeight: 700, color: "#3a362e" }}>{statLabel(s.key, s.label)}</span>
                          <span className="doc-font" style={{ fontSize: 11, color: "#8a8472", marginLeft: 6 }}>{substatDesc(s.key, s.desc)}</span>
                        </div>
                        <span className="mono-font" style={{ fontSize: 12, fontWeight: 700, color }}>
                          {isInflation ? `${inflationPercent(s.value).toFixed(1)}% ${en ? "y/y" : "г/г"}` : formatSubstatValue(s.key, s.value)}
                        </span>
                      </div>
                      <Bar
                        value={isInflation ? 100 - inflationBarFraction(s.value) : s.inverted ? 100 - s.value : s.value}
                        color={isInflation ? inflColor : s.inverted ? (s.value > 60 ? "#a8313a" : "#4a6b5c") : s.color}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Механика влияния */}
          {(MECHANIC_NOTES[statKey] || []).length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>{t("stats.mechanic_header")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {(MECHANIC_NOTES[statKey] || []).map((note, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 10px", background: note.warn ? "#fdf0f0" : "#ece7d8", borderRadius: 4, border: `1px solid ${note.warn ? "#e8c8c8" : "#d8d2bf"}` }}>
                    {note.warn && <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>⚠</span>}
                    <span className="doc-font" style={{ fontSize: 11.5, color: note.warn ? "#7a2020" : "#5c5648", lineHeight: 1.4 }}>{note.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Последние события */}
          <div>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>{t("stats.recent_events_header")}</div>
            {news === null && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472" }}>{t("stats.loading")}</div>}
            {news?.length === 0 && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", fontStyle: "italic" }}>{t("stats.no_related_events")}</div>}
            {news?.slice(0, 4).map((item, i) => (
              <div key={i} style={{ borderTop: "1px solid #d8d2bf", paddingTop: 8, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>{t("world.turn_short")} {item.turn_n} · {item.source}</div>
                <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2, color: "#3a362e" }}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Авто-эффекты каждый месяц: пороги из rules-engine + turns.js/end-month
// Consolidated end-of-month forecast panel — all auto-mechanics in one place
const IMPACT_STAT_KEY = { "Экономика": "economy", "Одобрение": "approval", "Инфляция": "inflation", "Казна": "treasury", "Стабильность": "stability" };
// % от текущего значения статы — тот же удар в очках ощущается сильнее при низком текущем значении
function impactPercent(label, delta, stats) {
  if (delta == null) return null;
  const key = IMPACT_STAT_KEY[label];
  if (!key) return null;
  const current = stats[key];
  if (typeof current !== "number" || current <= 0) return null;
  return Math.round((delta / current) * 100);
}

function EndMonthForecastPanel({ stats, policies }) {
  const [open, setOpen] = useState(false);
  const mil = stats.military ?? 50;
  const inf = stats.inflation ?? 64;
  const trs = stats.treasury ?? 52;
  const eco = stats.economy ?? 50;
  const stab = stats.stability ?? 50;
  const dip = stats.diplomacy ?? 50;
  const appr = stats.approval ?? 50;
  const streak = stats.military_streak ?? 0;

  // Build list of all mechanisms, active or not
  const mechanisms = [];

  // 0.5. Оборонзаказ (ВПК): умеренная армия (50-80) стимулирует экономику через военные
  // заказы — реальный эффект военной экономики. Выше 80 это уже не стимул, а бремя (см. ниже).
  {
    const defenseBoost = (mil >= 50 && mil <= 80) ? Math.floor((mil - 50) / 15) : 0;
    if (defenseBoost > 0) {
      mechanisms.push({
        active: true, severity: "good",
        name: "Оборонзаказ (ВПК)",
        trigger: `Армия ${mil} в диапазоне 50-80 — военные заказы стимулируют промышленность`,
        impacts: [{ label: "Экономика", delta: defenseBoost }],
        fix: "Выше 80 баллов армии стимул сменяется бременем (содержание становится дороже, чем отдача от заказов).",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Оборонзаказ (ВПК)",
        trigger: mil > 80 ? `Армия ${mil} > 80 — уже не стимул, а бремя` : `Армия ${mil} < 50 — недостаточно для оборонзаказа`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 1. Военное бремя: размер армии (military > 80) + усталость от затянувшейся войны (streak >= 4).
  // Объединены в один механизм — оба про одно и то же: война стоит денег и поддержки.
  {
    const sizeTax = mil > 80 ? Math.floor((mil - 80) / 10) + 1 : 0;
    const wearinessHit = streak >= 4 ? Math.min(5, Math.floor((streak - 3) * 1.5)) : 0;
    const stabHit = Math.ceil(wearinessHit / 2);
    const warEconomyDrag = wearinessHit > 0 ? Math.ceil(wearinessHit / 3) : 0;
    if (sizeTax > 0 || wearinessHit > 0) {
      const impacts = [];
      if (sizeTax > 0) impacts.push({ label: "Экономика", delta: -sizeTax }, { label: "Одобрение", delta: -1 });
      if (wearinessHit > 0) impacts.push({ label: "Одобрение", delta: -wearinessHit }, { label: "Стабильность", delta: -stabHit }, { label: "Экономика", delta: -warEconomyDrag });
      const parts = [];
      if (sizeTax > 0) parts.push(`армия ${mil} > 80`);
      if (wearinessHit > 0) parts.push(`${streak}-я боевая операция подряд без передышки`);
      mechanisms.push({
        active: true, severity: (sizeTax >= 3 || wearinessHit >= 4) ? "crit" : "bad",
        name: "Военное бремя",
        trigger: parts.join(" + "),
        impacts,
        fix: sizeTax > 0 && wearinessHit > 0
          ? "Снизьте Армию до ≤80 и дайте войскам передышку (регруппировка сбрасывает счётчик усталости)."
          : sizeTax > 0
          ? `Снизьте Армию до ≤80. Превышение на ${mil - 80} пт → каждые 10 пт сверх = ещё −1 экономика/мес.`
          : "Передышка (регруппировка вместо наступления) сбрасывает счётчик усталости.",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Военное бремя",
        trigger: `Армия ${mil} ≤ 80 и нет серии из 4+ боевых ходов подряд — не активно`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 2. Inflation shock
  if (inf > 73) {
    const ecoP = Math.min(3, Math.floor((inf - 73) / 10) + 1);
    const appP = Math.min(2, Math.floor((inf - 73) / 15) + 1);
    mechanisms.push({
      active: true, severity: ecoP >= 3 ? "crit" : "bad",
      name: "Инфляционный шок",
      trigger: `Инфляция ${inflationPercent(inf).toFixed(0)}% г/г > 15% (балл ${inf} > 73)`,
      impacts: [{ label: "Экономика", delta: -ecoP }, { label: "Одобрение", delta: -appP }],
      fix: "Указы «Жёсткая экономия» снижают инфляцию. Не выпускайте ОФЗ (каждый выпуск +0.5 инфл/мес + 0.3/мес пока висит долг). Потолок штрафа −3/−2.",
    });
  } else {
    mechanisms.push({
      active: false,
      name: "Инфляционный шок",
      trigger: `Инфляция ${inflationPercent(inf).toFixed(0)}% г/г ≤ 15% — не активен`,
      impacts: [{ label: "Экономика", delta: -1 }, { label: "Одобрение", delta: -1 }],
      fix: null,
    });
  }

  // 3. Treasury spiral
  if (trs < 0) {
    mechanisms.push({
      active: true, severity: "crit",
      name: "Дефицит казны",
      trigger: `Казна ${trs} (≈₽${(trs * TREASURY_PER_TRILLION).toFixed(1)} трлн) < 0 — критический дефицит`,
      impacts: [{ label: "Экономика", delta: -2 }, { label: "Инфляция", delta: +2 }, { label: "Стабильность", delta: -1 }],
      fix: "Срочно: откажитесь от части госпрограмм, погасите ОФЗ, проведите 2–3 указа «Жёсткой экономии». Дефицит разгоняет инфляцию → двойной удар.",
    });
  } else if (trs < 15) {
    mechanisms.push({
      active: true, severity: "bad",
      name: "Низкая казна",
      trigger: `Казна ${trs} (≈₽${(trs * TREASURY_PER_TRILLION).toFixed(1)} трлн) < 15 — вынужденная аустерити`,
      impacts: [{ label: "Экономика", delta: -1 }],
      fix: "Экономика >50 даёт ~40 дохода в мес. Снизьте расходы (госпрограммы, ОФЗ) или проведите налоговые указы.",
    });
  } else if (trs > 65 && eco < 82) {
    mechanisms.push({
      active: true, severity: "good",
      name: "Профицит казны",
      trigger: `Казна ${trs} (≈₽${(trs * TREASURY_PER_TRILLION).toFixed(1)} трлн) > 65 — есть ресурс для инвестиций`,
      impacts: [{ label: "Экономика", delta: +1 }],
      fix: null,
    });
  } else {
    mechanisms.push({
      active: false,
      name: "Казна",
      trigger: `Казна ${trs} — в норме, штрафов нет`,
      impacts: [],
      fix: null,
    });
  }

  // 4. ОФЗ: инфляционное давление + компаундинг стоимости обслуживания через ставку ЦБ
  if ((stats.ofz_count ?? 0) > 0) {
    const ofzCount = stats.ofz_count;
    const rateForOfz = stats.key_rate ?? 18.5;
    const costPerBond = Math.max(2, Math.round(rateForOfz / 6));
    mechanisms.push({
      active: true, severity: "bad",
      name: "Давление ОФЗ",
      trigger: `${ofzCount} выпуск(а) ОФЗ в обращении, ставка ЦБ ${rateForOfz}%`,
      impacts: [{ label: "Инфляция", delta: Math.round(ofzCount * 0.3 * 10) / 10 }, { label: "Казна", delta: -(ofzCount * costPerBond) }],
      fix: `Обслуживание растёт вместе со ставкой ЦБ (сейчас ${costPerBond}/выпуск) — чем выше инфляция, тем дороже висящий долг. Погашайте через «Погасить ОФЗ», пока ставка не выросла ещё сильнее.`,
    });
  }

  // 5. Ключевая ставка ЦБ — эффект на инфляцию и экономику
  {
    const rate = stats.key_rate ?? 18.5;
    const cbHead = stats.cb_head_type ?? "neutral";
    const softExtra = cbHead === "soft" && rate > 10 ? 1 : 0;
    if (rate > 17) {
      mechanisms.push({
        active: true, severity: "bad",
        name: "Ключевая ставка ЦБ",
        trigger: `Ставка ${rate}% > 17% — дорогой кредит душит бизнес`,
        impacts: [{ label: "Экономика", delta: -1 }, { label: "Инфляция", delta: -1 + softExtra }],
        fix: "Высокая ставка сдерживает инфляцию ценой роста. ЦБ сам снижает ставку по мере падения инфляции — ускорить можно только сменив главу ЦБ или надавив на него.",
      });
    } else if (rate < 11) {
      mechanisms.push({
        active: true, severity: softExtra ? "bad" : "good",
        name: "Ключевая ставка ЦБ",
        trigger: `Ставка ${rate}% < 11% — дешёвый кредит стимулирует рост`,
        impacts: [{ label: "Экономика", delta: +1 }, { label: "Инфляция", delta: +1 + softExtra }],
        fix: "Низкая ставка разгоняет экономику, но и инфляцию. Следите, чтобы инфляция не ушла за 15% г/г.",
      });
    } else {
      mechanisms.push({
        active: softExtra ? true : false, severity: softExtra ? "bad" : undefined,
        name: "Ключевая ставка ЦБ",
        trigger: softExtra
          ? `Ставка ${rate}% — нейтральна, но мягкий глава ЦБ добавляет инфляционный риск`
          : `Ставка ${rate}% — в нейтральной зоне 11–17%, прямых эффектов нет`,
        impacts: softExtra ? [{ label: "Инфляция", delta: +1 }] : [],
        fix: softExtra ? "Мягкий глава ЦБ держит ставку заниженной — хронический +1 инфляции/мес, пока ставка выше 10%." : null,
      });
    }
  }

  // 6. Коррупционная утечка казны
  {
    const corr = stats.corruption ?? 68;
    const drain = corr > 50 ? Math.round(Math.pow((corr - 50) / 50, 1.3) * 12) : 0;
    if (drain > 0) {
      mechanisms.push({
        active: true, severity: drain >= 6 ? "crit" : "bad",
        name: "Коррупционная утечка",
        trigger: `Коррупция: внутренний балл ${corr}, CPI ${corruptionCpiEquivalent(corr)} (по методике Transparency International, выше = лучше) — ₽${corruptionDrainRubTrillion(drain).toFixed(1)} трлн бюджета разворовывается ежемесячно`,
        impacts: [{ label: "Казна", delta: -drain }],
        fix: "Антикоррупционная кампания снижает уровень коррупции. Утечка растёт нелинейно: при коррупции 75 теряется вдвое больше, чем при 60.",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Коррупционная утечка",
        trigger: `Коррупция: внутренний балл ${corr} ≤ 50 (CPI ${corruptionCpiEquivalent(corr)} ≥ 28) — утечки из казны нет`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 7. Рост ВВП → экономика (компаундинг относительно старта партии) + перегрев → инфляция
  //    + стагнация/спад (Петя, 2026-07-05): рост ≤1% г/г — уже больная экономика, не нейтраль.
  {
    const gdp = stats.gdp_growth ?? 36;
    const gdpEffect = Math.round((gdp - 36) / 8);
    const gdpOverheat = gdp > 60 ? Math.round((gdp - 60) / 20) : 0;
    const gdpPct = gdpGrowthPercent(gdp);
    const gdpPctStr = `${gdpPct >= 0 ? "+" : ""}${gdpPct.toFixed(1)}%`;
    const gdpStagnation = gdpPct <= 1 ? Math.min(-1, Math.round((gdpPct - 1) / 2)) : 0;
    if (gdpEffect !== 0 || gdpOverheat !== 0 || gdpStagnation !== 0) {
      const impacts = [];
      if (gdpEffect) impacts.push({ label: "Экономика", delta: gdpEffect });
      if (gdpStagnation) impacts.push({ label: "Экономика (стагнация/спад)", delta: gdpStagnation });
      if (gdpOverheat) impacts.push({ label: "Инфляция (перегрев)", delta: gdpOverheat });
      mechanisms.push({
        active: true, severity: gdpOverheat > 0 ? "bad" : gdpStagnation < 0 ? "bad" : gdpEffect > 0 ? "good" : "bad",
        name: "Рост ВВП",
        trigger: gdpOverheat > 0
          ? `Рост ВВП ${gdpPctStr} г/г — перегрев экономики выше потенциала разгоняет инфляцию`
          : gdpStagnation < 0
          ? `Рост ВВП ${gdpPctStr} г/г — стагнация/спад: слабый или отрицательный рост душит экономику сам по себе`
          : `Рост ВВП ${gdpPctStr} г/г (старт партии: +1%) — отклонение компаундится в экономику`,
        impacts,
        fix: gdpStagnation < 0
          ? "Рост ВВП на уровне старта партии (+1% г/г) или ниже — это уже стагнация, экономика теряет каждый месяц. Нужен рост ЗАМЕТНО выше +1%, чтобы штраф исчез — реформы и стимулирующие указы поднимают gdp_growth."
          : gdpOverheat > 0
          ? "Рост ВВП выше 60 баллов даёт всё те же плюсы к экономике, но дополнительно разгоняет инфляцию — как перегрев спроса без роста предложения в реальности."
          : "Устойчивый рост ВВП постепенно усиливает экономику — держите курс.",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Рост ВВП",
        trigger: `Рост ВВП ${gdpPctStr} г/г ≈ стартовый уровень — заметного эффекта на экономику нет`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 8. Занятость → налоговая база + инфляция (кривая Филлипса) + экономика
  {
    const empl = stats.employment ?? 74;
    const factor = Math.max(0.6, Math.min(1.3, 1 + (empl - 74) * 0.004));
    const pctShift = Math.round((factor - 1) * 100);
    const emplInflEffect = Math.round((empl - 74) / 25);
    const emplEcoEffect = Math.round((empl - 74) / 10);
    const emplPct = employmentRatePercent(empl);
    if (pctShift !== 0 || emplInflEffect !== 0 || emplEcoEffect !== 0) {
      const impacts = [{ label: `Доход казны ${pctShift > 0 ? "+" : ""}${pctShift}%`, delta: null }];
      if (emplEcoEffect) impacts.push({ label: "Экономика", delta: emplEcoEffect });
      if (emplInflEffect) impacts.push({ label: "Инфляция", delta: emplInflEffect });
      mechanisms.push({
        active: true, severity: emplEcoEffect < 0 ? "bad" : pctShift > 0 ? "good" : "bad",
        name: "Занятость",
        trigger: `Занятость ${emplPct.toFixed(1)}% (старт партии: 95%) — двигает налоговую базу, экономику и инфляцию`,
        impacts,
        fix: pctShift < 0
          ? "Низкая занятость режет налоговые поступления, доход от экономики и саму экономику (зато охлаждает инфляцию). Указы «Стимул экономики» и либерализация поднимают занятость."
          : "Высокая занятость расширяет налоговую базу и укрепляет экономику, но перегретый рынок труда понемногу разгоняет инфляцию (кривая Филлипса).",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Занятость",
        trigger: `Занятость ${emplPct.toFixed(1)}% ≈ стартовый уровень — налоговая база, экономика и инфляция не искажены`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 9. Народное настроение → одобрение (компаундинг среднего класса и низов)
  {
    const mc = stats.middle_class ?? 44;
    const lc = stats.lower_class_mood ?? 41;
    const moodEffect = Math.round((mc - 44) / 30) + Math.round((lc - 41) / 30);
    if (moodEffect !== 0) {
      mechanisms.push({
        active: true, severity: moodEffect > 0 ? "good" : "bad",
        name: "Народное настроение",
        trigger: `Средний класс ${mc} / народ ${lc} vs старт партии 44/41`,
        impacts: [{ label: "Одобрение", delta: moodEffect }],
        fix: moodEffect < 0
          ? "Устойчивое недовольство среднего класса и низов подтачивает одобрение каждый месяц. Социальные и либерализационные указы поднимают оба показателя."
          : "Довольные средний класс и низы постепенно укрепляют одобрение — держите курс.",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Народное настроение",
        trigger: `Средний класс ${mc} / народ ${lc} ≈ стартовый уровень — заметного эффекта нет`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 9.6. Недовольство непопулярными мерами: некоторые политики (НДС до 22%, утильсбор)
  // пополняют казну, но пока действуют — вызывают постоянное недовольство. Раньше такого канала
  // не было вообще — только доход в казну, без цены за него (см. approval_upkeep в turns.js).
  // Название сознательно НЕ "недовольство политиками" — читается как недовольство политиками-
  // людьми, а не решениями/мерами (Петя, 2026-07-04).
  {
    const activePol = (policies || []).filter(p => p.status !== "cancelled");
    const approvalUpkeep = activePol.reduce((s, p) => s + (Number(p.approval_upkeep) || 0), 0);
    const dragPolicies = activePol.filter(p => Number(p.approval_upkeep) < 0);
    if (approvalUpkeep !== 0) {
      mechanisms.push({
        active: true, severity: approvalUpkeep <= -3 ? "bad" : "random",
        name: "Недовольство мерами",
        trigger: dragPolicies.map(p => p.title).join(", ") || "непопулярные меры остаются в силе",
        impacts: [{ label: "Одобрение", delta: approvalUpkeep }],
        fix: "Отмена политики останавливает это недовольство, но убирает и доход в казну (см. вкладку «Политики»).",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Недовольство мерами",
        trigger: "нет действующих политик с постоянным недовольством",
        impacts: [],
        fix: null,
      });
    }
  }

  // 9.5. Организационный рост: все базовые статы здоровы и в этом месяце не сработал ни один
  // автоматический минус на экономику — устойчивое правление даёт скромную отдачу.
  // БАЛАНС (2026-07-04): раньше не смотрел на коррупцию — здоровое, но насквозь коррумпированное
  // правление (коррупция 90, но 4 базовых стата ≥55) всё равно получало бонус "хорошего
  // управления". Коррупционная утечка бьёт по "Казне" (см. п.6 выше), а не по "Экономике"
  // напрямую, поэтому проскальзывала мимо hadEconomyHit — добавлена отдельная проверка: дивиденд
  // не начисляется, если коррупция выше 50 (там же, где начинается реальная утечка бюджета).
  {
    const corrForDividend = stats.corruption ?? 68;
    // БАЛАНС (2026-07-04): игрок запутался — порог "50" тут в сыром внутреннем балле (0-100,
    // выше = хуже), а на экране игрок видит в основном CPI (Transparency International, выше =
    // ЛУЧШЕ, обратное направление) — показываем оба числа с явной подписью, чтобы не нужно было
    // считать в уме, где CPI 28 = ровно порог 50 в сыром балле.
    const corrForDividendCpi = corruptionCpiEquivalent(corrForDividend);
    const hadEconomyHit = mechanisms.some(m => m.active === true && m.impacts.some(i => i.label === "Экономика" && typeof i.delta === "number" && i.delta < 0));
    const corrupt = corrForDividend > 50;
    const allHealthy = eco >= 55 && stab >= 55 && dip >= 55 && appr >= 55;
    const allStrong = eco >= 70 && stab >= 70 && dip >= 70 && appr >= 70;
    if (!hadEconomyHit && !corrupt && allHealthy) {
      const dividend = allStrong ? 2 : 1;
      mechanisms.push({
        active: true, severity: "good",
        name: "Организационный рост",
        trigger: `Экономика ${eco}, стабильность ${stab}, дипломатия ${dip}, рейтинг ${appr} — все здоровы, коррупция под контролем (внутренний балл ${corrForDividend}, CPI ${corrForDividendCpi}), кризисов на экономику не было`,
        impacts: [{ label: "Экономика", delta: dividend }],
        fix: null,
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Организационный рост",
        trigger: hadEconomyHit
          ? "В этом месяце уже сработал автоматический минус на экономику — дивиденд не начисляется"
          : corrupt
          ? `Коррупция: внутренний балл ${corrForDividend} > 50 (CPI ${corrForDividendCpi} < 28 — напомним, у CPI выше = лучше) — бюджет разворовывается, "здоровое правление" не считается`
          : `Не все базовые статы ≥55 (экономика ${eco}, стабильность ${stab}, дипломатия ${dip}, рейтинг ${appr})`,
        impacts: [],
        fix: hadEconomyHit ? null : corrupt ? "Запустите антикоррупционную кампанию, чтобы поднять CPI до ≥28 (сырой балл ≤50)." : "Поднимите экономику, стабильность, дипломатию и рейтинг выше 55 одновременно и избегайте кризисов — тогда экономика начнёт расти сама по себе (+1, или +2, если все показатели выше 70).",
      });
    }
  }

  // 10. Мятеж элит (вероятностный, только при низком elite_satisfaction)
  {
    const eliteSat = stats.elite_satisfaction ?? 62;
    if (eliteSat < 35) {
      mechanisms.push({
        active: true, severity: "crit",
        name: "Риск мятежа элит",
        trigger: `Элиты ${eliteSat} < 35 — 15% шанс выступления силового блока`,
        impacts: [{ label: "Стабильность −4…−9, Одобрение −0…−4, Армия −0…−3", delta: null }],
        fix: "Не гарантированно подавляется быстро (55% шанс перерасти в тяжёлый кризис). Консолидация элит или уступки силовикам снижают риск.",
      });
    } else {
      mechanisms.push({
        active: false,
        name: "Риск мятежа элит",
        trigger: `Элиты ${eliteSat} ≥ 35 — риска нет`,
        impacts: [],
        fix: null,
      });
    }
  }

  // 11. Domestic crisis (always probabilistic) — стабильность реально гасит удар (до 50% при 100)
  {
    const crisisMitigationPct = stab > 60 ? Math.round(Math.min(0.5, (stab - 60) / 80) * 100) : 0;
    mechanisms.push({
      active: "random", severity: "random",
      name: "Внутренний кризис",
      trigger: crisisMitigationPct > 0
        ? `7% шанс каждый месяц — но стабильность ${stab} гасит удар на ${crisisMitigationPct}%`
        : "7% шанс каждый месяц — случайное событие",
      impacts: [{ label: crisisMitigationPct > 0 ? `≈ −4…−7 к одной из стат (смягчено на ${crisisMitigationPct}%)` : "≈ −4…−7 к одной из стат", delta: null }],
      fix: "Нельзя устранить полностью. Стабильность выше 60 гасит удар (до 50% при стабильности 100) — крепкий тыл реально снижает потери, а не просто ограничивает их сверху.",
    });
  }

  // БАЛАНС (2026-07-04): раньше totalDrain суммировал ЛЮБОЙ отрицательный delta из ЛЮБОГО
  // impact (Экономика, Одобрение, Казна, Армия — всё вперемешку, разные "валюты" очков) в одно
  // число "≈X/мес авто" — игрок принял его за прогноз по экономике конкретно, а на деле это была
  // смесь нескольких статов. Теперь считаем "Экономика" отдельно (это и есть то, о чём спрашивал
  // игрок) и отдельно отмечаем, что есть ещё влияние на другие статы, а не сваливаем всё в одну кучу.
  const activeCount = mechanisms.filter(m => m.active === true).length;
  const activeImpacts = mechanisms.filter(m => m.active === true).flatMap(m => m.impacts).filter(i => i.delta !== null);
  const economyDrain = activeImpacts.filter(i => i.label === "Экономика" && i.delta < 0).reduce((s, i) => s + i.delta, 0);
  // economyDrain — только отрицательные эффекты (см. комментарий БАЛАНС 2026-07-04 выше).
  // Игрок (Петя, 2026-07-07) увидел в бейдже "≈-1/мес" рядом с зелёной карточкой "Профицит
  // казны +1" и разумно спросил "так у меня чистый минус?" — бейдж НЕ вычитал плюсы, хотя
  // они в той же "валюте" (Экономика), в отличие от исходной проблемы (там мешались Экономика/
  // Одобрение/Казна). Добавляем economyGain и сальдо economyNet — то же разделение по статам,
  // что было задумано, но без потери ответа на самый частый вопрос "сколько чистыми".
  const economyGain = activeImpacts.filter(i => i.label === "Экономика" && i.delta > 0).reduce((s, i) => s + i.delta, 0);
  const economyNet = economyDrain + economyGain;
  const otherNegativeLabels = new Set(activeImpacts.filter(i => i.label !== "Экономика" && i.delta < 0).map(i => i.label));

  // БАЛАНС (2026-07-04): "bad" изначально был жёлто-коричневым (khaki) — Петя не понравился
  // цвет предупреждения. Перешёл на терракотовый/кирпичный (тёплый тёмно-красный оттенок,
  // визуально отличимый от "crit", но без жёлтого).
  const severityColor = { crit: "#e08080", bad: "#c88060", good: "#7fae93", random: "#b8a0e0" };
  const severityBg = { crit: "#3a1418", bad: "#3a2016", good: "#142418", random: "#221a38" };

  return (
    <div style={{ marginBottom: 14, borderRadius: 6, border: `1px solid ${activeCount > 0 ? "#c8a87a" : "#2a3040"}`, overflow: "hidden", background: "#14181f" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ cursor: "pointer", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.1em", color: "#8a8472" }}>КОНЕЦ МЕСЯЦА · МЕХАНИКИ</span>
          {activeCount > 0 && (
            <span style={{ fontSize: 9, background: "#3a1418", color: "#e08080", borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontWeight: 700 }}>
              {activeCount} активно
            </span>
          )}
          {economyNet !== 0 && (
            <span
              style={{ fontSize: 9, background: economyNet < 0 ? "#3a1418" : "#142418", color: economyNet < 0 ? "#e08080" : "#7fae93", borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontWeight: 700 }}
              title={economyGain > 0 && economyDrain < 0 ? `Сальдо: минусы ${economyDrain} + плюсы +${economyGain}. Другие статы (Одобрение и т.п.) считаются отдельно.` : "Только эффект на Экономику — другие статы считаются отдельно"}
            >
              экономика ≈{economyNet >= 0 ? "+" : ""}{economyNet}/мес авто
            </span>
          )}
          {otherNegativeLabels.size > 0 && (
            <span style={{ fontSize: 9, background: "#221a38", color: "#b8a0e0", borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontWeight: 700 }}>
              + {otherNegativeLabels.size} др. стат{otherNegativeLabels.size > 1 ? "ы" : "а"}
            </span>
          )}
        </div>
        <span style={{ color: "#9c8347", fontSize: 16, transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid #2a3040", padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {mechanisms.map((m, i) => {
            const color = m.active === false ? "#a8a294" : (severityColor[m.severity] || "#a8a294");
            const bg = m.active === false ? "#1a2030" : (severityBg[m.severity] || "#14181f");
            return (
              <div key={i} style={{ background: bg, borderRadius: 5, border: `1px solid ${m.active === false ? "#2a3040" : color + "55"}`, padding: "8px 10px" }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span className="doc-font" style={{ fontSize: 12, fontWeight: 700, color: m.active === false ? "#a8a294" : "#ece7d8" }}>{m.name}</span>
                  {m.active === false && (
                    <span className="mono-font" style={{ fontSize: 8, color: "#a8a294", background: "#232838", borderRadius: 2, padding: "1px 5px" }}>НЕ АКТИВЕН</span>
                  )}
                  {m.active === "random" && (
                    <span className="mono-font" style={{ fontSize: 8, color: "#b8a0e0", background: "#221a38", borderRadius: 2, padding: "1px 5px" }}>СЛУЧАЙНЫЙ</span>
                  )}
                </div>
                {/* Trigger condition */}
                <div className="mono-font" style={{ fontSize: 9.5, color: color, marginBottom: m.impacts.length > 0 || m.fix ? 6 : 0, lineHeight: 1.4 }}>
                  {m.trigger}
                </div>
                {/* Impact chips */}
                {m.impacts.length > 0 && m.active !== false && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: m.fix ? 6 : 0 }}>
                    {m.impacts.map((imp, j) => {
                      // БАЛАНС (2026-07-04): красили чисто по знаку дельты — «Инфляция −1»
                      // (падение инфляции, это ХОРОШО) красилось в красный. Инфляция (и другие
                      // INVERTED_STATS) — чем меньше, тем лучше, знак нужно инвертировать.
                      const impKey = IMPACT_STAT_KEY[imp.label];
                      const inverted = impKey && INVERTED_STATS.has(impKey);
                      const isNeg = imp.delta !== null && (inverted ? imp.delta > 0 : imp.delta < 0);
                      const isPos = imp.delta !== null && (inverted ? imp.delta < 0 : imp.delta > 0);
                      const chipColor = isNeg ? "#e08080" : isPos ? "#7fae93" : "#b8a0e0";
                      const chipBg = isNeg ? "#3a1418" : isPos ? "#142418" : "#221a38";
                      const pct = impactPercent(imp.label, imp.delta, stats);
                      // БАЛАНС (2026-07-04): «Казна» тут — очки условной шкалы 0-100/−100..100, не
                      // деньги. Раньше конец-месяца прогноз (ОФЗ, коррупционная утечка) показывал
                      // только очки — везде в TreasuryTab рядом с очками уже давно есть ₽-эквивалент
                      // (TREASURY_PER_TRILLION), тут его не было ни разу.
                      const rubHint = imp.label === "Казна" && imp.delta !== null
                        ? `${imp.delta > 0 ? "+" : ""}₽${(imp.delta * TREASURY_PER_TRILLION).toFixed(1)} трлн` : null;
                      return (
                        <span key={j} className="mono-font" style={{ fontSize: 10, background: chipBg, color: chipColor, borderRadius: 3, padding: "2px 7px", fontWeight: 700 }}>
                          {imp.label}{imp.delta !== null ? ` ${imp.delta > 0 ? "+" : ""}${imp.delta}` : ""}
                          {pct !== null && <span style={{ opacity: 0.75, fontWeight: 400 }}> ({pct > 0 ? "+" : ""}{pct}%)</span>}
                          {rubHint && <span style={{ opacity: 0.75, fontWeight: 400 }}> ({rubHint})</span>}
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* Fix hint */}
                {m.fix && m.active !== false && (
                  <div style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                    <span style={{ color: "#9c8347", fontSize: 11, flexShrink: 0, marginTop: 1 }}>→</span>
                    <span className="doc-font" style={{ fontSize: 11, color: "#a8a294", lineHeight: 1.45 }}>{m.fix}</span>
                  </div>
                )}
              </div>
            );
          })}
          <div className="mono-font" style={{ fontSize: 9, color: "#a8a294", lineHeight: 1.5, paddingTop: 2 }}>
            Бюджет (доходы − расходы → казна) отражается в ленте после каждого завершения месяца.
          </div>
        </div>
      )}
    </div>
  );
}

function getPassiveEffects(key, stats) {
  const mil = stats.military ?? 50;
  const inf = stats.inflation ?? 64;
  const trs = stats.treasury ?? 52;
  const eco = stats.economy ?? 50;
  const stab = stats.stability ?? 50;
  const dip = stats.diplomacy ?? 50;
  const appr = stats.approval ?? 50;
  const streak = stats.military_streak ?? 0;
  const corr = stats.corruption ?? 68;
  const mc = stats.middle_class ?? 44;
  const lc = stats.lower_class_mood ?? 41;
  const eliteSat = stats.elite_satisfaction ?? 62;
  const rate = stats.key_rate ?? 18.5;
  const gdp = stats.gdp_growth ?? 36;
  const empl = stats.employment ?? 74;
  const wearinessHit = streak >= 4 ? Math.min(5, Math.floor((streak - 3) * 1.5)) : 0;
  const moodEffect = Math.round((mc - 44) / 30) + Math.round((lc - 41) / 30);
  const effects = [];

  if (key === "economy") {
    let hadNegative = false;
    if (mil >= 50 && mil <= 80) {
      const defenseBoost = Math.floor((mil - 50) / 15);
      if (defenseBoost > 0) {
        effects.push({ sign: +1, value: defenseBoost, text: `Оборонзаказ (ВПК): армия ${mil} в диапазоне 50-80` });
      }
    }
    if (mil > 80) {
      const tax = Math.floor((mil - 80) / 10) + 1;
      effects.push({ sign: -1, value: tax, text: `Военное бремя: содержание армии (${mil} > 80)` });
      hadNegative = true;
    }
    if (wearinessHit > 0) {
      const warEconDrag = Math.ceil(wearinessHit / 3);
      effects.push({ sign: -1, value: warEconDrag, text: `Военное бремя: усталость от войны (${streak}-я боевая операция подряд без передышки)` });
      hadNegative = true;
    }
    if (inf > 73) {
      const pen = Math.min(3, Math.floor((inf - 73) / 10) + 1);
      effects.push({ sign: -1, value: pen, text: `Инфляционный шок (${inflationPercent(inf).toFixed(0)}% > 15% г/г)` });
      hadNegative = true;
    }
    if (trs < 0) {
      effects.push({ sign: -1, value: 2, text: `Дефицит казны (${trs} < 0)` });
      hadNegative = true;
    } else if (trs < 15) {
      effects.push({ sign: -1, value: 1, text: `Низкая казна (${trs} < 15)` });
      hadNegative = true;
    } else if (trs > 65 && eco < 82) {
      effects.push({ sign: +1, value: 1, text: `Профицит казны (${trs} > 65)` });
    }
    if (rate > 17) {
      effects.push({ sign: -1, value: 1, text: `Ключевая ставка ЦБ высокая (${rate}% > 17%)` });
      hadNegative = true;
    } else if (rate < 11) {
      effects.push({ sign: +1, value: 1, text: `Ключевая ставка ЦБ низкая (${rate}% < 11%)` });
    }
    const gdpEffect = Math.round((gdp - 36) / 8);
    if (gdpEffect) {
      effects.push({ sign: gdpEffect > 0 ? 1 : -1, value: Math.abs(gdpEffect), text: `Рост ВВП vs старт партии (${gdpGrowthPercent(gdp).toFixed(1)}% г/г)` });
      if (gdpEffect < 0) hadNegative = true;
    }
    // Стагнация/спад ВВП (Петя, 2026-07-05): рост ≤1% г/г — уже штраф, не просто "нет бонуса"
    const gdpPctBadge = gdpGrowthPercent(gdp);
    const gdpStagnationBadge = gdpPctBadge <= 1 ? Math.min(-1, Math.round((gdpPctBadge - 1) / 2)) : 0;
    if (gdpStagnationBadge) {
      effects.push({ sign: -1, value: Math.abs(gdpStagnationBadge), text: `Стагнация/спад ВВП (${gdpPctBadge.toFixed(1)}% г/г ≤ 1%)` });
      hadNegative = true;
    }
    const emplEconomyEffect = Math.round((empl - 74) / 10);
    if (emplEconomyEffect) {
      effects.push({ sign: emplEconomyEffect > 0 ? 1 : -1, value: Math.abs(emplEconomyEffect), text: `Занятость vs старт партии (${employmentRatePercent(empl).toFixed(1)}%)` });
      if (emplEconomyEffect < 0) hadNegative = true;
    }
    if (corr > 50) {
      const drain = Math.round(Math.pow((corr - 50) / 50, 1.3) * 12);
      effects.push({ sign: -1, value: drain, text: `Коррупционная утечка бюджета (бьёт по казне, элиты в доле)` });
      // БАЛАНС (2026-07-04): раньше не помечал hadNegative — коррумпированное, но формально
      // "здоровое" правление (4 базовых стата ≥55) всё ещё получало бонус "Организационный рост"
      // ниже, хотя бюджет уже разворовывается. hadNegative тут — общий флаг "был автоматический
      // штраф в этом месяце", им уже помечены дефицит/низкая казна (тоже про казну, не экономику
      // напрямую) — коррупция логически то же самое.
      hadNegative = true;
    }
    // Организационный рост: все базовые статы здоровы и в этом месяце не сработал ни один
    // автоматический минус на экономику — устойчивое правление даёт скромную отдачу.
    if (!hadNegative && eco >= 55 && stab >= 55 && dip >= 55 && appr >= 55) {
      const dividend = (eco >= 70 && stab >= 70 && dip >= 70 && appr >= 70) ? 2 : 1;
      effects.push({ sign: +1, value: dividend, text: `Организационный рост: все базовые статы здоровы, кризисов нет` });
    }
  }

  if (key === "military") {
    if (mil > 80) {
      const tax = Math.floor((mil - 80) / 10) + 1;
      effects.push({ sign: -1, value: tax, text: `→ Экономика −${tax}/мес (армия выше порога 80)` });
    }
  }

  if (key === "approval") {
    if (inf > 73) {
      const pen = Math.min(2, Math.floor((inf - 73) / 15) + 1);
      effects.push({ sign: -1, value: pen, text: `Инфляционный шок (${inflationPercent(inf).toFixed(0)}% > 15% г/г)` });
    }
    if (mil > 80) {
      effects.push({ sign: -1, value: 1, text: `Военное бремя: содержание армии (армия > 80)` });
    }
    if (wearinessHit > 0) {
      effects.push({ sign: -1, value: wearinessHit, text: `Военное бремя: усталость от войны (${streak}-я боевая операция подряд без передышки)` });
    }
    if (moodEffect) {
      effects.push({ sign: moodEffect > 0 ? 1 : -1, value: Math.abs(moodEffect), text: `Народное настроение (средний класс ${mc}, народ ${lc})` });
    }
  }

  if (key === "stability") {
    if (trs < 0) {
      effects.push({ sign: -1, value: 1, text: `Дефицит казны (${trs} < 0)` });
    }
    if (eliteSat < 35) {
      effects.push({ sign: -1, value: 4, text: `⚠ Риск мятежа элит (15% шанс, элиты ${eliteSat} < 35, до −9 если перерастёт)` });
    }
    if (wearinessHit > 0) {
      effects.push({ sign: -1, value: Math.ceil(wearinessHit / 2), text: `Военное бремя: усталость от войны (${streak}-я боевая операция подряд без передышки)` });
    }
  }

  return effects;
}

// Вынесено на уровень модуля — переиспользуется и в StatsTab, и в TreasuryTab
// (обе вкладки показывают, какие указы/операции реально подвинули конкретный стат).
const ACTION_TYPE_LABEL = {
  // Новые категории (см. docs/04-cabinet-and-categories.md)
  mil_recon: "Военная разведка",
  mil_tactical: "Тактический удар",
  mil_operational_offensive: "Наступление",
  mil_operational_defensive: "Оборона",
  mil_strategic_offensive: "Стратегическое наступление",
  mil_strategic_defensive: "Стратегическая оборона",
  mil_hybrid: "Гибридная война",
  covert_destabilize: "Дестабилизация",
  covert_sabotage: "Диверсия",
  covert_disinfo: "Дезинформация",
  covert_elimination: "Ликвидация",
  diplo_negotiate: "Переговоры",
  diplo_treaty: "Договор",
  diplo_pressure: "Давление",
  diplo_multilateral: "Коалиция",
  diplo_soft_power: "Мягкая сила",
  diplo_peace: "Мирная инициатива",
  econ_stimulus: "Стимул эк-ки",
  econ_austerity: "Жёсткая экономия",
  econ_sanctions_counter: "Контрсанкции",
  econ_infrastructure: "Инфраструктура",
  econ_tech: "Технологии",
  mil_admin_budget: "Оборонный бюджет",
  mil_admin_mobilization: "Мобилизация",
  mil_admin_doctrine: "Военная доктрина",
  pol_repression: "Подавление",
  pol_liberalization: "Либерализация",
  pol_elite_consolidation: "Консолидация элит",
  pol_social: "Соцпрограмма",
  pol_propaganda: "Пропаганда",
  military_regroup: "Перегруппировка",
  null_action: "Бездействие",
  nuclear_strike: "Ядерный удар",
  // Старые категории — оставлены для истории партий, начатых до расширения категорий
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
  intel_success: "Разведка (успех)",
  intel_critical_success: "Разведка (блестящий успех)",
  intel_failure: "Разведка (провал)",
  intel_critical_failure: "Разведка (крит. провал)",
};

// Для заданного стата — последние 4 хода из истории партии, где он значимо
// изменился (|delta| >= 2), с указанием какая категория действия это сделала.
function getStatEvents(statHistory, key) {
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

function StatsTab({ state, gameId }) {
  const [openStat, setOpenStat] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [statHistory, setStatHistory] = useState(null);

  useEffect(() => {
    fetchStatHistory(gameId).then(d => setStatHistory(d.history || [])).catch(() => {});
  }, [gameId]);

  return (
    <>
      <EndMonthForecastPanel stats={state.stats} policies={state.policies} />
      <div style={{ display: "grid", gap: 10 }}>
        {Object.entries(state.stats).filter(([key]) => statMeta[key]).map(([key, value]) => {
          const meta = statMeta[key];
          const Icon = meta.icon;
          const substats = (SUBSTAT_META[key] || []).map(sm => ({ ...sm, value: state.stats[sm.key] ?? 50 }));
          const expanded = expandedKey === key;
          const events = getStatEvents(statHistory, key);

          const passiveEffects = getPassiveEffects(key, state.stats);
          const passiveTotal = passiveEffects.reduce((s, e) => s + e.sign * e.value, 0);

          return (
            <div key={key} style={{ borderRadius: 6, background: "#161b26", border: `1px solid ${expanded ? meta.color : "#2a3040"}`, transition: "border-color 0.15s", overflow: "hidden" }}>
              {/* Header — click to expand substats */}
              <div
                onClick={() => setExpandedKey(expanded ? null : key)}
                style={{ cursor: "pointer", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon size={15} color={meta.color} />
                  <span className="doc-font" style={{ fontSize: 14, fontWeight: 700, color: "#ece7d8" }}>{statLabel(key, meta.label)}</span>
                  {events.length > 0 && (
                    <span style={{ fontSize: 9, background: "#2a3040", color: "#a8a294", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>
                      {t("stats.events_count", { n: events.length })}
                    </span>
                  )}
                  {passiveTotal < 0 && (
                    <span style={{ fontSize: 9, background: "#2a0808", color: "#e09090", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace", fontWeight: 700 }}>
                      ⚠ {t("stats.auto_negative", { n: passiveTotal })}
                    </span>
                  )}
                  {passiveTotal > 0 && (
                    <span style={{ fontSize: 9, background: "#0a1a0d", color: "#7fae93", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace", fontWeight: 700 }}>
                      {t("stats.auto_positive", { n: passiveTotal })}
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
                <div style={{ borderTop: "1px solid #2a3040", padding: "12px 12px 14px" }}>
                  {/* Substats */}
                  {substats.length > 0 && (
                    <>
                      <div className="mono-font" style={{ fontSize: 8, color: "#a8a294", letterSpacing: "0.08em", marginBottom: 8 }}>{t("stats.detailed_metrics")}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: events.length > 0 ? 14 : 0 }}>
                        {substats.map(s => {
                          const displayVal = s.inverted ? 100 - s.value : s.value;
                          const clr = displayVal >= 60 ? "#7fae93" : displayVal >= 40 ? "#9c8347" : "#e09090";
                          return (
                            <div key={s.key}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span className="doc-font" style={{ fontSize: 11, color: "#cdd3e0" }}>{s.label}</span>
                                <span className="mono-font" style={{ fontSize: 11, color: clr, fontWeight: 700 }}>{formatSubstatValue(s.key, s.value)}</span>
                              </div>
                              <div style={{ height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ width: `${displayVal}%`, height: "100%", background: clr }} />
                              </div>
                              {s.desc && <div className="mono-font" style={{ fontSize: 8.5, color: "#8a9aaa", marginTop: 2, lineHeight: 1.3 }}>{substatDesc(s.key, s.desc)}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Events affecting this stat */}
                  {events.length > 0 && (
                    <>
                      <div className="mono-font" style={{ fontSize: 8, color: "#a8a294", letterSpacing: "0.08em", marginBottom: 6 }}>{t("stats.events_header")}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {events.map((ev, i) => {
                          const positive = ev.delta > 0;
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: positive ? "#0a1a0d" : "#2a0808", borderRadius: 3, borderLeft: `3px solid ${positive ? "#4a6b5c" : "#a8313a"}` }}>
                              <span className="mono-font" style={{ fontSize: 10, fontWeight: 700, color: positive ? "#7fae93" : "#e09090", minWidth: 28 }}>
                                {positive ? "+" : ""}{ev.delta}
                              </span>
                              <span className="doc-font" style={{ fontSize: 11, color: "#cdd3e0", flex: 1 }}>
                                {actionTypeLabel(ev.actionType, ACTION_TYPE_LABEL[ev.actionType] || ev.actionType)}
                              </span>
                              <span className="mono-font" style={{ fontSize: 9, color: "#8a9aaa" }}>{t("stats.turn_short", { n: ev.turn })}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {passiveEffects.length > 0 && (
                    <div style={{ marginTop: events.length > 0 ? 12 : 0, borderTop: events.length > 0 ? "1px solid #2a3040" : "none", paddingTop: events.length > 0 ? 10 : 0 }}>
                      <div className="mono-font" style={{ fontSize: 8, color: "#a8a294", letterSpacing: "0.08em", marginBottom: 6 }}>{t("stats.auto_effects_header")}</div>
                      {passiveEffects.map((eff, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: eff.sign < 0 ? "#2a0808" : "#0a1a0d", borderRadius: 3, borderLeft: `3px solid ${eff.sign < 0 ? "#a8313a" : "#4a6b5c"}`, marginBottom: 4 }}>
                          <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: eff.sign < 0 ? "#e09090" : "#7fae93", minWidth: 30 }}>
                            {eff.sign < 0 ? "−" : "+"}{eff.value}
                          </span>
                          <span className="doc-font" style={{ fontSize: 11, color: "#cdd3e0", flex: 1 }}>{eff.text}</span>
                        </div>
                      ))}
                      {passiveEffects.length > 1 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", marginTop: 2 }}>
                          <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: passiveTotal < 0 ? "#e09090" : "#7fae93", minWidth: 30 }}>
                            {passiveTotal < 0 ? "−" : "+"}{Math.abs(passiveTotal)}
                          </span>
                          <span className="mono-font" style={{ fontSize: 9, color: "#a8a294" }}>{t("stats.auto_total")}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={e => { e.stopPropagation(); setOpenStat(key); }}
                    style={{ marginTop: 12, background: "none", border: `1px solid ${meta.color}`, borderRadius: 3, padding: "5px 12px", fontSize: 11, color: meta.color, cursor: "pointer", fontFamily: "'PT Serif',serif" }}
                  >
                    {t("stats.detail_analysis_btn")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Разведданные по противнику — Украина */}
      {Object.keys(UA_STAT_META).some(k => state.stats[k] != null) && (
        <div style={{ marginTop: 16, borderRadius: 6, background: "#161b26", border: "1px solid #2a3040", padding: "12px 12px 14px" }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#a8a294", letterSpacing: "0.08em", marginBottom: 10 }}>
            🇺🇦 {t("stats.ua_intel_header")}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {Object.entries(UA_STAT_META).map(([key, meta]) => {
              const value = state.stats[key] ?? 50;
              const Icon = meta.icon;
              return (
                <div key={key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon size={13} color={meta.color} />
                      <span className="doc-font" style={{ fontSize: 12.5, color: "#cdd3e0" }}>{statLabel(key, meta.label)}</span>
                    </div>
                    <span className="mono-font" style={{ fontSize: 12.5, fontWeight: 700, color: meta.color }}>{value}</span>
                  </div>
                  <Bar value={value} color={meta.color} />
                  <div className="mono-font" style={{ fontSize: 8.5, color: "#8a9aaa", marginTop: 2, lineHeight: 1.3 }}>{substatDesc(key, meta.desc)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
  const statusLabel = isCancelled ? t("policies.status_cancelled") : policy.status === "completed" ? t("policies.status_completed") : t("policies.status_active");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.85)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f5f1e6", borderRadius: 8, width: "min(95vw,520px)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div style={{ background: "#1a1f2c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: (POLICY_CATEGORY[policy.category]?.color) || "#9c8347" }}>
            {t("policies.detail_title", { cat: policy.category ? policyCategoryLabel(policy.category, POLICY_CATEGORY[policy.category]?.label) : t("policies.default_category") })}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "18px 20px" }}>
          {/* Заголовок */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div className="doc-font" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, flex: 1, marginRight: 12, color: "#3a362e" }}>{policy.title}</div>
            <span className="mono-font" style={{ fontSize: 8, padding: "3px 8px", borderRadius: 3, background: isCancelled ? "#d8d2bf" : "#dce5dc", color: statusColor, flexShrink: 0, letterSpacing: "0.06em" }}>{statusLabel}</span>
          </div>

          {/* Прогресс — только если у политики вообще есть срок (target_turn). Постоянные меры
              (например, уже введённые в реальности налоги — НДС22, утильсбор) действуют бессрочно,
              пока их не отменят: показывать для них "прогресс" было бы неверно (раньше без этой
              проверки прогресс-бар для таких политик залипал на 100%, будто она вот-вот завершится). */}
          {!isCancelled && (
            <div style={{ background: "#ece7d8", borderRadius: 4, padding: "12px 14px", marginBottom: 14 }}>
              {policy.target_turn != null ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>{t("policies.progress_header")}</span>
                    <span className="mono-font" style={{ fontSize: 9, color: "#5c5648", fontWeight: 700 }}>{progress}%</span>
                  </div>
                  <div style={{ height: 8, background: "#d8d2bf", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${progress}%`, height: "100%", background: progress >= 100 ? "#4a6b5c" : "#9c8347", transition: "width 0.4s" }} />
                  </div>
                </>
              ) : (
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>{t("policies.indefinite_full")}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#8a8472" }}>{t("policies.introduced_turn", { n: policy.turn })}</span>
                {turnsLeft !== null && (
                  <span className="mono-font" style={{ fontSize: 8, color: turnsLeft <= 1 ? "#a8313a" : "#5c5648", fontWeight: turnsLeft <= 1 ? 700 : 400 }}>
                    {turnsLeft === 0 ? t("policies.finishing_upper") : t("policies.turns_left_full", { n: turnsLeft, target: policy.target_turn })}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Пока действует: реальный помесячный эффект (доход/расход казны, недовольство) — раньше
              этой информации не было вообще, был только "effect_stats" (косметическое "при успехе
              вырастут", ничего не значащее численно) и cancel_penalty (что будет ПРИ ОТМЕНЕ). Игрок
              не мог увидеть, что политика ПРЯМО СЕЙЧАС даёт доход и/или тянет вниз одобрение. */}
          {!isCancelled && Boolean(Number(policy.budget_income) || Number(policy.budget_upkeep) || Number(policy.approval_upkeep)) && (
            <div style={{ background: "#e8e4d4", border: "1px solid #9c8347", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#7a6a30", marginBottom: 5 }}>{t("policies.while_active_header")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px" }}>
                {Number(policy.budget_income) > 0 && (
                  <span className="doc-font" style={{ fontSize: 13, color: "#2f6f5f", fontWeight: 700 }}>{t("policies.treasury_income_plain", { n: policy.budget_income, rub: (Number(policy.budget_income) * TREASURY_PER_TRILLION).toFixed(1), trillion: t("treasury.trillion") })}</span>
                )}
                {Number(policy.budget_upkeep) > 0 && (
                  <span className="doc-font" style={{ fontSize: 13, color: "#a8313a", fontWeight: 700 }}>{t("policies.treasury_upkeep_plain", { n: policy.budget_upkeep, rub: (Number(policy.budget_upkeep) * TREASURY_PER_TRILLION).toFixed(1), trillion: t("treasury.trillion") })}</span>
                )}
                {(Number(policy.approval_upkeep) || 0) !== 0 && (
                  <span className="doc-font" style={{ fontSize: 13, color: Number(policy.approval_upkeep) < 0 ? "#a8313a" : "#2f6f5f", fontWeight: 700 }}>
                    {t("policies.approval_plain", { sign: Number(policy.approval_upkeep) > 0 ? "+" : "", n: policy.approval_upkeep })}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Влияет на (при успехе) */}
          {policy.effect_stats && Object.keys(policy.effect_stats).length > 0 && (
            <div style={{ background: "#e3eadf", border: "1px solid #3a8a7a", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#2f6f5f", marginBottom: 5 }}>{t("policies.success_effects_header")}</div>
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
              <div className="mono-font" style={{ fontSize: 8, color: "#4a6b5c", marginBottom: 3 }}>{t("policies.completion_condition_header")}</div>
              <div className="doc-font" style={{ fontSize: 13, color: "#3a362e" }}>{policy.completion_conditions}</div>
            </div>
          )}

          {/* Последствия отмены */}
          {!isCancelled && policy.cancel_penalty && Object.keys(policy.cancel_penalty).length > 0 && (
            <div style={{ background: "#f0e6e0", border: "1px solid #b07a5a", borderRadius: 4, padding: "9px 12px", marginBottom: 14 }}>
              <div className="mono-font" style={{ fontSize: 8, color: "#9a5a3a", marginBottom: 5 }}>{t("policies.cancel_consequences_header")}</div>
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
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>{t("policies.content_header")}</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(policy.items || []).map((item, i) => (
                <li key={i} className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 5, color: "#3a362e" }}>{item}</li>
              ))}
            </ul>
          </div>

          {/* Новости */}
          <div style={{ marginBottom: 16 }}>
            <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8 }}>{t("policies.news_header")}</div>
            {news === null && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472" }}>{t("policies.loading")}</div>}
            {news?.length === 0 && <div className="doc-font" style={{ fontSize: 12, color: "#8a8472", fontStyle: "italic" }}>{t("policies.no_news_yet")}</div>}
            {news?.slice(0, 5).map((item, i) => (
              <div key={i} style={{ borderTop: "1px solid #d8d2bf", paddingTop: 8, marginBottom: 8 }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>{t("policies.turn_source", { n: item.turn_n, source: item.source })}</div>
                <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2, color: "#3a362e" }}>{item.text}</div>
              </div>
            ))}
          </div>

          {/* Отмена */}
          {!isCancelled && policy.status !== "completed" && (
            !confirmCancel
              ? <button onClick={() => setConfirmCancel(true)} style={{ background: "none", border: "1px solid #a8313a", borderRadius: 4, padding: "7px 14px", color: "#a8313a", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>{t("policies.cancel_btn")}</button>
              : <div style={{ background: "#3a2424", border: "1px solid #a8313a", borderRadius: 4, padding: "12px 14px" }}>
                  <div className="doc-font" style={{ fontSize: 13, color: "#ece7d8", marginBottom: 10 }}>
                    {policy.cancel_penalty && Object.keys(policy.cancel_penalty).length > 0
                      ? <>{t("policies.cancel_consequences_intro")}{penaltyEntries(policy.cancel_penalty).map((e, i) => (
                          <span key={i} style={{ color: e.good ? "#a0c090" : "#e09090", fontWeight: 700 }}>{i > 0 ? ", " : ""}{e.label} {e.delta > 0 ? "+" : ""}{e.delta}</span>
                        ))}.{t("policies.continue_q")}</>
                      : (() => {
                          const income = Number(policy.budget_income) || 0;
                          const upkeep = Number(policy.budget_upkeep) || 0;
                          const economyDelta = income > 0 ? -Math.min(6, Math.max(1, Math.round(income / 4))) : 0;
                          const approvalDelta = -1 - (upkeep > 8 ? Math.min(3, Math.round(upkeep / 10)) : 0);
                          const bits = [t("policies.stability_penalty"), t("policies.approval_penalty_label", { n: approvalDelta })];
                          if (economyDelta) bits.push(t("policies.economy_penalty_label", { n: economyDelta }));
                          const budgetBits = [];
                          if (income > 0) budgetBits.push(t("policies.budget_loses_income", { n: income }));
                          if (upkeep > 0) budgetBits.push(t("policies.budget_saves_upkeep", { n: upkeep }));
                          return t("policies.cancel_penalty_generic", { bits: bits.join(", "), budgetBits: budgetBits.length ? ` ${budgetBits.join(", ")}.` : "" });
                        })()}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleCancel} disabled={cancelling} style={{ background: "#a8313a", color: "#fff", border: "none", borderRadius: 4, padding: "7px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>{cancelling ? t("policies.cancelling") : t("policies.confirm_yes")}</button>
                    <button onClick={() => setConfirmCancel(false)} style={{ background: "none", border: "1px solid #5c5648", borderRadius: 4, padding: "7px 14px", color: "#5c5648", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>{t("policies.confirm_no")}</button>
                  </div>
                </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- КРЕМЛЬ: браузер категорий действий с карточками ----------
// Каждая карточка — категория из docs/04-cabinet-and-categories.md. Клик заполняет
// draftInput шаблоном и выставляет actionMode — дальше игрок правит текст и жмёт
// «Рассмотреть» как обычно (тот же поток preview→confirm, ничего нового не изобретаем).
const KREMLIN_STAT_LABEL = { economy: "Экономика", military: "Армия", stability: "Стабильность", diplomacy: "Дипломатия", approval: "Одобрение" };

const KREMLIN_CATEGORIES = {
  military: [
    { id: "mil_recon", title: "Военная разведка", desc: "Спутники, SIGINT, разведка боем перед операцией. Даёт бонус к следующей боевой операции.", cost: "15 иниц. / 3 казны", effects: { military: 1 },
      variants: [
        "Начальнику Генштаба поручаю провести разведывательную операцию на Запорожском направлении перед готовящимся наступлением.",
        "Начальнику Генштаба поручаю провести разведку боем на Харьковском направлении для вскрытия обороны противника.",
        "Начальнику Генштаба поручаю провести спутниковую и радиоэлектронную разведку вдоль левого берега Днепра на Херсонском направлении.",
        "Начальнику Генштаба поручаю провести разведку боем на Донецком направлении для вскрытия огневых точек противника.",
        "Начальнику Генштаба поручаю провести доразведку целей беспилотниками по всей линии соприкосновения перед плановой операцией.",
        "Начальнику Генштаба поручаю провести разведывательно-диверсионные мероприятия на Луганском направлении для уточнения группировки противника.",
      ] },
    { id: "mil_tactical", title: "Тактический удар", desc: "Точечный удар, локальная контратака, штурм позиции.", cost: "30 иниц. / 10 казны", effects: { military: 1, stability: -1, diplomacy: -1 },
      variants: [
        "Приказываю нанести точечный удар по укреплённому узлу обороны противника под Авдеевкой.",
        "Приказываю нанести артиллерийский удар по позициям противника под Купянском.",
        "Приказываю провести локальную контратаку для отбития утраченных позиций в районе Херсона.",
        "Приказываю нанести точечный удар по опорному пункту противника в районе Работино.",
        "Приказываю провести штурмовые действия за освобождение позиций под Часовым Яром.",
        "Приказываю нанести удар по узлу обороны противника на Времевском выступе.",
      ] },
    { id: "mil_operational_offensive", title: "Наступление", desc: "Наступательная операция на участке фронта, прорыв обороны.", cost: "55 иниц. / 25 казны", effects: { military: 1, stability: -1, diplomacy: -1 },
      variants: [
        "Приказываю начать наступательную операцию на Донецком направлении с приоритетом на Покровск и Угледар.",
        "Приказываю начать наступательную операцию на Запорожском направлении с целью выхода к административной границе области.",
        "Приказываю начать наступательную операцию на Харьковском направлении для расширения буферной зоны.",
        "Приказываю начать наступательную операцию на Купянско-Сватовском направлении с целью выхода на административную границу Луганской области.",
        "Приказываю начать наступательную операцию на Херсонском направлении с задачей закрепления на левом берегу Днепра.",
        "Приказываю начать наступательную операцию в приграничных районах Сумской и Харьковской областей для создания буферной зоны.",
      ] },
    { id: "mil_operational_defensive", title: "Оборона", desc: "Оборонительная операция, удержание рубежей, отход с выравниванием линии.", cost: "45 иниц. / 18 казны", effects: { military: 1, stability: 1, diplomacy: 1, approval: 1 },
      variants: [
        "Приказываю перейти к обороне и закреплению на занятых рубежах в Запорожской области.",
        "Приказываю перейти к обороне с выравниванием линии фронта на Донецком направлении.",
        "Приказываю провести частичный отход на заранее подготовленные позиции под Харьковом.",
        "Приказываю перейти к обороне на Луганском направлении с усилением инженерных заграждений.",
        "Приказываю укрепить оборону южного направления для защиты сухопутного коридора в Крым.",
        "Приказываю перейти к позиционной обороне по всей линии соприкосновения без активных действий.",
      ] },
    { id: "mil_strategic_offensive", title: "Стратегическое наступление", desc: "Наступление по всей линии фронта, масштабная мобилизация ресурсов.", cost: "80 иниц. / 42 казны", effects: { military: 1, stability: -1, diplomacy: -1 },
      variants: [
        "Приказываю начать масштабную наступательную операцию по всей линии фронта с приоритетом на Донецк и Запорожье.",
        "Приказываю начать масштабную наступательную операцию с массированным применением артиллерии и авиации на трёх направлениях.",
        "Приказываю перебросить резервы Южной группировки войск для решающего удара по обороне противника.",
        "Приказываю провести общую мобилизацию оперативных резервов для решающего наступления на Донбассе.",
        "Приказываю начать зимнюю кампанию с массированными ударами по инфраструктуре и прорывом обороны на юге.",
        "Приказываю нанести массированный ракетно-авиационный удар по глубине обороны противника с последующим общим наступлением.",
      ] },
    { id: "mil_strategic_defensive", title: "Стратегическая оборона", desc: "Глубокоэшелонированная оборона, доктрина сдерживания (не ядерное применение).", cost: "60 иниц. / 30 казны", effects: { military: 1, stability: 1, diplomacy: 1, approval: 1 },
      variants: [
        "Приказываю перейти к глубокоэшелонированной стратегической обороне по всей линии соприкосновения.",
        "Приказываю создать укреплённые районы в тылу передовой для доктрины сдерживания.",
        "Приказываю перебросить резервы на угрожаемые участки без перехода к наступательным действиям.",
        "Приказываю провести масштабное минирование танкоопасных направлений на всей линии фронта.",
        "Приказываю призвать дополнительные резервы для усиления обороны без перехода к наступлению.",
        "Приказываю провести ротацию измотанных частей передовой линии для восстановления боеспособности обороны.",
      ] },
    { id: "mil_hybrid", title: "Гибридная война", desc: "ЧВК, партизанские операции, поддержка прокси-сил.", cost: "40 иниц. / 15 казны", effects: { military: 1, stability: 1, approval: 1, diplomacy: -1 },
      variants: [
        "Поручаю задействовать частные военные формирования для операций в тылу противника на Донецком направлении.",
        "Поручаю частным военным формированиям взять под охрану ключевую инфраструктуру и логистические маршруты.",
        "Поручаю оказать поддержку дружественным вооружённым формированиям на сопредельных территориях.",
        "Поручаю активизировать работу с пророссийскими вооружёнными формированиями в Приднестровье.",
        "Поручаю ЧВК взять под контроль охрану объектов топливно-энергетического комплекса в прифронтовой зоне.",
        "Поручаю усилить координацию с союзными вооружёнными формированиями Белоруссии на западном направлении.",
      ] },
  ],
  espionage: [
    { id: "covert_disinfo", title: "Дезинформация", desc: "Дезинформационная кампания за рубежом — влияет на настроения и нарратив.", cost: "20 иниц. / 5 казны", effects: { stability: 1, approval: 1 },
      variants: [
        "Поручаю СВР провести дезинформационную кампанию против украинского командования — вбросить ложные данные о планах наступления.",
        "Поручаю СВР провести кампанию по дискредитации западных СМИ, публикующих доклады о потерях российской армии.",
        "Поручаю СВР разжечь недоверие к властям противника среди населения приграничных областей через вбросы в соцсетях.",
        "Поручаю провести информационную кампанию внутри страны для укрепления поддержки специальной военной операции.",
        "Поручаю СВР организовать вброс материалов, дискредитирующих итоги очередного саммита НАТО.",
        "Поручаю СВР развернуть кампанию о последствиях энергетического кризиса в Европе из-за антироссийских санкций.",
      ] },
    { id: "covert_destabilize", title: "Дестабилизация", desc: "Финансирование оппозиции, провокации против власти противника.", cost: "30 иниц. / 8 казны", effects: { military: 1, stability: 1, diplomacy: -1, approval: 1 },
      variants: [
        "Поручаю разведке начать операцию по дестабилизации политической ситуации в Киеве через финансирование оппозиции.",
        "Поручаю разведке провести работу с региональными элитами в приграничных областях противника.",
        "Поручаю разведке организовать утечки о разногласиях внутри коалиции западных союзников.",
        "Поручаю разведке оказать влияние на ход местных выборов в приграничных регионах противника.",
        "Поручаю разведке работать с диаспорой в странах Балтии для раскола внутри антироссийской коалиции.",
        "Поручаю разведке использовать тему беженцев для давления на правительства стран-соседей Украины.",
      ] },
    { id: "covert_sabotage", title: "Диверсия", desc: "Диверсия против инфраструктуры противника. Высокий риск раскрытия.", cost: "40 иниц. / 15 казны", effects: { military: 1, diplomacy: -1, approval: 1 },
      variants: [
        "Поручаю провести диверсионную операцию против железнодорожных узлов снабжения в тылу противника.",
        "Поручаю провести диверсионную операцию против энергетической инфраструктуры на территории противника.",
        "Поручаю провести диверсию на складах боеприпасов и логистических центрах ВСУ в глубоком тылу.",
        "Поручаю провести диверсию против подводных кабелей связи в Балтийском море.",
        "Поручаю провести диверсионную операцию против аэродромов базирования авиации противника.",
        "Поручаю провести диверсию против узлов связи и командных пунктов в прифронтовой полосе.",
      ] },
    { id: "covert_elimination", title: "Ликвидация", desc: "Ликвидация ключевой фигуры. Только для серьёзных решений — максимальный риск.", cost: "60 иниц. / 25 казны", effects: { military: 1, diplomacy: -1 },
      variants: [
        "Поручаю спецслужбам организовать ликвидацию полевого командира, ответственного за успешные контрнаступления.",
        "Поручаю спецслужбам организовать ликвидацию куратора западных поставок вооружений.",
        "Поручаю спецслужбам организовать ликвидацию координатора диверсионных групп в тылу.",
        "Поручаю спецслужбам организовать ликвидацию куратора украинской военной разведки за рубежом.",
        "Поручаю спецслужбам организовать ликвидацию командира иностранного добровольческого подразделения.",
        "Поручаю спецслужбам организовать ликвидацию идеолога информационной войны против России.",
      ] },
  ],
  diplomacy: [
    { id: "diplo_negotiate", title: "Переговоры", desc: "Обычные переговоры, визиты, дипломатические ноты.", cost: "35 иниц. / 5 казны", effects: { diplomacy: 1, stability: 1, approval: 1 },
      variants: [
        "Министерству иностранных дел поручаю провести переговоры с Турцией и ОАЭ о посредничестве в мирном процессе.",
        "Министерству иностранных дел поручаю провести переговоры с Китаем о расширении экономического партнёрства.",
        "Министерству иностранных дел поручаю провести переговоры с представителями ЕС о смягчении санкционного режима.",
        "Министерству иностранных дел поручаю провести переговоры с Индией о расширении сотрудничества в энергетике и обороне.",
        "Министерству иностранных дел поручаю провести переговоры с Саудовской Аравией по координации в рамках ОПЕК+.",
        "Министерству иностранных дел поручаю провести консультации со странами Африки о расширении экономического присутствия.",
      ] },
    { id: "diplo_treaty", title: "Договор", desc: "Торговый, военный или гуманитарный договор — крупный долгосрочный эффект.", cost: "50 иниц. / 10 казны", effects: { diplomacy: 1, stability: 1, approval: 1 },
      variants: [
        "Поручаю подготовить и подписать договор с Китаем о стратегическом партнёрстве в энергетике.",
        "Поручаю подготовить и подписать договор со странами БРИКС о расчётах в национальных валютах.",
        "Поручаю подготовить и подписать договор с Индией о долгосрочных поставках нефти.",
        "Поручаю подготовить и подписать договор с Ираном о военно-техническом сотрудничестве.",
        "Поручаю подготовить и подписать соглашение с КНДР о расширении экономического и оборонного взаимодействия.",
        "Поручаю подготовить и подписать договор со странами Центральной Азии о транспортных коридорах в обход санкций.",
      ] },
    { id: "diplo_pressure", title: "Давление", desc: "Ультиматум, санкции, заморозка активов, высылка дипломатов.", cost: "35 иниц. / 3 казны", effects: { diplomacy: -1, stability: -1 },
      variants: [
        "МИДу поручаю выступить с ультиматумом в адрес стран, поставляющих дальнобойное оружие Украине.",
        "МИДу поручаю выступить с ультиматумом в адрес государств, поддерживающих санкционный режим против России.",
        "МИДу поручаю выступить с ультиматумом в адрес соседних стран, предоставляющих транзит военной помощи.",
        "МИДу поручаю выступить с ультиматумом в адрес стран, инициирующих преследование российских официальных лиц в международных судах.",
        "МИДу поручаю пригрозить ответными мерами странам, обсуждающим конфискацию замороженных российских активов.",
        "МИДу поручаю выступить с жёстким протестом против стран, размещающих дальнобойные системы вблизи российских границ.",
      ] },
    { id: "diplo_multilateral", title: "Коалиция", desc: "Инициатива в ООН/БРИКС/ШОС, формирование коалиции, посредничество.", cost: "45 иниц. / 8 казны", effects: { diplomacy: 1, stability: 1, approval: 1 },
      variants: [
        "Поручаю выступить с инициативой деэскалации в рамках Совета Безопасности ООН.",
        "Поручаю выступить с инициативой консолидации незападной коалиции в рамках БРИКС.",
        "Поручаю выступить с инициативой расширения региональной безопасности в рамках ШОС.",
        "Поручаю выступить с инициативой укрепления ОДКБ перед лицом растущей напряжённости на границах.",
        "Поручаю выступить с инициативой расширения Евразийского экономического союза для смягчения санкционного давления.",
        "Поручаю созвать конференцию стран Глобального Юга по вопросам многополярного миропорядка.",
      ] },
    { id: "diplo_soft_power", title: "Мягкая сила", desc: "Культурная дипломатия, гуманитарная помощь, образовательные программы.", cost: "25 иниц. / 8 казны", effects: { diplomacy: 1, stability: 1, approval: 1 },
      variants: [
        "Поручаю запустить программу гуманитарной помощи для населения приграничных регионов, пострадавших от боевых действий.",
        "Поручаю запустить программу культурной и образовательной дипломатии в странах Африки и Азии.",
        "Поручаю запустить программу поддержки русскоязычного населения сопредельных государств.",
        "Поручаю расширить программы спортивной дипломатии и участие в международных турнирах дружественных стран.",
        "Поручаю развернуть программу поддержки православных общин и религиозных связей за рубежом.",
        "Поручаю расширить вещание русскоязычных медиа на аудиторию стран Латинской Америки и Азии.",
      ] },
    { id: "diplo_peace", title: "Мирная инициатива", desc: "Переговоры об урегулировании конфликта. Главный двигатель мирного трека — самая дешёвая из дипломатических операций.", cost: "30 иниц. / 5 казны", effects: { diplomacy: 1, stability: 1, approval: 1, military: -1 },
      variants: [
        "Поручаю МИДу инициировать переговоры об урегулировании конфликта при посредничестве Турции и ОАЭ, с обсуждением статуса территорий.",
        "Поручаю МИДу инициировать прямые контакты с украинской делегацией по формату прекращения огня.",
        "Поручаю МИДу инициировать переговоры об урегулировании через площадку ООН с участием постоянных членов Совбеза.",
        "Поручаю МИДу рассмотреть китайский план урегулирования в качестве основы для переговорного процесса.",
        "Поручаю МИДу принять посредничество Ватикана для организации гуманитарного обмена как первого шага к переговорам.",
        "Поручаю МИДу предложить поэтапные меры доверия — обмен пленными и локальные перемирия — как основу для дальнейшего диалога.",
      ] },
  ],
  decrees: [
    { id: "econ_stimulus", domain: "Экономика", title: "Стимулирование экономики", desc: "Льготы, инвестиции, субсидии, снижение ставки.", effects: { stability: 1, approval: 1 },
      variants: [
        "Правительству поручаю разработать пакет мер по льготному кредитованию малого и среднего бизнеса.",
        "Правительству поручаю разработать пакет субсидий для предприятий обрабатывающей промышленности.",
        "Правительству поручаю разработать пакет мер со снижением налоговой нагрузки и налоговыми каникулами для бизнеса.",
      ] },
    { id: "econ_austerity", domain: "Экономика", title: "Жёсткая экономия", desc: "Сокращение расходов, налоги вверх — казна крепнет, но общество недовольно.", effects: { stability: -1, approval: -1 },
      variants: [
        "Правительству поручаю программу бюджетной консолидации с сокращением расходов на социальные программы.",
        "Правительству поручаю программу бюджетной консолидации с повышением налогов на крупный бизнес и экспортёров.",
        "Правительству поручаю программу бюджетной консолидации с заморозкой индексации зарплат бюджетников.",
      ] },
    { id: "econ_sanctions_counter", domain: "Экономика", title: "Контрсанкции", desc: "Параллельный импорт, обход ограничений, торговые партнёрства в обход Запада.", effects: { diplomacy: -1, stability: 1, approval: 1 },
      variants: [
        "Правительству поручаю расширить каналы параллельного импорта из дружественных стран.",
        "Правительству поручаю создать альтернативные платёжные системы с торговыми партнёрами в обход SWIFT.",
        "Правительству поручаю программу локализации производства критических импортных компонентов.",
      ] },
    { id: "econ_infrastructure", domain: "Экономика", title: "Инфраструктура", desc: "Крупные инфраструктурные проекты — дороги, энергетика, промышленность.", effects: { military: 1, stability: 1, diplomacy: 1, approval: 1 },
      variants: [
        "Утверждаю программу развития транспортных коридоров в направлении Азии.",
        "Утверждаю программу развития энергетической инфраструктуры для замещения утраченных экспортных рынков.",
        "Утверждаю программу развития цифровой связи и импортозамещения телекоммуникационного оборудования.",
      ] },
    { id: "econ_tech", domain: "Экономика", title: "Технологии", desc: "НИОКР, космос, ИИ-суверенитет — небольшие затраты сейчас, рост экономики со временем.", effects: { military: 1, stability: 1, diplomacy: 1, approval: 1 },
      variants: [
        "Утверждаю государственную программу развития микроэлектроники и производства полупроводников.",
        "Утверждаю государственную программу развития искусственного интеллекта и оборонных технологий.",
        "Утверждаю государственную программу развития космической отрасли и спутниковой навигации.",
      ] },
    { id: "mil_admin_budget", domain: "Военно-административные", title: "Оборонный бюджет", desc: "Контракт с ВПК, увеличение расходов на оборону. НЕ боевая операция.", effects: { military: 1, stability: 1 },
      variants: [
        "Утверждаю увеличение оборонного бюджета для наращивания производства беспилотников и ракетных систем.",
        "Утверждаю увеличение оборонного бюджета для модернизации бронетехники и артиллерии.",
        "Утверждаю увеличение оборонного бюджета для расширения программ подготовки личного состава.",
      ] },
    { id: "mil_admin_mobilization", domain: "Военно-административные", title: "Мобилизация", desc: "Указ о частичной мобилизации — растит армию ценой одобрения. НЕ боевая операция.", effects: { military: 1, stability: -1, approval: -1 },
      variants: [
        "Подписываю указ о частичной мобилизации резервистов инженерных и артиллерийских специальностей.",
        "Подписываю указ о призыве дополнительного контингента для пополнения действующих частей.",
        "Подписываю указ о формировании мобилизационного резерва в приграничных регионах.",
      ] },
    { id: "mil_admin_doctrine", domain: "Военно-административные", title: "Военная доктрина", desc: "Обновление военной доктрины — стратегия и приоритеты Вооружённых сил.", effects: { military: 1, stability: 1, diplomacy: -1, approval: 1 },
      variants: [
        "Утверждаю обновлённую военную доктрину с приоритетом высокоточного оружия и беспилотных систем.",
        "Утверждаю обновлённую военную доктрину, определяющую принципы ядерного сдерживания.",
        "Утверждаю обновлённую военную доктрину со стратегией долгосрочного позиционного противостояния.",
      ] },
    { id: "pol_repression", domain: "Политика", title: "Подавление", desc: "Подавление протестов, цензура, аресты оппозиции.", effects: { military: 1, stability: 1, diplomacy: -1, approval: -1 },
      variants: [
        "Поручаю силовым структурам обеспечить порядок в связи с антивоенными протестами в крупных городах.",
        "Поручаю силовым структурам пресечь рост недовольства призывом и мобилизацией.",
        "Поручаю силовым структурам ограничить активность оппозиционных СМИ и блогеров.",
      ] },
    { id: "pol_liberalization", domain: "Политика", title: "Либерализация", desc: "Реформы, снятие ограничений, амнистия, свободы.", effects: { diplomacy: 1 },
      variants: [
        "Подписываю указ о либерализации предпринимательской деятельности и снижении административного давления.",
        "Подписываю указ о либерализации миграционной политики для привлечения рабочей силы.",
        "Подписываю указ о частичном снятии ограничений в медиапространстве.",
      ] },
    { id: "pol_elite_consolidation", domain: "Политика", title: "Консолидация элит", desc: "Кадровые перестановки, укрепление вертикали власти.", effects: { military: 1, stability: 1 },
      variants: [
        "Провожу кадровые перестановки в силовом блоке в целях консолидации вокруг задач фронта.",
        "Провожу кадровые перестановки в экономическом блоке правительства.",
        "Провожу кадровые перестановки среди региональных элит и губернаторского корпуса.",
      ] },
    { id: "pol_social", domain: "Политика", title: "Социальная программа", desc: "Маткапитал, пенсии, здравоохранение, демография — двигает одобрение народа.", effects: { stability: 1, approval: 1 },
      variants: [
        "Утверждаю социальную программу поддержки семей военнослужащих и ветеранов.",
        "Утверждаю социальную программу материнского капитала и демографической поддержки.",
        "Утверждаю социальную программу развития здравоохранения в приграничных регионах.",
      ] },
    { id: "pol_propaganda", domain: "Информационные", title: "Пропаганда", desc: "Информационная кампания внутри страны, нарратив для населения.", effects: { stability: 1, approval: 1, diplomacy: -1 },
      variants: [
        "Поручаю госСМИ развернуть информационную кампанию об успехах на фронте и героизме военнослужащих.",
        "Поручаю госСМИ развернуть информационную кампанию о необходимости и справедливости специальной операции.",
        "Поручаю госСМИ развернуть информационную кампанию о враждебных действиях Запада против страны.",
      ] },
  ],
};

const KREMLIN_DOMAINS = [
  { id: "military", label: "⚔️ Военное", mode: "military" },
  { id: "espionage", label: "🕵️ Шпионаж", mode: "intel" },
  { id: "diplomacy", label: "🤝 Дипломатия", mode: "diplomacy_op" },
  { id: "decrees", label: "📜 Указы", mode: null },
];

const KREMLIN_TIER_LABEL = { decree_fast: "📜 Быстрый указ (1–2 мес.)", decree_reform: "📋 Реформа (3–6 мес.)", decree_program: "🏛 Программа (7–12 мес.)" };

// Классозависимые формулировки для указов (домен «decrees»): один и тот же вопрос
// на разном масштабе — быстрый указ (разовая мера, 1–2 мес), реформа (системное
// изменение, 3–6 мес), программа (нацпроект с бюджетом, 7–12 мес). Ключ — id карточки.
const DECREE_TIER_VARIANTS = {
  econ_stimulus: {
    decree_fast: [
      "Поручаю в двухмесячный срок выделить льготные кредиты малому и среднему бизнесу в наиболее пострадавших отраслях.",
      "Поручаю ввести разовые субсидии предприятиям обрабатывающей промышленности до конца квартала.",
      "Поручаю предоставить налоговые каникулы бизнесу в приоритетных регионах на ближайшие месяцы.",
    ],
    decree_reform: [
      "Поручаю провести реформу льготного кредитования: постоянный механизм поддержки МСП вместо разовых траншей.",
      "Поручаю реформировать промышленную политику — долгосрочные субсидии и госгарантии для обрабатывающих отраслей.",
      "Поручаю провести налоговую реформу со снижением нагрузки на несырьевой бизнес.",
    ],
    decree_program: [
      "Утверждаю федеральный нацпроект развития малого и среднего предпринимательства с целевым бюджетом и KPI на два года.",
      "Утверждаю нацпроект реиндустриализации: госинвестиции в обрабатывающую промышленность и станкостроение.",
      "Утверждаю федеральную программу налогового стимулирования несырьевого сектора с горизонтом до 2028 года.",
    ],
  },
  econ_austerity: {
    decree_fast: [
      "Поручаю немедленно заморозить некритические статьи бюджета до конца квартала.",
      "Поручаю ввести временное повышение сборов со сверхприбыли экспортёров.",
      "Поручаю приостановить индексацию расходов ведомств на ближайшие месяцы.",
    ],
    decree_reform: [
      "Поручаю провести бюджетную реформу: пересмотр расходных обязательств и правил индексации.",
      "Поручаю реформировать налогообложение крупного бизнеса — прогрессивная нагрузка на сверхдоходы.",
      "Поручаю реформировать межбюджетные отношения для сокращения дефицита регионов.",
    ],
    decree_program: [
      "Утверждаю среднесрочную программу бюджетной консолидации на два года с жёсткими целевыми показателями дефицита.",
      "Утверждаю программу оптимизации госсектора и сокращения неэффективных расходов.",
      "Утверждаю долгосрочную программу оздоровления государственных финансов.",
    ],
  },
  econ_sanctions_counter: {
    decree_fast: [
      "Поручаю в срочном порядке открыть новые каналы параллельного импорта критических товаров.",
      "Поручаю ввести зеркальные ограничения против недружественных экспортёров.",
      "Поручаю разово перенаправить экспортные потоки на рынки дружественных стран.",
    ],
    decree_reform: [
      "Поручаю реформировать внешнеторговое регулирование под условия санкционного давления.",
      "Поручаю реформировать платёжную инфраструктуру для расчётов в нацвалютах в обход SWIFT.",
      "Поручаю реформировать таможенное и валютное регулирование для устойчивого параллельного импорта.",
    ],
    decree_program: [
      "Утверждаю национальную программу импортозамещения критических компонентов и технологий.",
      "Утверждаю программу создания независимой платёжно-расчётной системы с дружественными странами.",
      "Утверждаю долгосрочную программу переориентации экспорта на рынки Азии и Глобального Юга.",
    ],
  },
  econ_infrastructure: {
    decree_fast: [
      "Поручаю выделить экстренное финансирование на ремонт ключевых транспортных узлов.",
      "Поручаю ускорить ввод уже начатых энергетических объектов в этом квартале.",
      "Поручаю разово профинансировать восстановление связи в приграничных регионах.",
    ],
    decree_reform: [
      "Поручаю реформировать управление инфраструктурными проектами — единый заказчик и ускоренные процедуры.",
      "Поручаю реформировать энергетическую отрасль под замещение утраченных экспортных рынков.",
      "Поручаю реформировать регулирование строительной отрасли для крупных проектов.",
    ],
    decree_program: [
      "Утверждаю федеральный нацпроект развития транспортных коридоров в направлении Азии.",
      "Утверждаю нацпроект модернизации энергетической инфраструктуры с горизонтом до 2030 года.",
      "Утверждаю программу цифровой инфраструктуры и импортозамещения телеком-оборудования.",
    ],
  },
  econ_tech: {
    decree_fast: [
      "Поручаю выделить экстренные гранты на критические разработки в микроэлектронике.",
      "Поручаю разово профинансировать закупку оборудования для оборонных НИОКР.",
      "Поручаю ускорить запуск приоритетных космических пусков в этом году.",
    ],
    decree_reform: [
      "Поручаю реформировать систему научных грантов и внедрения разработок в производство.",
      "Поручаю реформировать регулирование оборота данных и искусственного интеллекта.",
      "Поручаю реформировать управление космической отраслью.",
    ],
    decree_program: [
      "Утверждаю федеральный нацпроект развития микроэлектроники и производства полупроводников.",
      "Утверждаю нацпроект по искусственному интеллекту и оборонным технологиям.",
      "Утверждаю долгосрочную программу развития космической отрасли и спутниковой навигации.",
    ],
  },
  mil_admin_budget: {
    decree_fast: [
      "Поручаю выделить экстренное дофинансирование на закупку беспилотников в этом квартале.",
      "Поручаю разово увеличить финансирование ремонта бронетехники.",
      "Поручаю ускорить оплату уже заключённых контрактов с ВПК.",
    ],
    decree_reform: [
      "Поручаю реформировать систему гособоронзаказа для ускоренной контрактации.",
      "Поручаю реформировать ценообразование в оборонной промышленности.",
      "Поручаю реформировать систему военной приёмки и логистики.",
    ],
    decree_program: [
      "Утверждаю долгосрочную программу перевооружения с приоритетом БПЛА и ракетных систем.",
      "Утверждаю программу модернизации бронетанковых и артиллерийских войск.",
      "Утверждаю программу расширения производственных мощностей ВПК.",
    ],
  },
  mil_admin_mobilization: {
    decree_fast: [
      "Подписываю указ о срочном призыве резервистов инженерных и артиллерийских специальностей.",
      "Подписываю указ о пополнении действующих частей добровольцами с повышенными выплатами.",
      "Подписываю указ о разовом призыве специалистов дефицитных военных профессий.",
    ],
    decree_reform: [
      "Поручаю реформировать систему воинского учёта и мобилизационной готовности.",
      "Поручаю реформировать порядок службы по контракту с новыми стимулами.",
      "Поручаю реформировать систему подготовки резерва.",
    ],
    decree_program: [
      "Утверждаю программу формирования и обучения мобилизационного резерва в приграничных регионах.",
      "Утверждаю программу развития сети военных учебных центров.",
      "Утверждаю долгосрочную программу наращивания численности вооружённых сил.",
    ],
  },
  mil_admin_doctrine: {
    decree_fast: [
      "Поручаю оперативно скорректировать приоритеты применения высокоточного оружия.",
      "Поручаю ввести временные изменения в правила применения сил на текущем этапе.",
      "Поручаю уточнить порядок взаимодействия родов войск на театре.",
    ],
    decree_reform: [
      "Поручаю пересмотреть военную доктрину в части беспилотных и высокоточных систем.",
      "Поручаю реформировать принципы ядерного сдерживания в обновлённой доктрине.",
      "Поручаю реформировать доктрину территориальной обороны.",
    ],
    decree_program: [
      "Утверждаю новую военную доктрину с горизонтом планирования до 2030 года.",
      "Утверждаю долгосрочную стратегию строительства вооружённых сил.",
      "Утверждаю программу перехода к доктрине долгосрочного позиционного противостояния.",
    ],
  },
  pol_repression: {
    decree_fast: [
      "Поручаю силовым структурам пресечь несанкционированные акции в крупных городах.",
      "Поручаю ввести временные ограничения на деятельность оппозиционных медиа.",
      "Поручаю провести оперативные задержания организаторов беспорядков.",
    ],
    decree_reform: [
      "Поручаю реформировать законодательство о массовых мероприятиях.",
      "Поручаю реформировать регулирование иностранного финансирования НКО.",
      "Поручаю реформировать нормы об иностранных агентах и нежелательных организациях.",
    ],
    decree_program: [
      "Утверждаю программу укрепления внутренней безопасности и правопорядка.",
      "Утверждаю долгосрочную программу контроля информационного пространства.",
      "Утверждаю программу усиления силового блока.",
    ],
  },
  pol_liberalization: {
    decree_fast: [
      "Подписываю указ о разовом снижении административного давления на бизнес.",
      "Подписываю указ об амнистии по отдельным экономическим статьям.",
      "Подписываю указ о временном смягчении миграционных ограничений для дефицитных профессий.",
    ],
    decree_reform: [
      "Поручаю провести реформу делового климата и дерегулирования.",
      "Поручаю реформировать миграционную политику для привлечения рабочей силы.",
      "Поручаю реформировать регулирование медиапространства в сторону смягчения.",
    ],
    decree_program: [
      "Утверждаю долгосрочную программу либерализации экономики и защиты частной собственности.",
      "Утверждаю программу интеграции трудовых мигрантов.",
      "Утверждаю программу развития институтов гражданского общества.",
    ],
  },
  pol_elite_consolidation: {
    decree_fast: [
      "Провожу срочные кадровые перестановки в силовом блоке.",
      "Провожу замены в экономическом блоке правительства.",
      "Провожу ротацию в губернаторском корпусе проблемных регионов.",
    ],
    decree_reform: [
      "Поручаю реформировать систему отбора и ротации управленческих кадров.",
      "Поручаю реформировать вертикаль власти в отношениях центр—регионы.",
      "Поручаю реформировать механизмы контроля над элитными группами.",
    ],
    decree_program: [
      "Утверждаю долгосрочную программу подготовки управленческого резерва.",
      "Утверждаю программу укрепления вертикали власти.",
      "Утверждаю программу консолидации элит вокруг задач фронта.",
    ],
  },
  pol_social: {
    decree_fast: [
      "Утверждаю разовые выплаты семьям военнослужащих и ветеранов.",
      "Поручаю выделить экстренное финансирование здравоохранения в приграничных регионах.",
      "Утверждаю единовременную поддержку многодетных семей.",
    ],
    decree_reform: [
      "Поручаю реформировать систему социальной поддержки семей военнослужащих.",
      "Поручаю реформировать демографическую и семейную политику.",
      "Поручаю реформировать региональное здравоохранение.",
    ],
    decree_program: [
      "Утверждаю федеральный нацпроект поддержки семей военнослужащих и ветеранов.",
      "Утверждаю нацпроект материнского капитала и демографического развития.",
      "Утверждаю долгосрочную программу развития здравоохранения.",
    ],
  },
  pol_propaganda: {
    decree_fast: [
      "Поручаю госСМИ немедленно развернуть кампанию об успехах на фронте.",
      "Поручаю оперативно запустить контрнарратив против западных публикаций о потерях.",
      "Поручаю усилить освещение героизма военнослужащих в этом месяце.",
    ],
    decree_reform: [
      "Поручаю реформировать систему государственных СМИ и информационной работы.",
      "Поручаю реформировать регулирование информационного пространства.",
      "Поручаю реформировать систему патриотического воспитания.",
    ],
    decree_program: [
      "Утверждаю долгосрочную программу информационного сопровождения специальной операции.",
      "Утверждаю нацпроект патриотического воспитания молодёжи.",
      "Утверждаю программу продвижения государственного нарратива за рубежом.",
    ],
  },
};

// Готовые варианты формулировки для карточки. Для указов (домен «decrees») варианты
// зависят от выбранного класса (tier) — разный масштаб = разные формулировки. Для
// военных/шпионских/дипломатических карточек класса нет, берём card.variants.
// БАЛАНС (2026-07-04): игрок жаловался, что формулировки "одинаковые" — раньше всегда
// показывался ВЕСЬ пул (3 варианта), фиксированный. Пулы расширены (см. variants/
// DECREE_TIER_VARIANTS выше), а здесь показываем случайную подвыборку из 3, детерминированную
// по seed — значок "🔄 Обновить" в KremlinTab просто увеличивает seed, без нового backend-запроса.
const CARD_VARIANTS_SHOWN = 3;
function buildCardVariants(card, tier, seed = 0) {
  const tierSet = DECREE_TIER_VARIANTS[card.id]?.[tier];
  const pool = (Array.isArray(tierSet) && tierSet.length > 0) ? tierSet
    : (Array.isArray(card.variants) && card.variants.length > 0) ? card.variants
    : null;
  if (pool) {
    let picked = pool;
    if (pool.length > CARD_VARIANTS_SHOWN) {
      const rank = (i) => { const x = Math.sin(seed * 1000 + i * 37.17) * 10000; return x - Math.floor(x); };
      picked = pool.map((text, i) => ({ text, r: rank(i) })).sort((a, b) => a.r - b.r).slice(0, CARD_VARIANTS_SHOWN).map(p => p.text);
    }
    return picked.map((text, i) => ({ label: `${t("kremlin.variant_label")} ${i + 1}`, text }));
  }
  const base = card.template || card.desc || card.title;
  return [
    { label: t("kremlin.variant_standard"), text: base },
    { label: t("kremlin.variant_decisive"), text: `Незамедлительно и в полном объёме: ${base.charAt(0).toLowerCase()}${base.slice(1)}` },
    { label: t("kremlin.variant_cautious"), text: `Поэтапно, с оглядкой на международную реакцию: ${base.charAt(0).toLowerCase()}${base.slice(1)}` },
  ];
}

// Домен карточки по её id (для навигации советника к нужной карточке).
function domainOfCategory(catId) {
  if (catId.startsWith("mil_admin") || catId.startsWith("econ_") || catId.startsWith("pol_")) return "decrees";
  if (catId.startsWith("mil_")) return "military";
  if (catId.startsWith("covert_")) return "espionage";
  if (catId.startsWith("diplo_")) return "diplomacy";
  return "decrees";
}

// Детерминированный расчёт рекомендованного хода — зеркало computeOptimalMove в
// backend/src/ai/advisors.js. Держать в синхроне при изменении балансовых порогов.
// Возвращает { category, tier, title, reason } или null.
function computeKremlinRecommendation(stats, turnNumber = 1) {
  const s = (k, d = 50) => (typeof stats[k] === "number" ? stats[k] : d);
  const economy = s("economy"), approval = s("approval"), stability = s("stability"),
    diplomacy = s("diplomacy"), treasury = s("treasury", 52), inflation = s("inflation", 64),
    military = s("military"), peace = s("peace_track", 0);

  const dangers = [
    { key: "economy", margin: economy - 30 },
    { key: "approval", margin: approval - 30 },
    { key: "stability", margin: stability - 25 },
    { key: "diplomacy", margin: diplomacy - 15 },
  ].sort((a, b) => a.margin - b.margin);
  const worst = dangers[0];

  if (worst.margin < 10) {
    if (worst.key === "economy") {
      if (treasury < 10) return { category: "econ_austerity", tier: "decree_fast", title: "Бюджетная консолидация",
        reason: `Экономика ${economy} — до коллапса (<30) ${worst.margin} п. Казна ${treasury} пуста: стимул сейчас съест дефицитная спираль, сначала закройте дефицит. Военные операции в этом месяце опасны.` };
      return { category: "econ_stimulus", tier: "decree_fast", title: "Стимулирование экономики",
        reason: `Экономика ${economy} — до коллапса (<30) ${worst.margin} п. Стимул даёт +1..+3; воздержитесь от дорогих военных операций в этом месяце.` };
    }
    if (worst.key === "approval") return { category: "pol_social", tier: "decree_fast", title: "Социальная программа",
      reason: `Рейтинг ${approval} — до переворота (<30) ${worst.margin} п. Социальные меры — самый прямой рычаг одобрения. Мобилизация и жёсткая экономия сейчас недопустимы.` };
    if (worst.key === "stability") return { category: "pol_propaganda", tier: "decree_fast", title: "Информационная кампания",
      reason: `Стабильность ${stability} — до волнений (<25) ${worst.margin} п. Инфокампания поднимает стабильность без удара по казне (подавление обвалило бы рейтинг).` };
    return { category: "diplo_negotiate", title: "Дипломатические переговоры",
      reason: `Дипломатия ${diplomacy} — до изоляции (<15) ${worst.margin} п. Переговоры — единственный прямой рычаг; эскалация и тайные операции усугубят изоляцию.` };
  }

  if (treasury < 0) return { category: "econ_austerity", tier: "decree_fast", title: "Закрыть дефицит казны",
    reason: `Казна ${treasury} — дефицит каждый месяц давит экономику (${economy}) и разгоняет инфляцию. Дорогие операции углубляют спираль.` };

  if (inflation > 73 && economy < 55) return { category: "econ_austerity", tier: "decree_reform", title: "Сбить инфляцию",
    reason: `Инфляция ${inflation} (порог 73) — каждый месяц −1..−3 экономике и рейтингу. Консолидация снижает дефицитное давление.` };

  const donetsk = s("donetsk_control", 0), luhansk = s("luhansk_control", 0),
    zap = s("zaporizhzhia_control", 0), kher = s("kherson_control", 0), khar = s("kharkiv_control", 0);
  const secondary = [zap >= 85, kher >= 65, khar >= 50].filter(Boolean).length;
  if (donetsk >= 80 && luhansk >= 90 && military >= 75 && economy >= 45 && treasury >= 35) {
    const target = donetsk < 100 ? "Донецком" : luhansk < 100 ? "Луганском" : secondary < 2 ? "Запорожском" : null;
    if (target) return { category: "mil_operational_offensive", title: `Наступление (${target} направление)`,
      reason: `Военная победа близко (Донецк ${donetsk}, Луганск ${luhansk}, доп. регионы ${secondary}/2). Экономика ${economy} и казна ${treasury} выдержат военное бремя.` };
  }

  if (peace >= 40 || turnNumber >= 10) return { category: "diplo_peace", title: "Мирная инициатива",
    reason: `Мирный трек ${peace} — самая дешёвая дипоперация и главный двигатель к дипломатической победе (нужен трек 100 и экономика/рейтинг/стабильность ≥65; сейчас ${economy}/${approval}/${stability}).` };

  return { category: "econ_stimulus", tier: "decree_reform", title: "Укреплять экономику",
    reason: `Острых угроз нет. Экономика ${economy} — фундамент обоих путей к победе. Запас прочности против месячной эрозии (до −6) окупается всегда.` };
}

// БАШНИ КРЕМЛЯ теперь отдельная вкладка (элиты, не браузер категорий) — категории по указам
// переехали сюда, в Кабинет министров, по одному министру на область (Петя, 2026-07-09:
// "министры выполняют мои распоряжения, а элиты в башнях кремля пытаются на меня повлиять").
// Каждый министр — 1-2 под-области (те же карточки, что раньше жили в доменах Башен Кремля).
const MINISTER_DOMAINS = {
  defense: [
    { id: "military", label: "⚔️ Военные операции", mode: "military", cards: KREMLIN_CATEGORIES.military },
    { id: "mil_admin", label: "🏛 Административные указы", mode: null, cards: KREMLIN_CATEGORIES.decrees.filter(c => c.domain === "Военно-административные") },
  ],
  foreign: [
    { id: "diplomacy", label: "🤝 Дипломатия", mode: "diplomacy_op", cards: KREMLIN_CATEGORIES.diplomacy },
  ],
  finance: [
    { id: "econ", label: "💰 Экономические указы", mode: null, cards: KREMLIN_CATEGORIES.decrees.filter(c => c.domain === "Экономика") },
  ],
  security: [
    { id: "espionage", label: "🕵️ Шпионаж", mode: "intel", cards: KREMLIN_CATEGORIES.espionage },
    { id: "pol_security", label: "🛡 Внутренняя безопасность", mode: null, cards: KREMLIN_CATEGORIES.decrees.filter(c => ["pol_repression", "pol_elite_consolidation"].includes(c.id)) },
  ],
  press: [
    { id: "info", label: "📰 Информационная политика", mode: null, cards: KREMLIN_CATEGORIES.decrees.filter(c => ["pol_liberalization", "pol_social", "pol_propaganda"].includes(c.id)) },
  ],
};

// Раньше KremlinTab — браузер всех 4 доменов указов. Теперь встраивается в карточку конкретного
// министра (Кабинет министров), область видимости сужена до его домена(ов). Рекомендация
// советника (computeKremlinRecommendation) сюда намеренно НЕ перенесена — она была общей на все
// домены сразу, а per-министр версия требует отдельной проработки (см. HANDOFF.md, известное
// ограничение первого захода).
function MinisterCategoryBrowser({ ministerId, onSelectCategory }) {
  const domains = MINISTER_DOMAINS[ministerId] || [];
  const [domainId, setDomainId] = useState(domains[0]?.id);
  const [tier, setTier] = useState("decree_fast");
  const [expandedCardId, setExpandedCardId] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [customText, setCustomText] = useState("");
  const [variantSeed, setVariantSeed] = useState(0);
  const domain = domains.find(d => d.id === domainId) || domains[0];
  const cards = domain?.cards || [];

  const toggleCard = (card) => {
    if (expandedCardId === card.id) {
      setExpandedCardId(null);
    } else {
      setExpandedCardId(card.id);
      setSelectedVariant(0);
      setCustomText("");
      setVariantSeed(0);
    }
  };

  if (!domain) return null;

  return (
    <div>
      {/* Под-области министра (если их больше одной) */}
      {domains.length > 1 && (
        <div className="scroll-hide" style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
          {domains.map(d => (
            <button
              key={d.id}
              onClick={() => setDomainId(d.id)}
              style={{
                flexShrink: 0, background: domainId === d.id ? "#9c8347" : "#1c2230",
                color: domainId === d.id ? "#14181f" : "#a8b0be",
                border: `1px solid ${domainId === d.id ? "#9c8347" : "#2a3040"}`,
                borderRadius: 5, padding: "7px 14px", fontFamily: "'PT Serif',serif",
                fontSize: 13, fontWeight: domainId === d.id ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {/* Тир для указов (mode: null — категории с тиром decree_fast/reform/program) */}
      {domain.mode === null && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {Object.entries(KREMLIN_TIER_LABEL).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTier(id)}
              style={{
                flex: 1, background: tier === id ? "#3a5a4a" : "#1c2230",
                color: tier === id ? "#ece7d8" : "#a8b0be",
                border: `1px solid ${tier === id ? "#4a7a5a" : "#2a3040"}`,
                borderRadius: 4, padding: "6px 8px", fontFamily: "'PT Serif',serif",
                fontSize: 11.5, cursor: "pointer",
              }}
            >
              {kremlinTierLabel(id, label)}
            </button>
          ))}
        </div>
      )}

      {/* Карточки */}
      {(() => {
        const renderCard = (card) => {
          const isExpanded = expandedCardId === card.id;
          return (
            <div
              key={card.id}
              style={{ background: "#1c2230", border: `1px solid ${isExpanded ? "#9c8347" : "#2a3040"}`, borderRadius: 5, padding: "11px 13px", transition: "border-color 0.15s" }}
            >
              <div
                onClick={() => toggleCard(card)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="doc-font" style={{ fontSize: 14, fontWeight: 700, color: "#ece7d8" }}>{kremlinCategoryTitle(card.id, card.title)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {card.cost && <span className="mono-font" style={{ fontSize: 9, color: "#c8a857", whiteSpace: "nowrap" }}>{formatCategoryCost(card.cost)}</span>}
                    <span style={{ color: "#c8a857", fontSize: 13, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                  </div>
                </div>
                <div className="doc-font" style={{ fontSize: 12, color: "#8a94a6", lineHeight: 1.4, marginBottom: 6 }}>{kremlinCategoryDesc(card.id, card.desc)}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {Object.entries(card.effects || {}).map(([stat, sign]) => (
                    <span key={stat} className="mono-font" style={{
                      fontSize: 9, borderRadius: 3, padding: "1px 6px", fontWeight: 700,
                      background: sign > 0 ? "#12241a" : "#2a1414", color: sign > 0 ? "#6ec894" : "#e08080",
                    }}>
                      {statLabel(stat, KREMLIN_STAT_LABEL[stat])} {sign > 0 ? "↑" : "↓"}
                    </span>
                  ))}
                </div>
              </div>

              {isExpanded && (() => {
                const pool = DECREE_TIER_VARIANTS[card.id]?.[tier] || card.variants || [];
                const hasMore = pool.length > CARD_VARIANTS_SHOWN;
                return (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #2a3040" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div className="mono-font" style={{ fontSize: 9, color: "#7a8294", letterSpacing: "0.05em" }}>{t("kremlin.choose_wording")}</div>
                    {hasMore && (
                      <button
                        onClick={() => { setVariantSeed(s => s + 1); setSelectedVariant(0); setCustomText(""); }}
                        title={t("kremlin.refresh_tooltip")}
                        style={{ background: "none", border: "1px solid #3a4050", borderRadius: 3, color: "#c8a857", fontSize: 10, padding: "2px 7px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}
                      >
                        {t("kremlin.refresh_btn")}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {buildCardVariants(card, tier, variantSeed).map((v, i) => (
                      <div
                        key={i}
                        onClick={() => { setSelectedVariant(i); setCustomText(""); }}
                        style={{
                          padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                          background: selectedVariant === i && !customText ? "#33301c" : "#141a24",
                          border: `1px solid ${selectedVariant === i && !customText ? "#9c8347" : "#2a3040"}`,
                        }}
                      >
                        <div className="mono-font" style={{ fontSize: 8.5, color: "#c8a857", marginBottom: 3 }}>{v.label.toUpperCase()}</div>
                        <div className="doc-font" style={{ fontSize: 12, lineHeight: 1.4, color: "#d8dce4" }}>{v.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mono-font" style={{ fontSize: 9, color: "#7a8294", marginBottom: 6, letterSpacing: "0.05em" }}>{t("kremlin.or_own_text")}</div>
                  <textarea
                    value={customText}
                    onChange={e => setCustomText(e.target.value)}
                    placeholder={t("kremlin.custom_text_placeholder")}
                    rows={2}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 4, background: "#141a24", color: "#e8e4d8", border: "1px solid #2a3040", fontFamily: "'PT Serif',serif", fontSize: 12.5, resize: "vertical", marginBottom: 10, boxSizing: "border-box" }}
                  />
                  <button
                    onClick={() => {
                      const variants = buildCardVariants(card, tier, variantSeed);
                      onSelectCategory(customText.trim() || variants[selectedVariant ?? 0]?.text || card.template, domain.mode || tier);
                      setExpandedCardId(null);
                    }}
                    style={{ width: "100%", background: "#9c8347", color: "#14181f", border: "none", borderRadius: 4, padding: "9px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    {t("kremlin.choose_wording_btn")}
                  </button>
                </div>
                );
              })()}
            </div>
          );
        };

        return (
          <div style={{ display: "grid", gap: 8 }}>
            {cards.map(card => renderCard(card))}
          </div>
        );
      })()}
    </div>
  );
}

// ---------- БАШНИ КРЕМЛЯ: элиты (влияние, не исполнение — см. MinisterCategoryBrowser выше) ----------
const FACTION_META = {
  faction_siloviki:     { label: "Силовики",     role: "силовой контур, спецслужбы",        color: "#b2585a", icon: "🎖" },
  faction_konservatory: { label: "Консерваторы", role: "охранительный, идеологический блок", color: "#9a5a86", icon: "⛪" },
  faction_oligarhi:     { label: "Олигархи",     role: "крупный бизнес, госконтракты",       color: "#c8a857", icon: "💰" },
  faction_tehnokraty:   { label: "Технократы",   role: "системные либералы, ЦБ",             color: "#5b8ab0", icon: "🕊" },
};
const FACTION_ORDER = ["faction_siloviki", "faction_konservatory", "faction_oligarhi", "faction_tehnokraty"];

// Настроение башни — простая эвристика по абсолютному уровню (не дельта, дельта не всегда
// доступна на фронте без истории); отражает то же деление на зоны, что и цвет полосы.
// Пороги настроения ВЫРОВНЕНЫ с лестницей дебаффов (60/45/30/15) — иначе текст говорит "довольны"
// одновременно с бейджем "давление 1/4" под ним (было замечено при живой проверке, поправлено).
function factionMoodText(id, value) {
  const MOODS = {
    faction_siloviki: {
      high: "Довольны текущим курсом — силовой блок чувствует, что его слушают.",
      mid: "Настороже, ждут более решительных действий.",
      low: "Раздражены — считают, что их роль и интересы игнорируют.",
      critical: "В ярости — считают, что центр их предал. Разговоры о нелояльности уже идут.",
    },
    faction_konservatory: {
      high: "В целом довольны идеологической твёрдостью курса.",
      mid: "Смотрят настороженно, ждут сигналов о развороте.",
      low: "Обеспокоены — видят в курсе уступки и размывание линии.",
      critical: "В отчаянии — считают, что курс окончательно предал их принципы.",
    },
    faction_oligarhi: {
      high: "Довольны — бизнес-климат и доступ к ресурсам их устраивают.",
      mid: "Ждут, куда качнётся политика — открытых претензий пока нет.",
      low: "Раздражены — санкции и/или давление на схемы бьют по карману.",
      critical: "На грани разрыва — активно выводят капитал и сворачивают поддержку курса.",
    },
    faction_tehnokraty: {
      high: "Довольны — экономический курс выглядит рациональным.",
      mid: "Осторожно нейтральны, следят за цифрами.",
      low: "На грани — считают курс экономически безответственным.",
      critical: "В панике — открыто называют курс путём к коллапсу.",
    },
  };
  const tier = factionDebuffTier(value);
  const bucket = tier === 0 ? "high" : tier === 1 ? "mid" : tier === 2 ? "low" : "critical";
  return MOODS[id][bucket];
}

// Лестница дебаффов — зеркало FACTION_DEBUFF_LADDER в backend/src/rules/rules-engine.js (числа и
// пороги должны совпадать 1:1, это только для отображения игроку "что именно сейчас происходит").
const FACTION_DEBUFF_TIER_TEXT = {
  faction_siloviki: ["Готовность −1", "Готовность −2, боевой дух −1", "Готовность −3, боевой дух −2, армия −1", "Готовность −4, боевой дух −3, армия −2, стабильность −2"],
  faction_tehnokraty: ["Рост ВВП −1", "Рост ВВП −2, инфляция +1", "Рост ВВП −3, инфляция +2, экономика −1", "Рост ВВП −4, инфляция +3, экономика −2, резервы −2"],
  faction_oligarhi: ["Казна −1/мес", "Казна −2/мес, коррупция +1", "Казна −3/мес, коррупция +2, экономика −1", "Казна −4/мес, коррупция +3, экономика −2, изоляция +1"],
  faction_konservatory: ["Одобрение −1", "Одобрение −2, стабильность −1", "Одобрение −3, стабильность −2, элиты −1", "Одобрение −4, стабильность −3, элиты −2"],
};
function factionDebuffTier(value) {
  if (value < 15) return 4;
  if (value < 30) return 3;
  if (value < 45) return 2;
  if (value < 60) return 1;
  return 0;
}

function FactionsTab({ state, gameId, onStateRefresh }) {
  const stats = state.stats || {};
  const coalition = stats.coalition_stability ?? 0;
  const milestone = !!stats.coalition_milestone_reached;
  const pending = state.pendingFactionDilemma;

  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState(null);
  const [resolveError, setResolveError] = useState(null);

  async function handleChoice(choice) {
    if (resolving || !pending) return;
    setResolving(true);
    setResolveError(null);
    try {
      const result = await resolveFactionDilemma(gameId, pending.id, choice);
      setResolveResult(result);
    } catch (err) {
      setResolveError(err.message);
    } finally {
      setResolving(false);
    }
  }

  function handleDone() {
    setResolveResult(null);
    onStateRefresh?.();
  }

  return (
    <div>
      {/* Дашборд башен */}
      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.1em", color: "#7a8294", textTransform: "uppercase", marginBottom: 10 }}>
        Кремлёвские башни · ход {(state.turn ?? 0) + 1} · баланс сил элит
      </div>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {FACTION_ORDER.map((id) => {
          const meta = FACTION_META[id];
          const value = stats[id] ?? 55;
          const color = value >= 55 ? "#6ec894" : value < 35 ? "#e08080" : "#c8a857";
          const tier = factionDebuffTier(value);
          return (
            <div key={id} style={{ background: "#1c2230", border: "1px solid #2a3040", borderLeft: `4px solid ${meta.color}`, borderRadius: 6, padding: "13px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                <div>
                  <div className="doc-font" style={{ fontSize: 15, fontWeight: 700, color: "#ece7d8" }}>{meta.icon} {meta.label}</div>
                  <div className="mono-font" style={{ fontSize: 9.5, color: "#8a94a6", letterSpacing: "0.04em", marginTop: 2 }}>{meta.role}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="mono-font" style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                </div>
              </div>
              <div style={{ background: "#141a24", borderRadius: 3, height: 6, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${value}%`, background: color, transition: "width 0.4s" }} />
              </div>
              <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.45, color: "#d8dce4", marginBottom: tier > 0 ? 8 : 0 }}>{factionMoodText(id, value)}</div>
              {tier > 0 && (
                <div style={{ background: "#241a12", border: "1px solid #5a4020", borderRadius: 4, padding: "6px 9px" }}>
                  <div className="mono-font" style={{ fontSize: 8.5, color: "#d99a4e", letterSpacing: "0.06em", marginBottom: 2, textTransform: "uppercase" }}>⚠ Давление уровня {tier}/4 — помесячно</div>
                  <div className="mono-font" style={{ fontSize: 9.5, color: "#e8d4b8" }}>{FACTION_DEBUFF_TIER_TEXT[id][tier - 1]}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Риск мятежа — отдельный, более редкий механизм поверх обычной лестницы дебаффов
          (см. модуляцию elite_satisfaction-мятежа в turns.js по faction_siloviki < 30). */}
      {(stats.faction_siloviki ?? 55) < 30 && (
        <div style={{ background: "#241a12", border: "1px solid #5a4020", borderLeft: "4px solid #d99a4e", borderRadius: 6, padding: "11px 14px", marginBottom: 10 }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#d99a4e", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>⚠ Риск мятежа силовиков</div>
          <div className="doc-font" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#e8d4b8" }}>Помимо ежемесячного давления, растёт и вероятность прямого выступления силовой части элит против центра.</div>
        </div>
      )}

      {/* Коалиционная стабильность */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#141a24", border: "1px solid #2a3040", borderRadius: 5, padding: "8px 12px", marginBottom: 16 }}>
        <span className="mono-font" style={{ fontSize: 8.5, color: "#7a8294", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Коалиционная стабильность</span>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ width: 14, height: 6, borderRadius: 2, background: i < coalition ? "#c8a857" : "#2a3040" }} />
          ))}
        </div>
        <span className="mono-font" style={{ fontSize: 9, color: "#c8a857", marginLeft: "auto", textAlign: "right" }}>
          {milestone ? "5/5 — риск случайного кризиса снижен" : `${coalition}/5 → −1% шанс случайного кризиса`}
        </span>
      </div>

      {/* Карточка-дилемма */}
      {pending && !resolveResult && (
        <FactionDilemmaCard dilemmaId={pending.id} onChoose={handleChoice} resolving={resolving} error={resolveError} />
      )}
      {resolveResult && (
        <div style={{ background: "#12241a", border: "1px solid #2a5a3a", borderRadius: 6, padding: "14px 16px" }}>
          <div className="mono-font" style={{ fontSize: 9, color: "#5fbf85", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Решение принято</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.entries(resolveResult.statDeltas)
              .filter(([k, v]) => v && !k.startsWith("perk_") && k !== "coalition_milestone_reached")
              .map(([k, v]) => (
                <span key={k} className="mono-font" style={{ fontSize: 11, color: v > 0 ? "#7fae93" : "#e09090" }}>
                  {FACTION_META[k]?.label || ALL_STAT_LABELS[k] || (k === "coalition_stability" ? "Коалиционная стабильность" : k)}: {v > 0 ? "+" : ""}{v}
                </span>
              ))}
          </div>
          <button onClick={handleDone} style={{ background: "#3a8a5a", color: "#fff", border: "none", borderRadius: 5, padding: "9px 20px", fontFamily: "'PT Serif',serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Продолжить →
          </button>
        </div>
      )}
    </div>
  );
}

// Нарративное содержимое дилемм — id и цифры должны совпадать с FACTION_DILEMMAS в
// backend/src/rules/rules-engine.js (бэкенд — источник истины по числам, тут только текст +
// зеркало превью-цифр для игрока ДО выбора, тот же принцип, что и у UaResponsePreviewLine).
const DILEMMA_META = {
  budget_standoff: {
    title: "ПРИДВОРНАЯ ИНТРИГА",
    quotes: [
      { who: "СИЛОВИКИ", color: "#b2585a", text: "«Инициатива на нашей стороне впервые за три месяца. Заморозить военный бюджет сейчас — значит подарить фронт обратно. Экономика подождёт.»" },
      { who: "ТЕХНОКРАТЫ", color: "#5b8ab0", text: "«Каждый лишний рубль в оборону — рубль, которого не будет на стабилизацию рынка. Санкционный пакет ЕС уже душит бюджет.»" },
    ],
    advisor: "Обе стороны правы по-своему, и обе будут недовольны, если вы просто отмахнётесь. Компромисс с реальным аудитом расходов снижает трение с обеими башнями сразу, хоть и не даёт максимума ни там, ни там.",
    optionA: { factionId: "faction_siloviki", label: "Встать на сторону Силовиков", desc: "расширенная мобилизация и рост оборонного бюджета",
      preview: ["70%: Армия +4, Стабильность −2, Одобрение −2", "30%: Армия +2, Стабильность −3, Одобрение −3", "всегда: Силовики +18 лояльности, Технократы −16, Олигархи −6"],
      perk: "★ Силовики берут оргнагрузку на себя: военные категории −30% инициативы, 2 хода" },
    optionB: { factionId: "faction_tehnokraty", label: "Встать на сторону Технократов", desc: "заморозить военный бюджет, пустить средства на стабилизацию",
      preview: ["70%: Экономика +3, Готовность −1", "30%: Экономика +1, Армия −2, Готовность −3", "всегда: Технократы +18 лояльности, Силовики −16, Олигархи +4"],
      perk: "★ Технократы берут финансы под личный аудит: коррупционная утечка ×0.4, 2 хода" },
    compromise: { label: "Компромисс", desc: "точечная индексация военного бюджета под независимым аудитом расходов",
      preview: ["Армия +1, Экономика +1, Стабильность +2 — без риска провала", "всегда: Силовики +4, Технократы +4, Олигархи +2"] },
  },
  sanctions_relief: {
    title: "ЗОНДАЖ О САНКЦИЯХ",
    quotes: [
      { who: "ОЛИГАРХИ", color: "#c8a857", text: "«Каналы сбыта сжимаются с каждым пакетом санкций. Нужен зондаж по их снятию, даже если Запад потребует уступок.»" },
      { who: "КОНСЕРВАТОРЫ", color: "#9a5a86", text: "«Никаких переговоров с позиции слабости. Уступки сейчас — сигнал, что курс можно сломать давлением.»" },
    ],
    advisor: "Бизнес считает потери уже сейчас, идеологи — риски в будущем. Компромисс без громких заявлений снимает часть давления, не давая повода ни для торжества, ни для обвинений в сдаче позиций.",
    optionA: { factionId: "faction_oligarhi", label: "Встать на сторону Олигархов", desc: "зондаж по снятию санкций",
      preview: ["60%: Изоляция −4, Экономика +2", "40%: Изоляция −1, Одобрение −2", "всегда: Олигархи +18 лояльности, Консерваторы −16, Силовики −4"], perk: null },
    optionB: { factionId: "faction_konservatory", label: "Встать на сторону Консерваторов", desc: "жёсткая линия, никаких переговоров с Западом",
      preview: ["70%: Стабильность +3, Одобрение +2", "30%: Стабильность +1, Изоляция +2", "всегда: Консерваторы +18 лояльности, Олигархи −16, Силовики +4"], perk: null },
    compromise: { label: "Компромисс", desc: "тихие контакты без публичных заявлений",
      preview: ["Изоляция −1, Стабильность +1 — без риска провала", "всегда: Олигархи +4, Консерваторы +4, Силовики +1"] },
  },
  anticorruption_purge: {
    title: "АУДИТ ИЛИ ТИШИНА",
    quotes: [
      { who: "ТЕХНОКРАТЫ", color: "#5b8ab0", text: "«Схемы в оборонных закупках душат бюджет не хуже санкций. Нужен реальный аудит, не для галочки.»" },
      { who: "ОЛИГАРХИ", color: "#c8a857", text: "«Аудит сейчас — удар по тем самым людям, что держат экономику на плаву в обход санкций. Не время.»" },
    ],
    advisor: "И тут, и там — реальная цена. Аудит без лишнего шума даёт часть эффекта, не разрушая ни одну из сторон до конца.",
    optionA: { factionId: "faction_tehnokraty", label: "Встать на сторону Технократов", desc: "реальный аудит расходов",
      preview: ["65%: Коррупция −4, Одобрение +2", "35%: Коррупция −2, Стабильность −1", "всегда: Технократы +18 лояльности, Олигархи −16, Консерваторы −2"],
      perk: "★ Технократы берут финансы под личный аудит: коррупционная утечка ×0.4, 2 хода" },
    optionB: { factionId: "faction_oligarhi", label: "Встать на сторону Олигархов", desc: "реформу спустить на тормозах",
      preview: ["70%: Экономика +2, Коррупция +2", "30%: Экономика +1, Одобрение −2", "всегда: Олигархи +18 лояльности, Технократы −16, Консерваторы +2"], perk: null },
    compromise: { label: "Компромисс", desc: "точечный аудит без публичных разбирательств",
      preview: ["Коррупция −1, Экономика +1 — без риска провала", "всегда: Технократы +4, Олигархи +4"] },
  },
  media_control: {
    title: "ИНФОРМАЦИОННЫЙ КУРС",
    quotes: [
      { who: "КОНСЕРВАТОРЫ", color: "#9a5a86", text: "«Информационное поле надо закручивать, а не либерализовать — расслабленность сейчас читается как слабость.»" },
      { who: "ТЕХНОКРАТЫ", color: "#5b8ab0", text: "«Жёсткий контроль отпугивает инвесторов и партнёров. Умеренная либерализация вернёт часть легитимности вовне.»" },
    ],
    advisor: "Идеологическая твёрдость и внешняя легитимность тянут в разные стороны. Средний курс не радикализует ни одну из сторон.",
    optionA: { factionId: "faction_konservatory", label: "Встать на сторону Консерваторов", desc: "закрутить гайки",
      preview: ["70%: Стабильность +3, Дипломатия −2", "30%: Стабильность +1, Изоляция +2", "всегда: Консерваторы +18 лояльности, Технократы −16, Силовики +4"], perk: null },
    optionB: { factionId: "faction_tehnokraty", label: "Встать на сторону Технократов", desc: "либерализация под инвестиции",
      preview: ["65%: Дипломатия +3, Изоляция −2", "35%: Дипломатия +1, Стабильность −2", "всегда: Технократы +18 лояльности, Консерваторы −16, Силовики −4"], perk: null },
    compromise: { label: "Компромисс", desc: "точечные послабления без смены курса",
      preview: ["Стабильность +1, Дипломатия +1 — без риска провала", "всегда: Консерваторы +4, Технократы +4"] },
  },
};

function FactionDilemmaCard({ dilemmaId, onChoose, resolving, error }) {
  const meta = DILEMMA_META[dilemmaId];
  if (!meta) return null;
  const optA = meta.optionA;
  const optB = meta.optionB;
  const optC = meta.compromise;
  const renderOption = (key, opt, borderColor) => (
    <div
      key={key}
      onClick={() => !resolving && onChoose(key)}
      style={{
        borderRadius: 5, padding: "11px 14px", background: key === "compromise" ? "#1f1a12" : "#1a1622",
        border: `1px solid ${borderColor}`, cursor: resolving ? "default" : "pointer", opacity: resolving ? 0.6 : 1,
      }}
    >
      <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.4, color: "#ece7d8", marginBottom: 6 }}>
        <b style={{ color: borderColor }}>{opt.label}</b> — {opt.desc}
      </div>
      <div className="mono-font" style={{ fontSize: 9.5, display: "flex", flexDirection: "column", gap: 1 }}>
        {opt.preview.map((line, i) => (
          <div key={i} style={{ color: line.startsWith("всегда") ? "#c8a857" : "#9a94a6" }}>{line}</div>
        ))}
        {opt.perk && <div style={{ color: "#c8a857", fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: "1px dashed #3a3040" }}>{opt.perk}</div>}
      </div>
    </div>
  );
  return (
    <div style={{ background: "#100d16", border: "1px solid #3a2f4a", borderRadius: 10, padding: "18px 16px 16px" }}>
      <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.2em", color: "#c8a857", textAlign: "center", marginBottom: 6, textTransform: "uppercase" }}>🏛 Требование башен</div>
      <div className="doc-font" style={{ fontSize: 19, fontWeight: 700, textAlign: "center", marginBottom: 16, color: "#ece7d8" }}>{meta.title}</div>
      <div style={{ background: "#1e1a14", border: "1px solid #4a3d28", borderLeft: "3px solid #c8a857", borderRadius: 6, padding: "13px 15px", marginBottom: 12 }}>
        {meta.quotes.map((q, i) => (
          <div key={i} style={{ marginBottom: i < meta.quotes.length - 1 ? 10 : 0 }}>
            <div className="mono-font" style={{ fontSize: 9, letterSpacing: "0.06em", color: q.color, marginBottom: 3, textTransform: "uppercase" }}>{q.who}</div>
            <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, color: "#e0d8c4", fontStyle: "italic" }}>{q.text}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#141c14", border: "1px solid #2a4020", borderLeft: "3px solid #4a7a3a", borderRadius: 6, padding: "9px 13px", marginBottom: 14 }}>
        <div className="mono-font" style={{ fontSize: 8, color: "#4a7a3a", letterSpacing: "0.12em", marginBottom: 4, textTransform: "uppercase" }}>👤 Советник</div>
        <div className="doc-font" style={{ fontSize: 12.5, color: "#a8c8a0", lineHeight: 1.5 }}>{meta.advisor}</div>
      </div>
      {error && <div className="doc-font" style={{ fontSize: 12, color: "#e09090", marginBottom: 10 }}>{error}</div>}
      <div className="mono-font" style={{ fontSize: 9, color: "#8a7a9a", letterSpacing: "0.08em", marginBottom: 10, textTransform: "uppercase" }}>Ваше решение:</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {renderOption("optionA", optA, FACTION_META[optA.factionId]?.color || "#b2585a")}
        {renderOption("optionB", optB, FACTION_META[optB.factionId]?.color || "#5b8ab0")}
        {renderOption("compromise", optC, "#9c8347")}
      </div>
    </div>
  );
}

function PoliciesTab({ state, gameId, currentTurn, onStateRefresh }) {
  const [openPolicy, setOpenPolicy] = useState(null);

  if (!state.policies?.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#a8a294", fontStyle: "italic" }}>{t("policies.empty")}</div>;
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
      <div key={i} onClick={() => setOpenPolicy(policy)} style={{ background: "#161b26", border: "1px solid #2a3040", borderRadius: 4, padding: "13px 14px", cursor: "pointer", transition: "border-color 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.borderColor = "#9c8347"}
        onMouseLeave={e => e.currentTarget.style.borderColor = "#2a3040"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <span className="doc-font" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: "#ece7d8" }}>{policy.title}</span>
          {cat && <span className="mono-font" style={{ fontSize: 8, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 3, background: cat.color + "22", color: cat.color, flexShrink: 0, marginLeft: 8, whiteSpace: "nowrap" }}>{policyCategoryLabel(policy.category, cat.label)}</span>}
        </div>
        {boosts.length > 0 && (
          <div className="doc-font" style={{ fontSize: 11.5, color: "#7fae93", marginBottom: 7 }}>{t("policies.success_boost", { boosts: boosts.join(" · ") })}</div>
        )}
        {(Number(policy.budget_income) || Number(policy.budget_upkeep) || Number(policy.approval_upkeep)) ? (
          <div className="doc-font" style={{ fontSize: 11.5, marginBottom: 7, color: "#cdd3e0" }}>
            {t("policies.while_active")}
            {Number(policy.budget_income) > 0 && <span style={{ color: "#7fae93", fontWeight: 700 }}>{t("policies.treasury_plus", { n: policy.budget_income, rub: (Number(policy.budget_income) * TREASURY_PER_TRILLION).toFixed(1), trillion: t("treasury.trillion") })}</span>}
            {Number(policy.budget_upkeep) > 0 && <span style={{ color: "#e09090", fontWeight: 700 }}> · {t("policies.treasury_minus", { n: policy.budget_upkeep, rub: (Number(policy.budget_upkeep) * TREASURY_PER_TRILLION).toFixed(1), trillion: t("treasury.trillion") })}</span>}
            {(Number(policy.approval_upkeep) || 0) !== 0 && (
              <span style={{ color: Number(policy.approval_upkeep) < 0 ? "#e09090" : "#7fae93", fontWeight: 700 }}> · {t("policies.approval_rate", { sign: Number(policy.approval_upkeep) > 0 ? "+" : "", n: policy.approval_upkeep })}</span>
            )}
          </div>
        ) : null}
        <div style={{ marginBottom: 8 }}>
          {policy.target_turn != null ? (
            <>
              <div style={{ height: 5, background: "#2a3040", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
                <div style={{ width: `${progress}%`, height: "100%", background: progress >= 100 ? "#7fae93" : "#9c8347", transition: "width 0.4s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="mono-font" style={{ fontSize: 8, color: "#a8a294" }}>{t("policies.turn_range", { from: policy.turn, to: policy.target_turn })}</span>
                <span className="mono-font" style={{ fontSize: 8, color: turnsLeft !== null && turnsLeft <= 1 ? "#e09090" : "#a8a294" }}>
                  {turnsLeft === 0 ? t("policies.finishing") : t("policies.turns_left", { n: turnsLeft })}
                </span>
              </div>
            </>
          ) : (
            <span className="mono-font" style={{ fontSize: 8, color: "#a8a294" }}>{t("policies.turn_indefinite", { n: policy.turn })}</span>
          )}
        </div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {(policy.items || []).slice(0, 2).map((item, j) => (
            <li key={j} className="doc-font" style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 3, color: "#cdd3e0" }}>{item}</li>
          ))}
          {(policy.items || []).length > 2 && <li className="mono-font" style={{ fontSize: 9, color: "#a8a294", listStyle: "none" }}>{t("policies.more_items", { n: policy.items.length - 2 })}</li>}
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
              {policyCategorySection(cat, POLICY_CATEGORY[cat].section)} · {items.length}
            </div>
            <div style={{ display: "grid", gap: 12 }}>{items.map((p, i) => renderCard(p, `${cat}-${i}`))}</div>
          </div>
        ))}
        {uncategorized.length > 0 && (
          <div>
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#a8a294", marginBottom: 8 }}>{t("policies.other_section", { n: uncategorized.length })}</div>
            <div style={{ display: "grid", gap: 12 }}>{uncategorized.map((p, i) => renderCard(p, `u-${i}`))}</div>
          </div>
        )}
        {cancelled.length > 0 && (
          <div className="mono-font" style={{ fontSize: 9, color: "#a8a294", marginTop: 4 }}>{t("policies.cancelled_count", { n: cancelled.length })}</div>
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

// Плитки Отношений (Петя, 2026-07-08: "виджеты без флагов... нужно чтоб уменьшались до маленького
// квадратика... при нажатии не 'развернуть', а 'подробнее' — в отдельном окне, а то виджет
// растягивается до бесконечности"). Отказался от WidgetCard/масонри-раскладки, которая была
// заточена под РАЗНОРАЗМЕРНЫЕ виджеты Казны — тут все плитки одного размера, масонри и
// resize-ручка были лишними и давали то самое "растягивание". Простая CSS grid (auto-flow сам
// расставляет по местам при смене порядка, без ручной абсолютной позиции/ResizeObserver) + одна
// общая модалка на "подробнее" вместо инлайн-разворота.
//
// Эмодзи-флаги (🇺🇸 и т.п.) на Windows/Chrome рендерятся как голые буквы "US" — известное
// ограничение шрифтов ОС (см. HANDOFF), а не баг кода. Вместо того чтобы полагаться на эмодзи-шрифт
// ОС, используем flag-icons (CSS-спрайт, cdnjs-импорт в общем <style> App) — рисует флаг как
// картинку, одинаково на любой ОС/браузере.
const RELATION_ISO = {
  "США": "us", "Украина": "ua", "Китай": "cn", "ЕС": "eu", "Турция": "tr", "Индия": "in",
  "Германия": "de", "Франция": "fr", "Израиль": "il", "Иран": "ir", "Саудовская Аравия": "sa",
  "Беларусь": "by", "Польша": "pl", "Великобритания": "gb", "Япония": "jp", "КНДР": "kp",
  "Венгрия": "hu", "ОАЭ": "ae", "НАТО": null,
};
const RELATION_COUNTRY_ALIAS = { "КНДР": "Северная Корея" }; // seed игрока использует другое имя, чем COUNTRY_INFO
const RELATION_BLOC_FLAG = { "ЕС": "🇪🇺", "НАТО": "🛡" }; // блоки стран — не отдельная страна в COUNTRY_INFO
// Фоллбэк на эмодзи, если страны нет в RELATION_ISO (флаг может не отрисоваться на Windows,
// но 🌐-заглушка — обычный пиктограф, не флаговая последовательность, рисуется везде).
function countryFlagEmoji(name) {
  return COUNTRY_INFO[RELATION_COUNTRY_ALIAS[name] || name]?.flag || RELATION_BLOC_FLAG[name] || "🌐";
}
function relationStance(value) {
  if (value >= 60) return "cooperative";
  if (value <= 30) return "hostile";
  return "neutral";
}
const RELATION_STANCE_COLOR = { cooperative: "#7fae93", neutral: "#c8a96a", hostile: "#e09090" };
// <Modal> — общий компонент, ВСЕГДА светлое кремовое тело независимо от вкладки — свои,
// светлые по контексту цвета (тот же принцип, что MODAL_STANCE_COLOR/BG в WorldTab).
const MODAL_RELATION_COLOR = { cooperative: "#4a6b5c", neutral: "#7a6a3a", hostile: "#a8313a" };
const MODAL_RELATION_BG    = { cooperative: "#f0f5f0", neutral: "#f5f1e6", hostile: "#f5f0ee" };

function CountryFlag({ name, size = 18 }) {
  const iso = RELATION_ISO[name];
  if (iso) {
    return <span className={`fi fi-${iso}`} style={{ width: size, borderRadius: 2, flexShrink: 0, boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }} />;
  }
  return <span style={{ fontSize: size - 2, flexShrink: 0 }}>{countryFlagEmoji(name)}</span>;
}

// Маленькая квадратная плитка — минимум информации: флаг, название, число+тренд, бар.
// "Подробнее" открывает модалку (CountryDetailsModal) вместо инлайн-разворота — раньше разворот
// внутри плитки растягивал её на весь текст заметки+историю событий без ограничения высоты.
function CountryTile({ r, onOpenDetails, onDragPointerDown, isDragging, dragOffset }) {
  const stance = relationStance(r.value);
  const color = RELATION_STANCE_COLOR[stance];
  return (
    <div
      data-relation-id={r.name}
      style={{
        position: "relative",
        background: "linear-gradient(180deg,#242b3d 0%,#1e2433 100%)",
        borderRadius: 12, padding: "10px 12px 8px",
        display: "flex", flexDirection: "column", gap: 6,
        boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.55)" : "0 4px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        transform: isDragging && dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px) scale(1.05)` : "none",
        zIndex: isDragging ? 50 : 1,
        pointerEvents: isDragging ? "none" : "auto",
        transition: isDragging ? "none" : "box-shadow 0.15s, transform 0.15s",
      }}
    >
      <span
        onPointerDown={onDragPointerDown}
        title={t("widget.drag_tooltip")}
        style={{ position: "absolute", top: 6, right: 8, color: "#5a6070", fontSize: 11, letterSpacing: 2, cursor: "grab", touchAction: "none", userSelect: "none" }}
      >⋮⋮</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 18 }}>
        <CountryFlag name={r.name} />
        <span className="doc-font" style={{ fontSize: 12, fontWeight: 700, color: "#ece7d8", lineHeight: 1.25 }}>{r.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono-font" style={{ fontSize: 8, color, letterSpacing: "0.06em", background: `${color}18`, padding: "2px 6px", borderRadius: 2 }}>
          {t(`relations.stance.${stance}`)}
        </span>
        <TrendIcon trend={r.trend} />
        <span className="mono-font" style={{ fontSize: 17, fontWeight: 700, color }}>{r.value}</span>
      </div>
      <Bar value={r.value} color={color} />
      <button
        onClick={onOpenDetails}
        className="mono-font"
        style={{ marginTop: 2, background: "none", border: "none", color: "#8a9aaa", fontSize: 8.5, letterSpacing: "0.05em", cursor: "pointer", padding: 0, textAlign: "left" }}
      >
        {t("relations.more_arrow")}
      </button>
    </div>
  );
}

// Модалка "подробнее" — заметка об отношениях + история конкретных событий с этой страной
// (world_move/reaction из ленты, где source === название страны). Раньше это разворачивалось
// ВНУТРИ плитки, растягивая её на неограниченную высоту — теперь отдельное окно, плитка всегда
// компактна.
// Компактная плашка "информация" (ВВП/население/союз/язык) — статичная справочная база
// COUNTRY_INFO (уже используется для флага/описания в MapTab), Петя 2026-07-08: "добавь ещё
// информацию о ввп каждой страны, их населении, в каком союзе состоят, и какой язык основной".
// Заполнено для стран из base_relations сида (18 + Россия) — остальные страны COUNTRY_INFO
// (доступны через клик по карте в MapTab) новых полей пока не получили, там просто не покажется.
function CountryFactsheet({ info }) {
  if (!info || !(info.gdp || info.population || info.alliance || info.language)) return null;
  const rows = [
    [t("relations.factsheet_gdp"), info.gdp], [t("relations.factsheet_population"), info.population],
    [t("relations.factsheet_alliance"), info.alliance], [t("relations.factsheet_language"), info.language],
  ].filter(([, v]) => v);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: 14, padding: "10px 12px", background: "#ece7d8", borderRadius: 4 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <div className="mono-font" style={{ fontSize: 8, color: "#8a8472", letterSpacing: "0.05em" }}>{label}</div>
          <div className="doc-font" style={{ fontSize: 12.5, color: "#3a362e", fontWeight: 700 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function CountryDetailsModal({ r, events, onClose }) {
  const stance = relationStance(r.value);
  const col = MODAL_RELATION_COLOR[stance];
  const info = COUNTRY_INFO[RELATION_COUNTRY_ALIAS[r.name] || r.name];
  return (
    <Modal title={r.name.toUpperCase() + " · " + t("relations.title_suffix")} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "7px 10px", background: MODAL_RELATION_BG[stance], borderRadius: 4, border: `1px solid ${col}33` }}>
        <span className="mono-font" style={{ fontSize: 9, color: col, letterSpacing: "0.08em" }}>{t(`relations.stance.${stance}`)}</span>
        <span className="mono-font" style={{ fontSize: 11, fontWeight: 700, color: col }}>{r.value}/100</span>
        <div style={{ flex: 1, height: 4, background: "#d8d2bf", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${r.value}%`, height: "100%", background: col }} />
        </div>
      </div>
      <CountryFactsheet info={info} />
      <div className="doc-font" style={{ fontSize: 14, lineHeight: 1.6, color: "#3a362e", marginBottom: 14 }}>{r.note}</div>
      <div style={{ borderTop: "1px solid #d8d2bf", paddingTop: 12 }}>
        <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8, letterSpacing: "0.06em" }}>{t("relations.events_header")}</div>
        {events.length === 0 ? (
          <div className="doc-font" style={{ fontSize: 12.5, color: "#8a8472", fontStyle: "italic" }}>{t("relations.no_events")}</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {events.slice(0, 8).map((ev, i) => (
              <div key={i}>
                <span className="mono-font" style={{ fontSize: 9, color: "#8a8472" }}>{t("relations.turn_short")} {ev.turn}</span>
                <div className="doc-font" style={{ fontSize: 13, color: "#3a362e", lineHeight: 1.45 }}>{ev.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function RelationsTab({ state }) {
  const relations = state.relations || [];
  const relationIds = relations.map(r => r.name);

  const [order, setOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rp_relations_order") || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter(id => relationIds.includes(id));
        const missing = relationIds.filter(id => !known.includes(id));
        return [...known, ...missing];
      }
    } catch {}
    return relationIds;
  });
  const [detailsFor, setDetailsFor] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOffset, setDragOffset] = useState(null);

  function handleDrop(fromId, overId) {
    if (fromId && overId && fromId !== overId) {
      setOrder(prev => {
        const ids = [...prev];
        const fromIdx = ids.indexOf(fromId);
        const toIdx = ids.indexOf(overId);
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, fromId);
        localStorage.setItem("rp_relations_order", JSON.stringify(ids));
        return ids;
      });
    }
    setDraggedId(null);
    setDragOffset(null);
  }

  // Тот же паттерн pointer-драга, что WidgetCard (Казна) — визуально следует за курсором,
  // цель определяется в момент отпускания через elementsFromPoint.
  function makeDragHandler(id) {
    return function handlePointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      setDraggedId(id);
      function onMove(ev) { setDragOffset({ dx: ev.clientX - startX, dy: ev.clientY - startY }); }
      function onUp(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
          .find(el => el.dataset && el.dataset.relationId && el.dataset.relationId !== id);
        handleDrop(id, hit ? hit.dataset.relationId : null);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
  }

  if (!relations.length) {
    return <div className="doc-font" style={{ fontSize: 13, color: "#a8a294", fontStyle: "italic" }}>{t("relations.empty")}</div>;
  }

  const relByName = {};
  for (const r of relations) relByName[r.name] = r;

  const detailsR = detailsFor ? relByName[detailsFor] : null;
  const detailsEvents = detailsFor
    ? (state.newsfeed || []).filter(n => (n.type === "world_move" || n.type === "reaction") && n.source === detailsFor).slice().reverse()
    : [];

  return (
    <div>
      {detailsR && <CountryDetailsModal r={detailsR} events={detailsEvents} onClose={() => setDetailsFor(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {order.map(id => {
          const r = relByName[id];
          if (!r) return null;
          return (
            <CountryTile
              key={id} r={r}
              onOpenDetails={() => setDetailsFor(id)}
              onDragPointerDown={makeDragHandler(id)}
              isDragging={draggedId === id}
              dragOffset={draggedId === id ? dragOffset : null}
            />
          );
        })}
      </div>
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

  // Карточки хода (STANCE_*) рендерятся на тёмной вкладке — цвета под тёмный фон. А вот
  // <Modal> (открывается по клику на карточку) — общий на всё приложение компонент, у него
  // ВСЕГДА светлое кремовое тело (#f5f1e6) независимо от вкладки — для содержимого модалки
  // нужны отдельные, светлые по контексту цвета (MODAL_STANCE_COLOR/MODAL_STANCE_BG).
  const STANCE_COLOR  = { cooperative: "#7fae93", neutral: "#c8a96a", hostile: "#e09090" };
  const STANCE_BG     = { cooperative: "#12201a", neutral: "#161b26", hostile: "#20141a" };
  const STANCE_BORDER = { cooperative: "#4a6b5c", neutral: "#9c8347", hostile: "#a8313a" };
  const STANCE_BADGE  = { cooperative: t("world.stance.cooperative"), neutral: t("world.stance.neutral"), hostile: t("world.stance.hostile") };
  const MODAL_STANCE_COLOR = { cooperative: "#4a6b5c", neutral: "#7a6a3a", hostile: "#a8313a" };
  const MODAL_STANCE_BG    = { cooperative: "#f0f5f0", neutral: "#f5f1e6", hostile: "#f5f0ee" };

  if (!worldMoves.length) {
    return (
      <div className="doc-font" style={{ fontSize: 13, color: "#a8a294", fontStyle: "italic" }}>
        {t("world.empty")}
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
        const col = MODAL_STANCE_COLOR[stance];
        const relVal = relMap[modal.source];
        return (
          <Modal title={modal.source.toUpperCase() + " · " + t("world.turn_short") + " " + modal.turn} onClose={() => setModal(null)}>
            {relVal !== undefined && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "7px 10px", background: MODAL_STANCE_BG[stance], borderRadius: 4, border: `1px solid ${col}33` }}>
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
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 8, letterSpacing: "0.06em" }}>{t("world.analysts")}</div>
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
            <div className="mono-font" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a8a294", marginBottom: 8, borderBottom: "1px solid #2a3040", paddingBottom: 4 }}>
              {t("world.turn_header", { turn })}
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
                        <div className="doc-font" style={{ fontSize: 13.5, lineHeight: 1.4, color: "#cdd3e0" }}>
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

// .label переведён отдельно, лукапом по ключу в месте отображения (см. newsfeedTypeLabel/
// worldMoveStanceLabel ниже) — та же причина, что и у statLabel(): это module-level const,
// вычисляется один раз при загрузке модуля, а не при каждом рендере.
const NEWSFEED_TYPE = {
  decree:          { icon: "📜", color: "#a8313a" },
  news:            { icon: "📰", color: "#5b6b8c" },
  reaction:        { icon: "🌐", color: "#4a6b5c" },
  nuclear_reaction:{ icon: "☢", color: "#c03030" },
};

// world_move раньше всегда красился под "врага" — но source может быть и союзником
// (Беларусь, Китай и т.д.). Стойка считается по реальным отношениям (state.relations),
// как в WorldTab, а не по статичному списку.
const WORLD_MOVE_STANCE_STYLE = {
  cooperative: { icon: "🤝", color: "#4a8c5a", bg: "#0e1a10", border: "#2a5a30", text: "#a0d0a8", toggle: "#4a7a50" },
  neutral:     { icon: "🌐", color: "#8c7a3a", bg: "#1a1608", border: "#5a4a20", text: "#d0c090", toggle: "#7a6a40" },
  hostile:     { icon: "⚡", color: "#8c4a2a", bg: "#1a0e0a", border: "#6a3020", text: "#d0a090", toggle: "#6a4030" },
};
function newsfeedTypeLabel(type) { return t(`newsfeed.type.${type}`); }
function worldMoveStanceLabel(stance) { return t(`newsfeed.stance.${stance}`); }
function getWorldMoveStance(relMap, source) {
  const val = relMap[source];
  if (val === undefined) return "neutral";
  if (val >= 60) return "cooperative";
  if (val <= 30) return "hostile";
  return "neutral";
}

// Текст новости/события сворачивается до фиксированного числа строк, чтобы карточки
// в ленте не «прыгали» по высоте (на мобильных это сбивает позицию шапки при скролле).
// Разворачивается по клику, если игроку нужен полный текст.
function ExpandableText({ text, lines = 3, className, style, toggleColor = "#8a8472" }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <div>
      <div
        className={className}
        style={{
          ...style,
          ...(expanded ? {} : {
            display: "-webkit-box",
            WebkitLineClamp: lines,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }),
        }}
      >
        {text}
      </div>
      {text.length > 140 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mono-font"
          style={{
            background: "none", border: "none", padding: "4px 0 0", cursor: "pointer",
            fontSize: 10, letterSpacing: "0.05em", color: toggleColor,
          }}
        >
          {expanded ? "▲ Свернуть" : "▼ Развернуть"}
        </button>
      )}
    </div>
  );
}

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
            {statLabel(k, ALL_STAT_LABELS[k] || k)} {v > 0 ? "+" : ""}{v}
          </span>
        );
      })}
    </div>
  );
}

// БАЛАНС (2026-07-04): раньше здесь было отдельное зеркало ФИКСИРОВАННОЙ таблицы turns.js
// (RESPONSE_EFFECTS) — с объединением backend-путей (см. resolveUkraineResponse в
// rules-engine.js) эффект тут ТОЖЕ стал вероятностным, как и в UkraineResponseScreen — переиспользуем
// тот же UA_RESPONSE_PREVIEW/UaResponsePreviewLine вместо отдельного дубля.
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
        <ExpandableText
          text={item.text}
          className="doc-font"
          style={{ fontSize: 13.5, lineHeight: 1.45, color: "#e8c0b0" }}
          toggleColor="#8a5050"
        />
        {(() => {
          const already = Object.entries(eventData?.deltas || {}).filter(([, v]) => v !== 0);
          if (already.length === 0) return null;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {already.map(([k, v]) => (
                <span key={k} className="mono-font" style={{ fontSize: 10, color: v > 0 ? "#7fae93" : "#e09090" }}>
                  {ALL_STAT_LABELS[k] || STAT_RU[k] || k}: {v > 0 ? "+" : ""}{v}
                </span>
              ))}
            </div>
          );
        })()}
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
                    <div>{loading === r.type ? "Выполняется…" : isRetaliate ? `${r.label} ${warDanger ? "⚠ +1 эскал." : "(+1 к счётчику)"}` : r.label}</div>
                    {loading !== r.type && <UaResponsePreviewLine responseType={r.type} />}
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
// Коррупция — балл 0-100 без реального ориентира, та же проблема, что решили для ВВП/резервов.
// Даём два реальных числа: (1) ежемесячная утечка бюджета в ₽ трлн — та же величина, что уже
// считается в очках, просто переведена в деньги тем же курсом, что и казна; (2) грубый аналог
// индекса восприятия коррупции Transparency International (там 100 = самая чистая страна, у нас
// наоборот — выше балл, хуже). Калибровка: балл 55 (старт партии) ≈ реальный CPI России (~26/100).
const CPI_BEST = 46, CPI_WORST = 10; // реалистичный игровой диапазон в обе стороны от старта
function corruptionCpiEquivalent(score) {
  const s = Math.max(0, Math.min(100, score ?? 55));
  return Math.round(CPI_BEST - (CPI_BEST - CPI_WORST) * (s / 100));
}
function corruptionDrainRubTrillion(drainPoints) {
  return drainPoints * TREASURY_PER_TRILLION;
}
// Компаундинг: та же формула, что и в backend/src/routes/treasury.js (ofzMonthlyCostPerBond) —
// стоимость обслуживания 1 выпуска ОФЗ растёт вместе с ключевой ставкой ЦБ.
function ofzMonthlyCostPerBondPreview(keyRate) {
  return Math.max(2, Math.round((keyRate ?? 18.5) / 6));
}

// Карточка-виджет Казны (Петя, 2026-07-06: "виджеты должны перетаскиваться куда угодно, главное
// чтоб не налезали друг на друга... перетаскивать беря за края"). Свободная 2D-раскладка —
// masonry (кладём каждый виджет в самую короткую колонку, порядок укладки = widgetOrder), а не
// CSS grid с фиксированной высотой строки (та оставляла пустое место — разные виджеты разной
// высоты). Позиция каждой карточки (`pos.left/top/width`) считается родителем (TreasuryTab) и
// применяется через absolute-позиционирование; сама карточка лишь измеряет свою реальную высоту
// (ResizeObserver) и сообщает её наверх — родитель пересчитывает раскладку и переносит другие
// виджеты, чтобы не осталось дыр. Хитбокс драга — вся строка заголовка (реальный "край" виджета,
// не крошечная иконка). Растягивание — ручка ⤢ в углу, зажато между компактным минимумом и
// РЕАЛЬНОЙ высотой контента (scrollHeight).
function WidgetCard({ id, label, pos, onHeightChange, size, onSizeChange, draggedId, onDragStart, onDrop, children }) {
  const isDragging = draggedId === id;
  const isMini = size === "mini";
  const bodyRef = useRef(null);
  const outerRef = useRef(null);
  const [dragPreviewHeight, setDragPreviewHeight] = useState(null);
  const [dragOffset, setDragOffset] = useState(null); // {dx,dy} — карточка реально следует за курсором
  const MINI_HEIGHT = 92;

  // Драг за счёт pointer-событий, а не нативного HTML5 draggable — карточка визуально едет
  // вслед за курсором (translate по дельте), а не молча меняет порядок только на drop. Цель
  // определяется в момент отпускания через elementsFromPoint (пропускает саму перетаскиваемую
  // карточку — у неё pointerEvents:none, пока isDragging).
  function handleHeaderPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    onDragStart(id);
    function onMove(ev) {
      setDragOffset({ dx: ev.clientX - startX, dy: ev.clientY - startY });
    }
    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragOffset(null);
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .find(el => el.dataset && el.dataset.widgetId && el.dataset.widgetId !== id);
      onDrop(id, hit ? hit.dataset.widgetId : null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  useEffect(() => {
    const el = outerRef.current;
    if (!el || !onHeightChange) return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect?.height;
      if (h) onHeightChange(id, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onHeightChange]);

  function handleResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const el = bodyRef.current;
    const startH = el ? el.getBoundingClientRect().height : MINI_HEIGHT;
    function onMove(ev) {
      const fullH = el ? el.scrollHeight : startH; // реальная высота контента, доступна даже пока сама область зажата
      const next = Math.max(MINI_HEIGHT, Math.min(fullH, startH + (ev.clientY - startY)));
      setDragPreviewHeight(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragPreviewHeight(cur => {
        if (cur == null) return null;
        const fullH = el ? el.scrollHeight : startH;
        const mid = (MINI_HEIGHT + fullH) / 2;
        onSizeChange(id, cur < mid ? "mini" : "full");
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const p = pos || { left: 0, top: 0, width: 320 };

  return (
    <div ref={outerRef} data-widget-id={id} style={{
      position: "absolute",
      left: p.left, top: p.top, width: p.width,
      background: "linear-gradient(180deg,#242b3d 0%,#1e2433 100%)",
      borderRadius: 18,
      boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.55)" : "0 4px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
      transform: isDragging && dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px) rotate(-1.5deg) scale(1.03)` : "none",
      zIndex: isDragging ? 50 : 1,
      pointerEvents: isDragging ? "none" : "auto",
      transition: isDragging ? "none" : "left 0.25s ease, top 0.25s ease, width 0.25s ease, box-shadow 0.15s, transform 0.15s",
    }}>
      <div
        className="mono-font"
        style={{
          fontSize: 9, letterSpacing: "0.12em", color: "#8a8472", userSelect: "none",
          padding: "10px 16px 8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span>{label}</span>
        <span
          onPointerDown={handleHeaderPointerDown}
          title="Потяните за точки, чтобы переставить виджет"
          style={{ color: "#5a6070", fontSize: 13, letterSpacing: 2, cursor: "grab", touchAction: "none", padding: "2px 6px" }}
        >⋮⋮</span>
      </div>
      <div style={{ padding: "0 16px 14px 16px" }}>
        <div ref={bodyRef} style={{ height: dragPreviewHeight != null ? dragPreviewHeight : (isMini ? MINI_HEIGHT : "auto"), overflow: "hidden" }}>
          {children}
        </div>
      </div>
      <div
        onPointerDown={handleResizeStart}
        title="Потяните, чтобы изменить размер (не дальше конца контента)"
        style={{ position: "absolute", bottom: 6, right: 6, width: 16, height: 16, cursor: "ns-resize", color: "#5a6070", opacity: 0.6, zIndex: 2, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
      >⤢</div>
    </div>
  );
}

// Раскладка masonry для виджетов Казны: кладём каждый id (в порядке widgetOrder) в самую
// короткую на данный момент колонку — как Pinterest/фотоплитка. Число колонок — из реальной
// ширины контейнера (ResizeObserver), а не фиксированное — отзывчиво на размер окна/сайдбар.
function computeMasonryPositions(ids, heights, containerWidth, colWidth, gap) {
  const width = containerWidth > 0 ? containerWidth : colWidth;
  const columns = Math.max(1, Math.floor((width + gap) / (colWidth + gap)));
  const actualColWidth = columns > 1 ? (width - gap * (columns - 1)) / columns : width;
  const colHeights = new Array(columns).fill(0);
  const positions = {};
  for (const id of ids) {
    let col = 0;
    for (let c = 1; c < columns; c++) if (colHeights[c] < colHeights[col]) col = c;
    positions[id] = { left: col * (actualColWidth + gap), top: colHeights[col], width: actualColWidth };
    colHeights[col] += (heights[id] || 220) + gap;
  }
  const maxHeight = Math.max(0, ...colHeights) - gap;
  return { positions, height: maxHeight };
}

function TreasuryTab({ state, gameId, onRefresh }) {
  const stats = state.stats || {};
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [statHistory, setStatHistory] = useState(null);
  const [confirmReserves, setConfirmReserves] = useState(false);
  const [confirmFxRegime, setConfirmFxRegime] = useState(false);

  // Виджеты Казны — карточки с перестановкой (drag ⋮⋮, тот же паттерн, что уже обкатан для
  // вкладок шапки — tabOrder/draggedTabId/handleTabDrop) и растягиванием (ручка ⤢, зажато между
  // компактным минимумом и реальной высотой контента). Аккордеон (был здесь до этого) убран по
  // просьбе игрока — "давай уберем аккордеон... верни возможность двигать виджеты" (2026-07-06).
  // Порядок/размер — per-браузер, не часть состояния партии в БД.
  const TREASURY_WIDGET_IDS = ["treasury", "economy", "balance", "ofz", "keyrate", "corruption", "reserves", "fxregime", "inflation", "oilfx"];
  const [widgetOrder, setWidgetOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rp_treasury_order") || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter(id => TREASURY_WIDGET_IDS.includes(id));
        const missing = TREASURY_WIDGET_IDS.filter(id => !known.includes(id));
        return [...known, ...missing];
      }
    } catch {}
    return TREASURY_WIDGET_IDS;
  });
  const [widgetSizes, setWidgetSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rp_treasury_size") || "null");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  const [draggedWidgetId, setDraggedWidgetId] = useState(null);
  const [cardHeights, setCardHeights] = useState({});
  const treasuryGridRef = useRef(null);
  const [treasuryGridWidth, setTreasuryGridWidth] = useState(1200);
  useEffect(() => {
    const el = treasuryGridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setTreasuryGridWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  function handleCardHeight(id, h) {
    setCardHeights(prev => {
      const rounded = Math.round(h);
      if (prev[id] === rounded) return prev;
      return { ...prev, [id]: rounded };
    });
  }
  const MASONRY_COL_WIDTH = 320, MASONRY_GAP = 14;
  const { positions: widgetPositions, height: masonryHeight } = useMemo(
    () => computeMasonryPositions(widgetOrder, cardHeights, treasuryGridWidth, MASONRY_COL_WIDTH, MASONRY_GAP),
    [widgetOrder, cardHeights, treasuryGridWidth]
  );

  // fromId передаётся явно самой карточкой (не через draggedWidgetId state) — иначе onUp,
  // созданный в момент pointerdown, замыкается на handleWidgetDrop ТОГО рендера (ещё до того,
  // как draggedWidgetId вообще обновился), и на pointerup читает устаревшее null/предыдущее id.
  function handleWidgetDrop(fromId, overId) {
    if (!fromId || !overId || fromId === overId) { setDraggedWidgetId(null); return; }
    const ids = [...widgetOrder];
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(overId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    setWidgetOrder(ids);
    localStorage.setItem("rp_treasury_order", JSON.stringify(ids));
    setDraggedWidgetId(null);
  }
  function setWidgetSize(id, sz) {
    setWidgetSizes(prev => {
      const next = { ...prev, [id]: sz };
      localStorage.setItem("rp_treasury_size", JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    fetchStatHistory(gameId).then(d => setStatHistory(d.history || [])).catch(() => {});
  }, [gameId]);

  const treasury = typeof stats.treasury === "number" ? stats.treasury : 52;
  const eco = stats.economy ?? 50;
  const ofzCount = stats.ofz_count ?? 0;
  const ofzUsedThisMonth = !!stats.ofz_used_this_month;
  const activePolicies = (state.policies || []).filter(p => p.status !== "cancelled");
  const rawTaxIncomeT = activePolicies.reduce((s, p) => s + (Number(p.budget_income) || 0), 0);
  const programUpkeep = activePolicies.reduce((s, p) => s + (Number(p.budget_upkeep) || 0), 0);
  const ofzDebt = ofzCount * ofzMonthlyCostPerBondPreview(stats.key_rate);
  const rawEconomyIncomeT = eco >= 50
    ? Math.round(20 + (eco - 50) * 0.6)
    : eco >= 35 ? Math.round(eco * 0.4) : Math.round(Math.max(5, eco * 0.2));
  // Занятость → налоговая база: тот же коэффициент, что и в backend end-month
  const employmentT = stats.employment ?? 74;
  const employmentFactorT = Math.max(0.6, Math.min(1.3, 1 + (employmentT - 74) * 0.004));
  const economyIncome = Math.round(rawEconomyIncomeT * employmentFactorT);
  const taxIncome = Math.round(rawTaxIncomeT * employmentFactorT);
  const gdpGrowthT = stats.gdp_growth ?? 36;
  const OIL_BASELINE_T = 85, FX_BASELINE_T = 80;   // текущая "нормальная" цена — фолбэк, если oil_price не задан
  const OIL_BUDGET_CUTOFF_T = 65;                  // цена отсечения бюджета — база для oilIncomeT, НЕ фолбэк
  const oilPriceT = stats.oil_price ?? OIL_BASELINE_T;
  const usdRubT = stats.usd_rub ?? FX_BASELINE_T;
  const nominalGdpRubT = nominalGdpRubTrillion(eco);
  const nominalGdpUsdT = nominalGdpUsdTrillion(nominalGdpRubT, usdRubT);
  const gdpGrowthEvents = getStatEvents(statHistory, "gdp_growth");
  const isolationT = stats.isolation ?? 68;
  const rawSanctionDiscountT = isolationT <= 50 ? 0 : isolationT <= 80 ? (isolationT - 50) / 100 : 0.30 + (isolationT - 80) / 200;
  const allyTrustT = stats.ally_trust ?? 42;
  const allyMitigationT = allyTrustT > 50 ? Math.min(0.15, (allyTrustT - 50) / 100) : 0;
  const sanctionDiscountT = Math.max(0, rawSanctionDiscountT - allyMitigationT);
  const oilIncomeT = Math.round((oilPriceT - OIL_BUDGET_CUTOFF_T) * 0.7 * (1 - sanctionDiscountT));
  const fxIncomeT = Math.round((usdRubT - FX_BASELINE_T) * 0.4);
  const corrLevelT = stats.corruption ?? 68;
  const corruptionDrainT = corrLevelT > 50 ? Math.round(Math.pow((corrLevelT - 50) / 50, 1.3) * 12) : 0;
  const anticorruptionUsed = !!stats.anticorruption_used;
  // Содержание отвоёванных территорий: та же формула, что в backend end-month — считается
  // только сверх стартового контроля (сид партии), не с самого захваченного трофея.
  const TERRITORY_BASELINE_T = { donetsk_control: 78, luhansk_control: 96, zaporizhzhia_control: 68, kherson_control: 58, kharkiv_control: 12 };
  const territoryGainPtsT = Object.entries(TERRITORY_BASELINE_T).reduce(
    (s, [k, base]) => s + Math.max(0, (stats[k] ?? base) - base), 0
  );
  const territoryUpkeepT = Math.round(territoryGainPtsT / 15);
  const projectedNet = economyIncome + taxIncome - programUpkeep - ofzDebt + oilIncomeT + fxIncomeT - corruptionDrainT - territoryUpkeepT;
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

  async function handleCbPressure(direction) {
    setLoading("cb_pressure_" + direction); setError(null);
    try { await cbPressure(gameId, direction); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  async function handleCbReplace(type) {
    setLoading("cb_replace"); setError(null);
    try { await cbReplace(gameId, type); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  async function handleAntiCorruption() {
    setLoading("anticorruption"); setError(null);
    try { await antiCorruptionCampaign(gameId); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  async function handleConvertReserves() {
    setLoading("convert_reserves"); setError(null);
    try { await convertReserves(gameId); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  async function handleToggleFxRegime() {
    setLoading("fx_regime"); setError(null);
    try { await toggleFxRegime(gameId); onRefresh?.(); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }

  const labelStyle = { fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.12em", color: "#8a8472" };
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #e0dac8" };
  function widgetCardProps(id) {
    return {
      id, pos: widgetPositions[id], onHeightChange: handleCardHeight, size: widgetSizes[id], onSizeChange: setWidgetSize,
      draggedId: draggedWidgetId, onDragStart: setDraggedWidgetId, onDrop: handleWidgetDrop,
    };
  }

  return (
    <div ref={treasuryGridRef} style={{ position: "relative", height: masonryHeight || undefined, minHeight: 200 }}>
      {/* Казна: текущий уровень */}
      <WidgetCard {...widgetCardProps("treasury")} label={t("treasury.w.treasury_title")}>
        <div style={{ background: "#14181f", borderRadius: 6, padding: "14px 16px", border: "1px solid #2a3040" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: gaugeColor }}>
                ₽{treasuryTrln} {t("treasury.trillion")}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#5a6070", marginTop: 2 }}>
                {treasury >= 0 ? t("treasury.points", { n: `+${Math.round(treasury)}` }) : t("treasury.points_deficit", { n: Math.round(treasury) })}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: projectedNet >= 0 ? "#5a8a6a" : "#c05050" }}>
                {projectedNet >= 0 ? "▲" : "▼"} {projectedNet >= 0 ? "+" : ""}{projectedNet} {t("treasury.per_month")}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#5a6070" }}>
                {t("treasury.forecast", { n: projTrln })}
              </div>
            </div>
          </div>
          {/* Шкала */}
          <div style={{ height: 6, background: "#2a3040", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${gaugePercent}%`, background: gaugeColor, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
          {treasury < 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e05050", marginTop: 8 }}>
              {t("treasury.deficit_warning")}
            </div>
          )}
        </div>
      </WidgetCard>

      {/* Экономика: сама стата + два её драйвера (ВВП, занятость) — почему растёт/падает,
          объясняет EndMonthForecastPanel ниже (та же логика, что и на вкладке Показатели).
          Показываем в реалистичных единицах (₽/$/%%), а не в сырых баллах 0-100 —
          балл остаётся внутри для баланса, но игроку он ничего не говорит. */}
      <WidgetCard {...widgetCardProps("economy")} label={t("treasury.w.economy_title")}>
        <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 4, padding: "12px 14px", marginBottom: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 90px" }}>
            <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11, color: "#a8a294", marginBottom: 2 }}>{statLabel("economy", "Экономика")}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700, color: eco < 35 ? "#c05050" : eco >= 55 ? "#5a8a6a" : "#c8a857" }}>
              {Math.round(eco)}
            </div>
            <div style={{ height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${eco}%`, height: "100%", background: eco < 35 ? "#c05050" : eco >= 55 ? "#5a8a6a" : "#c8a857" }} />
            </div>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11, color: "#a8a294", marginBottom: 2 }}>{t("treasury.nominal_gdp")}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700, color: "#cdd3e0" }}>
              ₽{nominalGdpRubT.toFixed(0)} {t("treasury.trillion")}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#8a8472" }}>${nominalGdpUsdT.toFixed(2)} {t("treasury.trillion")}</div>
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11, color: "#a8a294", marginBottom: 2 }}>{statLabel("gdp_growth", "Рост ВВП")}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700, color: gdpGrowthT < 36 ? "#c05050" : gdpGrowthT > 36 ? "#5a8a6a" : "#c8a857" }}>
              {formatSubstatValue("gdp_growth", gdpGrowthT)} <span style={{ fontSize: 10, fontWeight: 400 }}>{t("treasury.gdp_growth_yoy")}</span>
            </div>
            <div style={{ height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${gdpGrowthT}%`, height: "100%", background: gdpGrowthT < 36 ? "#c05050" : gdpGrowthT > 36 ? "#5a8a6a" : "#c8a857" }} />
            </div>
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11, color: "#a8a294", marginBottom: 2 }}>{statLabel("employment", "Занятость")}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700, color: employmentT < 74 ? "#c05050" : employmentT > 74 ? "#5a8a6a" : "#c8a857" }}>
              {formatSubstatValue("employment", employmentT)}
            </div>
            <div style={{ height: 4, background: "#2a3040", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${employmentT}%`, height: "100%", background: employmentT < 74 ? "#c05050" : employmentT > 74 ? "#5a8a6a" : "#c8a857" }} />
            </div>
          </div>
        </div>
        {gdpGrowthEvents.length > 0 && (
          <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 4, padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.1em", color: "#8a8472", marginBottom: 4 }}>{t("treasury.last_gdp_contribution")}</div>
            <div className="doc-font" style={{ fontSize: 10.5, color: "#8a8472", marginBottom: 6, lineHeight: 1.3 }}>
              {t("treasury.gdp_growth_note")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {gdpGrowthEvents.map((ev, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                  <span style={{ color: "#a8a294" }}>{t("treasury.turn_short")} {ev.turn} · {actionTypeLabel(ev.actionType, ACTION_TYPE_LABEL[ev.actionType] || ev.actionType)}</span>
                  <span style={{ color: ev.delta >= 0 ? "#5a8a6a" : "#c05050", fontWeight: 700 }}>{ev.delta >= 0 ? "+" : ""}{ev.delta}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <EndMonthForecastPanel stats={stats} policies={state.policies} />
      </WidgetCard>

      {/* Баланс: доходы и расходы — очки + рублёвый эквивалент тем же курсом T, что и казна/
          резервы (см. TREASURY_PER_TRILLION) — раньше строки были только в абстрактных очках. */}
      <WidgetCard {...widgetCardProps("balance")} label={t("treasury.w.balance_title")}>
        <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 4 }}>
          <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
            <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#5a8a6a" }}>{t("treasury.tax_income", { eco: Math.round(eco) })}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#5a8a6a", fontWeight: 700 }}>+{economyIncome} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(economyIncome * T).toFixed(1)} {t("treasury.trillion")})</span></span>
          </div>
          {taxIncome > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#5a8a6a" }}>{t("treasury.tax_policies")}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#5a8a6a", fontWeight: 700 }}>+{taxIncome} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(taxIncome * T).toFixed(1)} {t("treasury.trillion")})</span></span>
            </div>
          )}
          {programUpkeep > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#c05050" }}>{t("treasury.program_upkeep", { n: activePolicies.length })}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#c05050", fontWeight: 700 }}>−{programUpkeep} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(programUpkeep * T).toFixed(1)} {t("treasury.trillion")})</span></span>
            </div>
          )}
          {(oilIncomeT !== 0 || fxIncomeT !== 0) && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: (oilIncomeT + fxIncomeT) >= 0 ? "#5a8a6a" : "#c05050" }}>
                {(oilIncomeT + fxIncomeT) >= 0 ? "+" : "−"} {t("treasury.oil_fx_row", { oil: oilPriceT.toFixed(0), fx: usdRubT.toFixed(0) })}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: (oilIncomeT + fxIncomeT) >= 0 ? "#5a8a6a" : "#c05050", fontWeight: 700 }}>
                {(oilIncomeT + fxIncomeT) >= 0 ? "+" : ""}{oilIncomeT + fxIncomeT} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈{(oilIncomeT + fxIncomeT) >= 0 ? "+" : ""}₽{((oilIncomeT + fxIncomeT) * T).toFixed(1)} {t("treasury.trillion")})</span>
              </span>
            </div>
          )}
          {ofzDebt > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#c05050" }}>{t("treasury.ofz_service", { n: ofzCount })}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#c05050", fontWeight: 700 }}>−{ofzDebt} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(ofzDebt * T).toFixed(1)} {t("treasury.trillion")})</span></span>
            </div>
          )}
          {corruptionDrainT > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#c05050" }}>{t("treasury.corruption_loss", { score: Math.round(corrLevelT), cpi: corruptionCpiEquivalent(corrLevelT) })}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#c05050", fontWeight: 700 }}>−{corruptionDrainT} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(corruptionDrainT * T).toFixed(1)} {t("treasury.trillion")})</span></span>
            </div>
          )}
          {territoryUpkeepT > 0 && (
            <div style={{ ...rowStyle, padding: "7px 12px", borderBottom: "1px solid #2a3040" }}>
              <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#c05050" }}>{t("treasury.territory_upkeep")}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#c05050", fontWeight: 700 }}>−{territoryUpkeepT} <span style={{ fontSize: 9, fontWeight: 400 }}>(≈₽{(territoryUpkeepT * T).toFixed(1)} {t("treasury.trillion")})</span></span>
            </div>
          )}
          <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#a8a294", letterSpacing: "0.06em" }}>{t("treasury.total")}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: projectedNet >= 0 ? "#5a8a6a" : "#c05050" }}>
              {projectedNet >= 0 ? "+" : ""}{projectedNet} {t("treasury.points_per_month")} <span style={{ fontSize: 10, fontWeight: 400 }}>(≈{projectedNet >= 0 ? "+" : ""}₽{(projectedNet * T).toFixed(1)} {t("treasury.trillion")})</span>
            </span>
          </div>
        </div>
      </WidgetCard>

      {/* ОФЗ: долговые инструменты */}
      <WidgetCard {...widgetCardProps("ofz")} label={t("treasury.w.ofz_title")}>
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
                {i < ofzCount ? t("treasury.ofz_bond", { n: i + 1 }) : "—"}
              </div>
            ))}
          </div>
          {ofzCount > 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c08050", marginBottom: 10 }}>
              {t("treasury.ofz_active_summary", { count: ofzCount, max: OFZ_MAX, debt: ofzDebt, rub: (ofzDebt * T).toFixed(1), pressure: Math.round(ofzCount * 0.3 * 10) / 10 })}
            </div>
          )}
          {ofzCount === 0 && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#3a5050", marginBottom: 10 }}>
              {t("treasury.ofz_none")}
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
              {loading === "issue" ? t("treasury.ofz_issuing") : ofzUsedThisMonth ? t("treasury.ofz_used") : ofzCount >= OFZ_MAX ? t("treasury.ofz_limit") : t("treasury.ofz_issue_btn")}
            </button>
            <button
              onClick={handleRepay}
              disabled={ofzCount <= 0 || treasury < 22 || loading === "repay"}
              style={{
                flex: 1, background: ofzCount <= 0 || treasury < 22 ? "#1a2030" : "#1a1a2a",
                border: `1px solid ${ofzCount <= 0 || treasury < 22 ? "#2a3040" : "#3a3a5a"}`,
                color: ofzCount <= 0 || treasury < 22 ? "#3a4050" : "#7080b0",
                borderRadius: 4, padding: "9px 12px",
                fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: ofzCount <= 0 || treasury < 22 ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
            >
              {loading === "repay" ? t("treasury.ofz_repaying") : t("treasury.ofz_repay_btn")}
            </button>
          </div>
          {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
        </div>
      </WidgetCard>

      {/* Ключевая ставка ЦБ */}
      {(() => {
        const keyRate = stats.key_rate ?? 18.5;
        const cbHead = stats.cb_head_type ?? "neutral";
        const cbReplaced = !!stats.cb_replaced;
        const cbPressureUsed = !!stats.cb_pressure_used;
        const initiative = stats.initiative ?? 100;

        const rateColor = keyRate > 17 ? "#4a7a5a" : keyRate > 13 ? "#9c8347" : "#c05030";
        const headLabel = cbHead === "soft" ? t("treasury.cb_dove") : cbHead === "hawkish" ? t("treasury.cb_hawk") : t("treasury.cb_neutral");
        const headColor = cbHead === "soft" ? "#c89060" : cbHead === "hawkish" ? "#4a7a9a" : "#8a8472";

        // Эффект ставки
        const rateEffect = keyRate > 17
          ? { inf: t("treasury.pressure_minus"), eco: t("treasury.economy_minus"), color: "#4a7a5a" }
          : keyRate < 11
          ? { inf: t("treasury.pressure_plus"), eco: t("treasury.economy_plus"), color: "#c05030" }
          : { inf: t("treasury.neutral_lower"), eco: t("treasury.neutral_lower"), color: "#8a8472" };

        // Целевое значение (то же что в бэкенде)
        const inf_ = stats.inflation ?? 64;
        const baseTarget = inf_ > 70 ? 21 : inf_ > 60 ? 18 : inf_ < 50 ? 13 : 16;
        const cbTarget = cbHead === "soft" ? baseTarget - 3 : cbHead === "hawkish" ? baseTarget + 2 : baseTarget;
        const rateTrend = keyRate < cbTarget ? t("treasury.trend_rising") : keyRate > cbTarget + 0.5 ? t("treasury.trend_falling") : t("treasury.trend_stable");

        return (
          <WidgetCard {...widgetCardProps("keyrate")} label={t("treasury.w.keyrate_title")}>
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 16px" }}>

              {/* Текущая ставка */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: rateColor, lineHeight: 1 }}>
                    {keyRate.toFixed(1)}%
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", marginTop: 3 }}>
                    {rateTrend} · {t("treasury.cb_target", { target: Math.max(5, Math.min(25, cbTarget)).toFixed(0) })}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: headColor, marginBottom: 3 }}>
                    {t("treasury.cb_head_label", { head: headLabel })}
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: rateEffect.color }}>
                      {t("treasury.inflation_short", { v: rateEffect.inf })}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: rateEffect.color }}>
                      {t("treasury.economy_short", { v: rateEffect.eco })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Шкала 5–25% */}
              <div style={{ position: "relative", height: 6, background: "#1a2030", borderRadius: 3, marginBottom: 14 }}>
                <div style={{ position: "absolute", left: `${(keyRate - 5) / 20 * 100}%`, top: -3, width: 12, height: 12, borderRadius: "50%", background: rateColor, transform: "translateX(-50%)", border: "2px solid #14181f" }} />
                <div style={{ position: "absolute", left: `${(17 - 5) / 20 * 100}%`, top: 0, width: 1, height: "100%", background: "#4a7a5a44" }} />
                <div style={{ position: "absolute", left: `${(11 - 5) / 20 * 100}%`, top: 0, width: 1, height: "100%", background: "#c0503044" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: "#3a4050", marginBottom: 14 }}>
                <span>{t("treasury.rate_scale_stimulus")}</span><span>11%</span><span>17%</span><span>{t("treasury.rate_scale_hard")}</span>
              </div>

              {/* Действие А: давление */}
              <div style={{ borderTop: "1px solid #2a3040", paddingTop: 12, marginBottom: 10 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 8 }}>
                  {t("treasury.cb_pressure_label")}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleCbPressure("raise")}
                    disabled={cbPressureUsed || initiative < 25 || loading === "cb_pressure_raise"}
                    style={{
                      flex: 1, background: cbPressureUsed || initiative < 25 ? "#1a2030" : "#0e1a10",
                      border: `1px solid ${cbPressureUsed || initiative < 25 ? "#2a3040" : "#3a6a3a"}`,
                      color: cbPressureUsed || initiative < 25 ? "#3a4050" : "#6a9a6a",
                      borderRadius: 3, padding: "8px 10px",
                      fontFamily: "'PT Serif',serif", fontSize: 12, cursor: cbPressureUsed || initiative < 25 ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading === "cb_pressure_raise" ? "…" : t("treasury.keyrate_raise_btn")}
                  </button>
                  <button
                    onClick={() => handleCbPressure("lower")}
                    disabled={cbPressureUsed || initiative < 25 || loading === "cb_pressure_lower"}
                    style={{
                      flex: 1, background: cbPressureUsed || initiative < 25 ? "#1a2030" : "#1a0e0a",
                      border: `1px solid ${cbPressureUsed || initiative < 25 ? "#2a3040" : "#6a3a20"}`,
                      color: cbPressureUsed || initiative < 25 ? "#3a4050" : "#c08050",
                      borderRadius: 3, padding: "8px 10px",
                      fontFamily: "'PT Serif',serif", fontSize: 12, cursor: cbPressureUsed || initiative < 25 ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading === "cb_pressure_lower" ? "…" : t("treasury.keyrate_lower_btn")}
                  </button>
                </div>
                {cbPressureUsed && (
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#5a6070", marginTop: 5 }}>
                    {t("treasury.cb_pressure_used_note")}
                  </div>
                )}
              </div>

              {/* Действие В: смена главы */}
              <div style={{ borderTop: "1px solid #2a3040", paddingTop: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: cbReplaced ? "#3a4050" : "#5a6070", letterSpacing: "0.08em", marginBottom: 8 }}>
                  {t("treasury.cb_replace_label", { status: cbReplaced ? t("treasury.already_used") : t("treasury.once_per_game") })}
                </div>
                {!cbReplaced ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleCbReplace("hawkish")}
                      disabled={cbReplaced || initiative < 40 || loading === "cb_replace"}
                      style={{
                        flex: 1, background: cbReplaced || initiative < 40 ? "#1a2030" : "#0a1020",
                        border: `1px solid ${cbReplaced || initiative < 40 ? "#2a3040" : "#3a5a8a"}`,
                        color: cbReplaced || initiative < 40 ? "#3a4050" : "#6a9aca",
                        borderRadius: 3, padding: "8px 10px",
                        fontFamily: "'PT Serif',serif", fontSize: 12, cursor: cbReplaced || initiative < 40 ? "not-allowed" : "pointer",
                        lineHeight: 1.3,
                      }}
                    >
                      {loading === "cb_replace" ? "…" : t("treasury.hawk_btn")}
                    </button>
                    <button
                      onClick={() => handleCbReplace("soft")}
                      disabled={cbReplaced || initiative < 40 || loading === "cb_replace"}
                      style={{
                        flex: 1, background: cbReplaced || initiative < 40 ? "#1a2030" : "#1a1205",
                        border: `1px solid ${cbReplaced || initiative < 40 ? "#2a3040" : "#8a6020"}`,
                        color: cbReplaced || initiative < 40 ? "#3a4050" : "#c09050",
                        borderRadius: 3, padding: "8px 10px",
                        fontFamily: "'PT Serif',serif", fontSize: 12, cursor: cbReplaced || initiative < 40 ? "not-allowed" : "pointer",
                        lineHeight: 1.3,
                      }}
                    >
                      {loading === "cb_replace" ? "…" : t("treasury.dove_btn")}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: headColor }}>
                    {t("treasury.cb_current_head", { head: headLabel })}
                  </div>
                )}
              </div>

              {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
            </div>
          </WidgetCard>
        );
      })()}

      {/* Коррупция */}
      {(() => {
        const corrLevel = stats.corruption ?? 68;
        const corrColor = corrLevel > 75 ? "#c03030" : corrLevel > 50 ? "#9c8347" : "#4a7a5a";
        const initiative = stats.initiative ?? 100;
        const canAfford = !anticorruptionUsed && initiative >= 35 && treasury >= 8;
        const corrCpi = corruptionCpiEquivalent(corrLevel);
        const corrDrainRubT = corruptionDrainRubTrillion(corruptionDrainT);
        return (
          <WidgetCard {...widgetCardProps("corruption")} label={t("treasury.w.corruption_title")}>
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: corrColor, lineHeight: 1 }}>
                    CPI {corrCpi}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", marginTop: 3 }}>
                    {t("treasury.cpi_desc", { risk: corrLevel > 65 ? t("treasury.corruption_high_risk") : corrLevel > 50 ? t("treasury.corruption_leak") : t("treasury.corruption_controlled") })}
                  </div>
                  {/* БАЛАНС (2026-07-04): CPI — реалистичная оценка (сжатый диапазон 10-46), НЕ доля
                      шкалы ниже — та рисуется от внутреннего балла тяжести (corrLevel, 0-100).
                      Раньше рядом с баром на полшкалы стояло «26/100», выглядело как рассинхрон.
                      Игрок также запутался в направлении CPI (выше/ниже — лучше?) — уточнили явно
                      выше. Внутренний балл ниже — обратная логика (выше = хуже), поэтому оба числа
                      растут/падают в ПРОТИВОПОЛОЖНЫЕ стороны при одном и том же изменении коррупции. */}
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#3a4050", marginTop: 1 }}>
                    {t("treasury.corruption_internal", { score: Math.round(corrLevel) })}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#8a8472", marginBottom: 3 }}>
                    {t("treasury.monthly_leak")}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: corruptionDrainT > 0 ? "#c05050" : "#5a8a6a" }}>
                    {corruptionDrainT > 0 ? t("treasury.corruption_drain_amount", { n: corrDrainRubT.toFixed(1) }) : t("treasury.corruption_drain_none")}
                  </div>
                </div>
              </div>

              <div style={{ height: 6, background: "#1a2030", borderRadius: 3, marginBottom: 14, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${corrLevel}%`, background: corrColor, borderRadius: 3, transition: "width 0.4s" }} />
              </div>

              <div style={{ borderTop: "1px solid #2a3040", paddingTop: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 8 }}>
                  {t("treasury.anticorruption_label")}
                </div>
                <button
                  onClick={handleAntiCorruption}
                  disabled={!canAfford || loading === "anticorruption"}
                  style={{
                    width: "100%", background: !canAfford ? "#1a2030" : "#1a1208",
                    border: `1px solid ${!canAfford ? "#2a3040" : "#8a6020"}`,
                    color: !canAfford ? "#3a4050" : "#c09050",
                    borderRadius: 3, padding: "9px 12px",
                    fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: !canAfford ? "not-allowed" : "pointer",
                    textAlign: "left",
                  }}
                >
                  {loading === "anticorruption" ? t("treasury.campaign_running") : anticorruptionUsed ? t("treasury.campaign_used") : t("treasury.campaign_btn")}
                </button>
                {anticorruptionUsed && (
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#5a6070", marginTop: 5 }}>
                    {t("treasury.campaign_used_note")}
                  </div>
                )}
              </div>

              {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
            </div>
          </WidgetCard>
        );
      })()}

      {/* Резервы (ФНБ) */}
      {(() => {
        const reservesNow = stats.reserves ?? 48;
        const reservesConverted = !!stats.reserves_converted_this_month;
        const RESERVES_CONVERT_AMOUNT_T = 10, RESERVES_CONVERT_MIN_LEFT_T = 15;
        const initiativeR = stats.initiative ?? 100;
        const canConvert = !reservesConverted && initiativeR >= 20 && reservesNow - RESERVES_CONVERT_AMOUNT_T >= RESERVES_CONVERT_MIN_LEFT_T;
        const reservesColor = reservesNow < 20 ? "#c03030" : reservesNow < 35 ? "#9c8347" : "#4a7a5a";
        const reservesRubT = reservesRubTrillion(reservesNow);
        const reservesUsdB = reservesUsdBillion(reservesRubT, usdRubT);
        const convertRubT = reservesRubTrillion(RESERVES_CONVERT_AMOUNT_T);
        const floorRubT = reservesRubTrillion(RESERVES_CONVERT_MIN_LEFT_T);
        const headroomRubT = Math.max(0, reservesRubT - floorRubT);
        return (
          <React.Fragment>
          <WidgetCard {...widgetCardProps("reserves")} label={t("treasury.w.reserves_title")}>
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: reservesColor, lineHeight: 1 }}>
                    ₽{reservesRubT.toFixed(1)} {t("treasury.trillion")}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", marginTop: 3 }}>
                    ≈${reservesUsdB.toFixed(0)} млрд · {reservesNow < 20 ? t("treasury.reserves_none") : reservesNow < 35 ? t("treasury.reserves_thin") : t("treasury.reserves_solid")}
                  </div>
                </div>
              </div>

              <div style={{ height: 6, background: "#1a2030", borderRadius: 3, marginBottom: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${reservesNow}%`, background: reservesColor, borderRadius: 3, transition: "width 0.4s" }} />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", marginBottom: 14 }}>
                {t("treasury.reserves_headroom", { headroom: headroomRubT.toFixed(1), floor: floorRubT.toFixed(1) })}
              </div>

              <div style={{ borderTop: "1px solid #2a3040", paddingTop: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#5a6070", letterSpacing: "0.08em", marginBottom: 8 }}>
                  {t("treasury.convert_label", { amount: convertRubT.toFixed(1) })}
                </div>
                <button
                  onClick={() => setConfirmReserves(true)}
                  disabled={!canConvert || loading === "convert_reserves"}
                  style={{
                    width: "100%", background: !canConvert ? "#1a2030" : "#1a1208",
                    border: `1px solid ${!canConvert ? "#2a3040" : "#8a6020"}`,
                    color: !canConvert ? "#3a4050" : "#c09050",
                    borderRadius: 3, padding: "9px 12px",
                    fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: !canConvert ? "not-allowed" : "pointer",
                    textAlign: "left",
                  }}
                >
                  {loading === "convert_reserves" ? t("treasury.convert_running") : reservesConverted ? t("treasury.convert_used") : t("treasury.convert_btn", { amount: convertRubT.toFixed(1) })}
                </button>
                {!reservesConverted && reservesNow - RESERVES_CONVERT_AMOUNT_T < RESERVES_CONVERT_MIN_LEFT_T && (
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#5a6070", marginTop: 5 }}>
                    {t("treasury.reserves_floor_note", { floor: floorRubT.toFixed(1) })}
                  </div>
                )}
              </div>

              {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
            </div>
          </WidgetCard>

            {confirmReserves && (
              <div onClick={() => setConfirmReserves(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                <div onClick={e => e.stopPropagation()} style={{ background: "#1a1f2c", border: "1px solid #3a4156", borderRadius: 6, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
                  <div style={{ background: "#14181f", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>{t("treasury.reserves_confirm_title")}</span>
                    <button onClick={() => setConfirmReserves(false)} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ fontFamily: "'PT Serif',serif", fontSize: 14, color: "#cdd3e0", lineHeight: 1.5, marginBottom: 14 }}>
                      {t("treasury.reserves_confirm_body", { amount: convertRubT.toFixed(1) })}
                    </div>
                    <div style={{ background: "#2a1f14", border: "1px solid #5a4520", borderRadius: 4, padding: "10px 12px", marginBottom: 16 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#c8a857", letterSpacing: "0.06em", marginBottom: 6 }}>{t("treasury.consequences")}</div>
                      <div style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#d8b890", lineHeight: 1.6 }}>
                        {t("treasury.reserves_consequence_1")}<br/>
                        {t("treasury.reserves_consequence_2", { amount: convertRubT.toFixed(1) })}<br/>
                        {t("treasury.reserves_consequence_3", { amount: convertRubT.toFixed(1), left: (reservesRubT - convertRubT).toFixed(1) })}<br/>
                        {t("treasury.reserves_consequence_4")}<br/>
                        {t("treasury.reserves_consequence_5")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setConfirmReserves(false)}
                        style={{ background: "none", border: "1px solid #3a4156", color: "#a8a294", borderRadius: 3, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}
                      >
                        {t("treasury.btn_cancel")}
                      </button>
                      <button
                        onClick={() => { setConfirmReserves(false); handleConvertReserves(); }}
                        style={{ background: "#1a1208", border: "1px solid #8a6020", color: "#c09050", borderRadius: 3, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}
                      >
                        {t("treasury.btn_convert_confirm")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })()}

      {/* Курсовая политика (Петя, 2026-07-05: "отпустить курс рубля" — рядом с ФНБ, т.к. резерв его и регулирует) */}
      {(() => {
        const floating = !!stats.fx_floating;
        const initiativeF = stats.initiative ?? 100;
        const canToggle = initiativeF >= 15;
        return (
          <React.Fragment>
          <WidgetCard {...widgetCardProps("fxregime")} label={t("treasury.w.fxregime_title")}>
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'PT Serif',serif", fontSize: 14, color: "#ece7d8" }}>
                    {floating ? t("treasury.fx_floating_label") : t("treasury.fx_managed_label")}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#5a6070", marginTop: 3, maxWidth: 340 }}>
                    {floating ? t("treasury.fx_floating_desc") : t("treasury.fx_managed_desc")}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setConfirmFxRegime(true)}
                disabled={!canToggle || loading === "fx_regime"}
                style={{
                  width: "100%", background: !canToggle ? "#1a2030" : floating ? "#1a2030" : "#1a1208",
                  border: `1px solid ${!canToggle ? "#2a3040" : floating ? "#3a5070" : "#8a6020"}`,
                  color: !canToggle ? "#3a4050" : floating ? "#7a9ec0" : "#c09050",
                  borderRadius: 3, padding: "9px 12px",
                  fontFamily: "'PT Serif',serif", fontSize: 12.5, cursor: !canToggle ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                {loading === "fx_regime" ? t("treasury.fx_switching") : floating ? t("treasury.fx_to_managed_btn") : t("treasury.fx_to_floating_btn")}
              </button>
              {!canToggle && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#5a6070", marginTop: 5 }}>
                  {t("treasury.fx_not_enough")}
                </div>
              )}
              {error && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#e09090", marginTop: 8 }}>{error}</div>}
            </div>
          </WidgetCard>

            {confirmFxRegime && (
              <div onClick={() => setConfirmFxRegime(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                <div onClick={e => e.stopPropagation()} style={{ background: "#1a1f2c", border: "1px solid #3a4156", borderRadius: 6, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
                  <div style={{ background: "#14181f", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="mono-font" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#9c8347" }}>{t("treasury.fx_confirm_title")}</span>
                    <button onClick={() => setConfirmFxRegime(false)} style={{ background: "none", border: "none", color: "#a8a294", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ fontFamily: "'PT Serif',serif", fontSize: 14, color: "#cdd3e0", lineHeight: 1.5, marginBottom: 14 }}>
                      {floating ? t("treasury.fx_confirm_to_managed") : t("treasury.fx_confirm_to_floating")}
                    </div>
                    <div style={{ background: "#2a1f14", border: "1px solid #5a4520", borderRadius: 4, padding: "10px 12px", marginBottom: 16 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#c8a857", letterSpacing: "0.06em", marginBottom: 6 }}>{t("treasury.consequences")}</div>
                      <div style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: "#d8b890", lineHeight: 1.6 }}>
                        {t("treasury.fx_consequence_intro")}<br/>
                        {floating
                          ? <>{t("treasury.fx_consequence_managed_1")}<br/>{t("treasury.fx_consequence_managed_2")}<br/>{t("treasury.fx_consequence_managed_3")}</>
                          : <>{t("treasury.fx_consequence_floating_1")}<br/>{t("treasury.fx_consequence_floating_2")}<br/>{t("treasury.fx_consequence_floating_3")}</>}
                        <br/>{t("treasury.fx_consequence_footer")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setConfirmFxRegime(false)}
                        style={{ background: "none", border: "1px solid #3a4156", color: "#a8a294", borderRadius: 3, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}
                      >
                        {t("treasury.btn_cancel")}
                      </button>
                      <button
                        onClick={() => { setConfirmFxRegime(false); handleToggleFxRegime(); }}
                        style={{ background: "#1a1208", border: "1px solid #8a6020", color: "#c09050", borderRadius: 3, padding: "8px 16px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}
                      >
                        {floating ? t("treasury.fx_confirm_btn_managed") : t("treasury.fx_confirm_btn_float")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })()}

      {/* Инфляция */}
      {(() => {
        const inf = stats.inflation ?? 64;
        const infColor = inf > 80 ? "#c03030" : inf > 70 ? "#b05020" : inf > 60 ? "#9c8347" : "#4a7a5a";
        const ecoP = inf > 70 ? Math.min(3, Math.floor((inf - 70) / 10) + 1) : 0;
        const appP = inf > 70 ? Math.min(2, Math.floor((inf - 70) / 15) + 1) : 0;
        const pct = inflationPercent(inf);
        const stormPct = inflationPercent(70); // порог штрафов в человеческом %
        return (
          <WidgetCard {...widgetCardProps("inflation")} label={t("treasury.w.inflation_title")}>
            <div style={{ background: inf > 70 ? "#1a0c08" : "#14181f", border: `1px solid ${inf > 70 ? "#7a3020" : "#2a3040"}`, borderRadius: 4, padding: "12px 14px" }}>
              {/* Значение + бар */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: "'PT Serif',serif", fontSize: 13, color: inf > 70 ? "#e0c0a0" : "#ece7d8" }}>{t("treasury.inflation_label")}</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: infColor }}>
                    {pct.toFixed(1)}%
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#8a8472" }}>
                    {t("treasury.inflation_yoy_pressure", { n: Math.round(inf) })}
                  </span>
                </span>
              </div>
              <div style={{ height: 8, background: inf > 70 ? "#2a1510" : "#1a2030", borderRadius: 4, overflow: "hidden", marginBottom: 10, position: "relative" }}>
                <div style={{ height: "100%", width: `${inflationBarFraction(inf)}%`, background: infColor, borderRadius: 4, transition: "width 0.4s" }} />
                {/* порог 70 (балл) — маркер на той же %-шкале, что и бар */}
                <div style={{ position: "absolute", top: 0, left: `${inflationBarFraction(70)}%`, width: 1, height: "100%", background: "#c03030", opacity: 0.6 }} />
              </div>
              {/* Строки штрафов */}
              {ecoP > 0 ? (
                <div style={{ background: inf > 70 ? "#200a06" : "#fff4f0", border: `1px solid ${inf > 80 ? "#8a2020" : "#c07040"}`, borderRadius: 3, padding: "6px 10px" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: inf > 80 ? "#e05050" : "#b05030", letterSpacing: "0.06em", marginBottom: 4 }}>
                    {t("treasury.inflation_storm", { pct: stormPct.toFixed(0) })}
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c04040" }}>
                      {t("treasury.economy_penalty", { n: ecoP })}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#c04040" }}>
                      {t("treasury.approval_penalty", { n: appP })}
                    </span>
                  </div>
                  <div style={{ fontFamily: "'PT Serif',serif", fontSize: 11.5, color: inf > 70 ? "#c09080" : "#7a4030", marginTop: 5, lineHeight: 1.4 }}>
                    {t("treasury.inflation_advice")}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#7aa080" }}>
                  {t("treasury.inflation_ok", { pct: stormPct.toFixed(0) })}
                </div>
              )}
              {/* ОФЗ-вклад */}
              {ofzCount > 0 && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#c08050", marginTop: 8, borderTop: `1px solid ${inf > 70 ? "#3a2010" : "#2a3040"}`, paddingTop: 6 }}>
                  {t("treasury.ofz_inflation_contribution", { n: Math.round(ofzCount * 0.3 * 10) / 10 })}
                </div>
              )}
            </div>
          </WidgetCard>
        );
      })()}

      {/* Нефть и валюта */}
      {(() => {
        const OIL_CURRENT_FALLBACK = 85, FX_BASELINE = 80; // фолбэк на случай отсутствия oil_price
        const OIL_BUDGET_CUTOFF = 65; // цена отсечения бюджета — база для oilIncome (см. turns.js)
        const oilPrice = stats.oil_price ?? OIL_CURRENT_FALLBACK;
        const usdRub = stats.usd_rub ?? FX_BASELINE;
        const isolationVal = stats.isolation ?? 68;
        const oilColor = oilPrice >= 80 ? "#4a7a5a" : oilPrice >= 55 ? "#9c8347" : "#c03030";
        const fxColor = usdRub <= 75 ? "#4a7a5a" : usdRub <= 95 ? "#9c8347" : "#c03030";

        // Та же формула, что в бэкенде
        const rawSanctionDiscount = isolationVal <= 50 ? 0
          : isolationVal <= 80 ? (isolationVal - 50) / 100
          : 0.30 + (isolationVal - 80) / 200;
        const allyTrustVal = stats.ally_trust ?? 42;
        const allyMitigation = allyTrustVal > 50 ? Math.min(0.15, (allyTrustVal - 50) / 100) : 0;
        const sanctionDiscount = Math.max(0, rawSanctionDiscount - allyMitigation);
        const oilIncome = Math.round((oilPrice - OIL_BUDGET_CUTOFF) * 0.7 * (1 - sanctionDiscount));
        const fxIncome = Math.round((usdRub - FX_BASELINE) * 0.4);
        const totalOilFx = oilIncome + fxIncome;

        const discountPct = Math.round(rawSanctionDiscount * 100);
        const mitigationPct = Math.round(allyMitigation * 100);
        const discountColor = discountPct === 0 ? "#5a7050" : discountPct < 20 ? "#9c8347" : "#c05030";

        const [showOilAdvice, setShowOilAdvice] = React.useState(false);

        return (
          <WidgetCard {...widgetCardProps("oilfx")} label={t("treasury.w.oilfx_title")}>

            {/* Котировки */}
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 4, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'PT Serif',serif", fontSize: 12, color: "#a8a294", marginBottom: 3 }}>{t("treasury.oil_brent")}</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: oilColor }}>
                    ${oilPrice.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, color: "#8a8472" }}>{t("treasury.oil_per_barrel")}</span>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#8a8472", marginTop: 2 }}>
                    {t("treasury.oil_cutoff", { cutoff: OIL_BUDGET_CUTOFF, v: oilPrice >= OIL_BUDGET_CUTOFF ? t("treasury.oil_surplus", { n: `+${(oilPrice - OIL_BUDGET_CUTOFF).toFixed(1)}` }) : t("treasury.oil_shortfall", { n: (oilPrice - OIL_BUDGET_CUTOFF).toFixed(1) }) })}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'PT Serif',serif", fontSize: 12, color: "#a8a294", marginBottom: 3 }}>{t("treasury.fx_rate_label")}</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: fxColor }}>
                    ₽{usdRub.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, color: "#8a8472" }}>/$</span>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "#8a8472", marginTop: 2 }}>
                    {t("treasury.fx_base", { base: FX_BASELINE, v: usdRub > FX_BASELINE ? t("treasury.weak_ruble_note") : t("treasury.strong_ruble_note") })}
                  </div>
                </div>
              </div>

              {/* Расчёт нефтедохода */}
              <div style={{ borderTop: "1px solid #2a3040", paddingTop: 10 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.1em", color: "#8a8472", marginBottom: 6 }}>{t("treasury.oil_income_calc_title")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                    <span style={{ color: "#a8a294" }}>{t("treasury.oil_income_formula")}</span>
                    <span style={{ color: oilIncome >= 0 ? "#5a8a6a" : "#c05050", fontWeight: 700 }}>{oilIncome >= 0 ? "+" : ""}{oilIncome}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                    <span style={{ color: "#a8a294" }}>{t("treasury.fx_income_formula")}</span>
                    <span style={{ color: fxIncome >= 0 ? "#5a8a6a" : "#c05050", fontWeight: 700 }}>{fxIncome >= 0 ? "+" : ""}{fxIncome}</span>
                  </div>
                  {discountPct > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      <span style={{ color: discountColor }}>{t("treasury.sanction_discount", { n: Math.round(isolationVal) })}</span>
                      <span style={{ color: discountColor, fontWeight: 700 }}>−{discountPct}%</span>
                    </div>
                  )}
                  {mitigationPct > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      <span style={{ color: "#4a8c5a" }}>{t("treasury.ally_mitigation", { n: Math.round(allyTrustVal) })}</span>
                      <span style={{ color: "#4a8c5a", fontWeight: 700 }}>+{mitigationPct} {t("treasury.pp_suffix")}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, borderTop: "1px solid #2a3040", paddingTop: 5, marginTop: 2 }}>
                    <span style={{ color: "#ece7d8", fontWeight: 700 }}>{t("treasury.oil_fx_total")}</span>
                    <span style={{ color: totalOilFx >= 0 ? "#5a8a6a" : "#c05050", fontWeight: 700 }}>{totalOilFx >= 0 ? "+" : ""}{totalOilFx} {t("treasury.per_month")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Советы */}
            <div style={{ background: "#14181f", border: "1px solid #2a3040", borderRadius: 4 }}>
              <button
                onClick={() => setShowOilAdvice(v => !v)}
                style={{ width: "100%", background: "transparent", border: "none", padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              >
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: "0.1em", color: "#8a8472" }}>{t("treasury.how_to_increase_oil")}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#5a6070" }}>{showOilAdvice ? "▲" : "▼"}</span>
              </button>
              {showOilAdvice && (
                <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    {
                      label: t("treasury.lever.isolation.title"),
                      desc: t("treasury.lever.isolation.desc", { isolation: Math.round(isolationVal), discount: discountPct }),
                      consequence: t("treasury.lever.isolation.consequence"),
                      color: discountPct > 10 ? "#c89060" : "#4a7a5a",
                    },
                    {
                      label: t("treasury.lever.shadow_fleet.title"),
                      desc: t("treasury.lever.shadow_fleet.desc"),
                      consequence: t("treasury.lever.shadow_fleet.consequence"),
                      color: "#9c8347",
                    },
                    {
                      label: t("treasury.lever.weak_ruble.title"),
                      desc: t("treasury.lever.weak_ruble.desc", { rate: usdRub.toFixed(0) }),
                      consequence: t("treasury.lever.weak_ruble.consequence"),
                      color: usdRub < FX_BASELINE ? "#c89060" : "#5a7a5a",
                    },
                    {
                      label: t("treasury.lever.ally_trust.title"),
                      desc: t("treasury.lever.ally_trust.desc", { trust: Math.round(allyTrustVal), mitigation: mitigationPct }),
                      consequence: t("treasury.lever.ally_trust.consequence"),
                      color: allyTrustVal < 50 ? "#c89060" : "#4a8c5a",
                    },
                    {
                      label: t("treasury.lever.opec.title"),
                      desc: t("treasury.lever.opec.desc"),
                      consequence: t("treasury.lever.opec.consequence"),
                      color: "#9c8347",
                    },
                  ].map(({ label, desc, consequence, color }) => (
                    <div key={label} style={{ background: "#1a2030", borderRadius: 3, padding: "9px 12px", borderLeft: `3px solid ${color}` }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color, fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontFamily: "'PT Serif',serif", fontSize: 12, color: "#9a9484", lineHeight: 1.45, marginBottom: 4 }}>{desc}</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#7a6050" }}>⚠ {consequence}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </WidgetCard>
        );
      })()}
    </div>
  );
}

// Тикер нефть/курс — раньше жил только внутри NewsfeedTab («Лента»), но игрок читает
// «вкладку новостей» как «Обстановка» (там же LIVE-панель) и не видел его там вообще —
// вынесен в отдельный компонент, используется в ОБЕИХ вкладках (Петя, 2026-07-05).
function MarketTicker({ stats }) {
  const oilPrice = stats.oil_price ?? 85;
  const usdRub = stats.usd_rub ?? 80;
  const EUR_USD_RATE = 1.08; // фиксированный кросс-курс евро/доллар для отображения (в игре нет отдельной статы под евро)
  const eurRub = usdRub * EUR_USD_RATE;
  const oilTickerColor = oilPrice >= 80 ? "#4a7a5a" : oilPrice >= 55 ? "#9c8347" : "#c03030";
  const fxTickerColor = usdRub <= 75 ? "#4a7a5a" : usdRub <= 95 ? "#9c8347" : "#c03030";
  return (
    <div style={{
      display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center",
      background: "#14181f", border: "1px solid #2a3040", borderRadius: 4,
      padding: "8px 14px", marginBottom: 12,
    }}>
      <span className="mono-font" style={{ fontSize: 11, color: oilTickerColor }}>🛢 Brent ${oilPrice.toFixed(0)}</span>
      <span className="mono-font" style={{ fontSize: 11, color: fxTickerColor }}>$ {usdRub.toFixed(1)}₽</span>
      <span className="mono-font" style={{ fontSize: 11, color: fxTickerColor }}>€ {eurRub.toFixed(1)}₽</span>
      {stats.fx_floating && <span className="mono-font" style={{ fontSize: 9.5, color: "#7a9ec0" }}>{t("newsfeed.fx_floating")}</span>}
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

  const stats = state.stats || {};
  const marketTicker = <MarketTicker stats={stats} />;

  if (!state.newsfeed?.length) {
    return (
      <div>
        {marketTicker}
        <div className="doc-font" style={{ fontSize: 13, color: "#8a8472", fontStyle: "italic" }}>{t("newsfeed.empty")}</div>
      </div>
    );
  }
  const relMap = {};
  for (const r of (state.relations || [])) relMap[r.name] = r.value;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {marketTicker}
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

        const isWorldMove = item.type === "world_move";
        const stance = isWorldMove ? getWorldMoveStance(relMap, item.source) : null;
        const meta = isWorldMove ? WORLD_MOVE_STANCE_STYLE[stance] : (NEWSFEED_TYPE[item.type] || NEWSFEED_TYPE.news);
        const metaLabel = isWorldMove ? worldMoveStanceLabel(stance) : newsfeedTypeLabel(NEWSFEED_TYPE[item.type] ? item.type : "news");
        const analystNote = isWorldMove ? item.reactions?.[0] : null;
        const moveDelta = analystNote?.stat_delta || {};
        // Обычные "news"-события (антикоррупция/ЦБ/ОФЗ и т.п.) тоже могут нести структурированный
        // stat_delta (Петя, 2026-07-08: "по идее когда разворачиваешь — должна быть инфа о влиянии
        // на статистику" — раньше числа были зашиты только в прозу, без чипов). Хранится как одна
        // запись {stat_delta} внутри массива reactions — отфильтровываем её из списка КОММЕНТАРИЕВ,
        // чтобы не рендерить как пустой комментарий без user/text.
        const newsStatDelta = (!isWorldMove && Array.isArray(item.reactions))
          ? item.reactions.find(r => r.stat_delta)?.stat_delta
          : null;
        const comments = (!isWorldMove && Array.isArray(item.reactions))
          ? item.reactions.filter(r => !r.stat_delta)
          : [];
        return (
          <div key={i} style={{
            background: isWorldMove ? meta.bg : "#f5f1e6",
            border: `1px solid ${isWorldMove ? meta.border : "#d8d2bf"}`,
            borderRadius: 4, overflow: "hidden",
          }}>
            <div style={{ padding: "10px 13px", borderLeft: `3px solid ${meta.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span className="mono-font" style={{ fontSize: 9, letterSpacing: "0.08em", color: meta.color }}>
                  {meta.icon} {item.source.toUpperCase()} · {metaLabel}
                </span>
                <span className="mono-font" style={{ fontSize: 9, color: isWorldMove ? meta.toggle : "#8a8472" }}>{t("world.turn_short")} {item.turn}</span>
              </div>
              <ExpandableText
                text={item.text}
                className="doc-font"
                style={{ fontSize: 13.5, lineHeight: 1.45, color: isWorldMove ? meta.text : "#3a362e" }}
                toggleColor={isWorldMove ? meta.toggle : "#8a8472"}
              />
              {isWorldMove && <StatDeltaBadges delta={moveDelta} />}
              {!isWorldMove && newsStatDelta && Object.keys(newsStatDelta).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  {Object.entries(newsStatDelta).filter(([, d]) => d !== 0).map(([stat, delta]) => (
                    <LogDeltaChip key={stat} stat={stat} delta={delta} />
                  ))}
                </div>
              )}
            </div>
            {!isWorldMove && comments.length > 0 && (
              <div style={{ background: "#ebe5d4", padding: "8px 13px 10px" }}>
                <div className="mono-font" style={{ fontSize: 9, color: "#8a8472", marginBottom: 6, letterSpacing: "0.05em" }}>{t("newsfeed.comments")}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {comments.map((r, j) => (
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
              // БАГ (Петя, 2026-07-07, "тут вроде положительная новость, а цвет красный"):
              // фон/цвета тут раньше были жёстко зашиты под "враждебную" стойку (тёмно-красный),
              // хотя реальная стойка источника (cooperative/neutral/hostile) уже посчитана выше
              // в meta и красит остальную карточку — просто этот блок её игнорировал. Теперь
              // берём цвета из meta, как и всё остальное в карточке.
              <div style={{ background: "rgba(0,0,0,0.22)", padding: "7px 13px 10px", borderTop: `1px solid ${meta.border}` }}>
                <div className="mono-font" style={{ fontSize: 9, color: meta.color, marginBottom: 4, letterSpacing: "0.05em" }}>{t("newsfeed.analyst_note")}</div>
                <div className="doc-font" style={{ fontSize: 12.5, color: meta.text, lineHeight: 1.4 }}>{analystNote.text}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Чип дельты стата на СВЕТЛОМ фоне (кремовые карточки "news" в Ленте, #f5f1e6/#ece7d8) — своя пара
// цветов, не renderStatDeltaCompact/deltaColor (те рассчитаны на тёмные карточки превью/результатов
// хода — там же прямой текст без фоновой плашки даёт контраст ~2:1 на пергаментном фоне, практически
// нечитаемо). Пара красный/зелёный + светлая плашка под цвет.
function LogDeltaChip({ stat, delta }) {
  const bad = INVERTED_STATS.has(stat) ? delta > 0 : delta < 0;
  const bg = delta === 0 ? "#eee6d0" : bad ? "#fde8e8" : "#e8f5e8";
  const color = delta === 0 ? "#8a8472" : bad ? "#a8313a" : "#4a6b5c";
  return (
    <span className="mono-font" style={{ fontSize: 10.5, background: bg, color, borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>
      {statLabel(stat, ALL_STAT_LABELS[stat] ?? stat)} {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}

// Чип дельты стата на ТЁМНОМ фоне Журнала — сплошные светлые плашки LogDeltaChip выше на тёмном
// фоне выглядели "вырвиглазно" (Петя, 2026-07-08): десяток+ ярких пастельных пилюль разом, без
// иерархии. Приглушённая версия — прозрачный фон, цветная обводка/текст, тот же принцип, что уже
// в StatDeltaBadges (дельты world_move) на тёмных карточках.
function LogDeltaChipDark({ stat, delta }) {
  const bad = INVERTED_STATS.has(stat) ? delta > 0 : delta < 0;
  const color = delta === 0 ? "#8a9aaa" : bad ? "#e09090" : "#7fae93";
  return (
    <span className="mono-font" style={{ fontSize: 10, color, border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 6px" }}>
      {statLabel(stat, ALL_STAT_LABELS[stat] ?? stat)} {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}

// Разбивка дельт хода на "главное всегда видно" + "остальное по клику" (тот же принцип, что уже
// решил ту же проблему в EndTurnScreen/PreviewCard — PrimarySecondaryDeltas/partitionPrimarySecondary,
// переиспользованы как есть). Военные операции легко двигают 15-20+ статов разом — без разбивки
// это стена из чипов одинакового веса, в которой ничего не найти и на которую больно смотреть.
function LogEntryDeltas({ deltaEntries }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const { primary, secondary } = partitionPrimarySecondary(deltaEntries);
  if (primary.length === 0 && secondary.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {primary.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {primary.map(([stat, delta]) => <LogDeltaChipDark key={stat} stat={stat} delta={delta} />)}
        </div>
      )}
      {secondary.length > 0 && (
        <div style={{ marginTop: primary.length > 0 ? 6 : 0 }}>
          <button
            onClick={() => setShowSecondary(v => !v)}
            className="mono-font"
            style={{ background: "none", border: "none", color: "#6a7080", fontSize: 9, letterSpacing: "0.06em", cursor: "pointer", padding: 0 }}
          >
            {showSecondary ? t("delta.hide_details") : t("delta.show_more", { n: secondary.length })}
          </button>
          {showSecondary && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {secondary.map(([stat, delta]) => <LogDeltaChipDark key={stat} stat={stat} delta={delta} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Журнал — раньше показывал только нарратив-пересказ хода, но не САМО решение игрока (что
// именно было подписано) и не его цену/эффект в цифрах (Петя, 2026-07-07: "чтоб можно было
// посмотреть все свои действия и решения"). Теперь под нарративом — исходный текст указа
// (то, что игрок реально написал/выбрал) и компактная строка изменений статов за этот ход.
function LogTab({ state }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {[...state.log].reverse().map((entry, i) => {
        const badge = entry.actionMode && ACTION_MODE_BADGE[entry.actionMode];
        const deltaEntries = entry.statDeltas
          ? Object.entries(entry.statDeltas).filter(([s, d]) => d !== 0 && !s.startsWith("_") && s !== "military_streak")
          : [];
        return (
          <div key={i} style={{ position: "relative", paddingLeft: 18 }}>
            <div style={{ position: "absolute", left: 0, top: 4, width: 8, height: 8, borderRadius: "50%", background: entry.turn === 0 ? "#9c8347" : "#a8313a" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span className="mono-font" style={{ fontSize: 10, color: "#8a8472" }}>{t("world.turn_short")} {entry.turn}</span>
              {badge && (
                <span className="mono-font" style={{ fontSize: 9, color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 3, padding: "1px 6px" }}>
                  {actionModeLabel(entry.actionMode, badge.label)}
                </span>
              )}
            </div>
            <div className="doc-font" style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{entry.title}</div>
            {entry.decree && (
              <div className="doc-font" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#a8a294", fontStyle: "italic", borderLeft: "2px solid #c8a857", paddingLeft: 8, marginBottom: 6 }}>
                «{entry.decree}»
              </div>
            )}
            <div className="doc-font" style={{ fontSize: 13, lineHeight: 1.5, color: "#cdd3e0" }}>{entry.body}</div>
            <LogEntryDeltas deltaEntries={deltaEntries} />
          </div>
        );
      })}
    </div>
  );
}

// Переводимые тексты Ликбеза хранятся как обычные строки с разметкой **жирный-акцент** /
// __жирный-обычный__ (см. i18n.js, ключи wiki.*) — richText разбирает эти маркеры в JSX,
// чтобы не плодить отдельные RU/EN ключи на каждое слово внутри абзаца.
function richText(str, accentStyle) {
  if (!str) return str;
  const parts = str.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <span key={i} style={accentStyle}>{part.slice(2, -2)}</span>;
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return <b key={i}>{part.slice(2, -2)}</b>;
    }
    return part;
  });
}

const WIKI_SECTIONS_META = [
  { id: "overview", icon: "🏛", key: "wiki.nav.overview" },
  { id: "strategy", icon: "🎯", key: "wiki.nav.strategy" },
  { id: "resources", icon: "⚡", key: "wiki.nav.resources" },
  { id: "stats", icon: "📊", key: "wiki.nav.stats" },
  { id: "kremlin", icon: "★", key: "wiki.nav.kremlin" },
  { id: "ukraine", icon: "🇺🇦", key: "wiki.nav.ukraine" },
  { id: "econ", icon: "🛢", key: "wiki.nav.econ" },
  { id: "policies", icon: "⚙", key: "wiki.nav.policies" },
  { id: "victory", icon: "🏆", key: "wiki.nav.victory" },
  { id: "advisors", icon: "🗣", key: "wiki.nav.advisors" },
];

function WikiTab({ dark = false }) {
  useLang(); // ре-рендер при переключении RU/EN — t()/richText читают текущий язык напрямую
  const S = dark
    ? { h: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "#c8a857", letterSpacing: "0.1em", fontWeight: 700 }, p: { fontFamily: "'PT Serif',serif", fontSize: 15.5, color: "#cdd3e0", lineHeight: 1.75, marginBottom: 12 }, b: { color: "#e0c878", fontWeight: 700 }, sectionBg: "#161b26", sectionBorder: "#2a3040", navBg: "#1a2030", navBorder: "#3a4156", navColor: "#a8a294" }
    : { h: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "#8a6f30", letterSpacing: "0.1em", fontWeight: 700 }, p: { fontFamily: "'PT Serif',serif", fontSize: 15.5, color: "#3a3f4c", lineHeight: 1.75, marginBottom: 12 }, b: { color: "#6a5520", fontWeight: 700 }, sectionBg: "#fbf8f0", sectionBorder: "#e0dac8", navBg: "#efe9d8", navBorder: "#d8d2bf", navColor: "#6a6458" };

  // Ликбез систематизирован по разделам-аккордеонам вместо сплошной простыни текста —
  // «С чего начать» открыт по умолчанию (первое, что нужно прочитать), остальное сворачиваемо.
  const [openSections, setOpenSections] = useState(() => new Set(["overview"]));
  const sectionRefs = useRef({});
  const toggleSection = (id) => setOpenSections(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const openAndScroll = (id) => {
    setOpenSections(prev => new Set(prev).add(id));
    setTimeout(() => sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const WikiSection = ({ id, children }) => {
    const meta = WIKI_SECTIONS_META.find(m => m.id === id);
    const open = openSections.has(id);
    return (
      <div ref={el => { sectionRefs.current[id] = el; }} style={{ marginBottom: 10, scrollMarginTop: 12 }}>
        <button onClick={() => toggleSection(id)}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: open ? S.navBg : "transparent", border: `1px solid ${open ? S.navBorder : S.sectionBorder}`, borderRadius: 5, padding: "10px 14px", cursor: "pointer", textAlign: "left" }}>
          <span style={S.h}>{meta?.icon} {t(`wiki.${id}.h`)}</span>
          <span style={{ color: S.navColor, fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && <div style={{ border: `1px solid ${S.sectionBorder}`, borderTop: "none", borderRadius: "0 0 5px 5px", padding: "14px 16px 6px", background: S.sectionBg }}>{children}</div>}
      </div>
    );
  };

  const P = (key, extraStyle) => <div style={extraStyle ? { ...S.p, ...extraStyle } : S.p}>{richText(t(key), S.b)}</div>;

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="mono-font" style={{ fontSize: 15, color: dark ? "#c8a857" : "#8a6f30", fontWeight: 700, marginBottom: 6 }}>{t("wiki.title")}</div>
      <div className="doc-font" style={{ fontSize: 13.5, color: dark ? "#7a8294" : "#6a6458", marginBottom: 14 }}>{t("wiki.subtitle")}</div>

      {/* Быстрая навигация — открывает и прокручивает к разделу */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
        {WIKI_SECTIONS_META.map(m => (
          <button key={m.id} onClick={() => openAndScroll(m.id)}
            style={{ background: S.navBg, border: `1px solid ${S.navBorder}`, borderRadius: 20, padding: "5px 12px", color: S.navColor, fontFamily: "'PT Serif',serif", fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
            {m.icon} {t(m.key)}
          </button>
        ))}
      </div>

      <WikiSection id="overview">
        {P("wiki.overview.p1")}
        {P("wiki.overview.p2")}
        {P("wiki.overview.p3", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="strategy">
        <div className="doc-font" style={{ fontSize: 12, color: dark ? "#8a9aaa" : "#8a8060", marginBottom: 10, fontStyle: "italic" }}>
          {t("wiki.strategy.intro")}
        </div>
        <div className="doc-font" style={{ fontSize: 12, color: dark ? "#c8a857" : "#8a6f30", marginBottom: 14 }}>
          {richText(t("wiki.strategy.scope_note"), S.b)}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {["1", "2", "3", "4", "5", "6", "7"].map((n) => (
            <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: dark ? "#2a3040" : "#e8e0c8", border: `1px solid ${dark ? "#c8a857" : "#8a6f30"}`, color: dark ? "#c8a857" : "#8a6f30", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 10.5, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{n}</div>
              <div>
                <div className="doc-font" style={{ fontSize: 13.5, fontWeight: 700, color: dark ? "#ece7d8" : "#2a2620", marginBottom: 2 }}>{t(`wiki.strategy.rule${n}.title`)}</div>
                <div className="doc-font" style={{ fontSize: 12.5, color: dark ? "#8a9aaa" : "#6a6458", lineHeight: 1.5 }}>{t(`wiki.strategy.rule${n}.desc`)}</div>
              </div>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection id="resources">
        {P("wiki.resources.p1")}
        {P("wiki.resources.p2")}
        {P("wiki.resources.p3")}
        {P("wiki.resources.p4")}
        {P("wiki.resources.p5")}
        {P("wiki.resources.p6")}
        {P("wiki.resources.p7", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="stats">
        {P("wiki.stats.p1")}
        {P("wiki.stats.p2")}
        {P("wiki.stats.p3")}
        {P("wiki.stats.p4")}
        {P("wiki.stats.p5")}
        {P("wiki.stats.p6", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="kremlin">
        {P("wiki.kremlin.p1")}
        {P("wiki.kremlin.p2")}
        {P("wiki.kremlin.p3")}
        {P("wiki.kremlin.p4")}
        {P("wiki.kremlin.p5")}
        {P("wiki.kremlin.p6")}
        {P("wiki.kremlin.p7")}
        {P("wiki.kremlin.p8")}
        {P("wiki.kremlin.p9", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="ukraine">
        {P("wiki.ukraine.p1")}
        {P("wiki.ukraine.p2")}
        {P("wiki.ukraine.p3", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="econ">
        {P("wiki.econ.p1")}
        {P("wiki.econ.p2")}
        {P("wiki.econ.p3")}
        {P("wiki.econ.p4")}
        {P("wiki.econ.p5")}
        {P("wiki.econ.p6")}
        {P("wiki.econ.p7")}
        {P("wiki.econ.p8")}
        {P("wiki.econ.p9")}
        {P("wiki.econ.p10")}
        {P("wiki.econ.p11")}
        {P("wiki.econ.p12", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="policies">
        {P("wiki.policies.p1", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="victory">
        {P("wiki.victory.p1")}
        {P("wiki.victory.p2")}
        {P("wiki.victory.p3")}
        {P("wiki.victory.p4")}
        <div style={S.p}>
          {["approval", "economy", "stability", "diplomacy", "escalation", "military", "donbas", "deadline"].map((k, i, arr) => (
            <React.Fragment key={k}>
              {richText(t(`wiki.victory.defeat.${k}`), S.b)}
              {i < arr.length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>
        {P("wiki.victory.p5", { marginBottom: 0 })}
      </WikiSection>

      <WikiSection id="advisors">
        {P("wiki.advisors.p1")}
        {P("wiki.advisors.p2")}
        {P("wiki.advisors.p3", { marginBottom: 0 })}
      </WikiSection>
    </div>
  );
}
