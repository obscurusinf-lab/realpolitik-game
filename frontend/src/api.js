/**
 * api.js
 * Тонкий клиент над backend API. Заменяет статичный initialState
 * из прототипа на реальные сетевые вызовы.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "https://realpolitik-game-production.up.railway.app";

// ---------- Auth token ----------
export function getToken() {
  try { return localStorage.getItem("authToken") || null; } catch { return null; }
}
export function setToken(token) {
  try { if (token) localStorage.setItem("authToken", token); else localStorage.removeItem("authToken"); } catch {}
}

// Fetch с таймаутом + автоматический Authorization header
async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Запрос занял слишком долго — попробуйте ещё раз.");
    if (err.message === "Failed to fetch") throw new Error("Нет связи с сервером — проверьте интернет и попробуйте ещё раз.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Auth API ----------
export async function register(username, password, displayName, inviteCode) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName, inviteCode }),
  }, 15000);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Ошибка регистрации");
  return body;
}

export async function login(username, password) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }, 15000);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Ошибка входа");
  return body;
}

export async function updateDisplayName(displayName) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/update-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  }, 15000);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Не удалось изменить имя");
  return body;
}

export async function fetchMyGames() {
  const res = await fetchWithTimeout(`${API_BASE}/games/my`, {}, 15000);
  if (!res.ok) throw new Error("Не удалось загрузить партии");
  return res.json();
}

export async function fetchGameState(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}`, {}, 15000);
  if (!res.ok) throw new Error(`fetchGameState failed: ${res.status}`);
  return res.json();
}

// Heartbeat, пока партия открыта и вкладка видима — источник индикатора "онлайн" в админке.
export async function pingGame(gameId) {
  try { await fetchWithTimeout(`${API_BASE}/games/${gameId}/ping`, { method: "POST" }, 8000); } catch {}
}

// Переключатель RU/EN в шапке (i18n.js) меняет только статичные UI-строки — не трогает язык,
// на котором ИИ пишет новый нарратив (games.language). Синхронизируем при смене языка внутри
// активной партии, чтобы новые новости/ходы шли на выбранном языке (App.jsx). Fire-and-forget —
// сбой синхронизации не должен мешать переключению UI.
export async function updateGameLanguage(gameId, language) {
  try {
    await fetchWithTimeout(`${API_BASE}/games/${gameId}/language`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    }, 8000);
  } catch {}
}

export async function previewTurn(gameId, playerInput, actionMode = "decree") {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerInput, actionMode }),
  }, 90000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `previewTurn failed: ${res.status}`);
  }
  return res.json();
}

export async function confirmTurn(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `confirmTurn failed: ${res.status}`);
  }
  return res.json();
}

// Башни Кремля — разрешение карточки-дилеммы ("Придворная интрига").
export async function resolveFactionDilemma(gameId, dilemmaId, choice) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/faction-dilemma/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dilemmaId, choice }),
  }, 30000);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `resolveFactionDilemma failed: ${res.status}`);
  return body;
}

export async function cancelTurn(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/cancel`, { method: "POST" }, 15000);
  if (!res.ok) throw new Error(`cancelTurn failed: ${res.status}`);
  return res.json();
}

export async function fetchNewsfeed(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/newsfeed`, {}, 15000);
  if (!res.ok) throw new Error(`fetchNewsfeed failed: ${res.status}`);
  return res.json();
}

export async function fetchLog(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/log`, {}, 15000);
  if (!res.ok) throw new Error(`fetchLog failed: ${res.status}`);
  return res.json();
}

export async function fetchLeaderboard(countryId) {
  const params = countryId ? `?countryId=${countryId}` : "";
  const res = await fetchWithTimeout(`${API_BASE}/leaderboard${params}`, {}, 15000);
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return res.json();
}

export async function createGame(countryId, assistMode = "advisor", presidentName = "", showInLeaderboard = false, language = "ru") {
  const res = await fetchWithTimeout(`${API_BASE}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryId, assistMode, presidentName, showInLeaderboard, language }),
  }, 30000);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `createGame failed: ${res.status}`);
  return body;
}

export async function deleteGame(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}`, { method: "DELETE" }, 15000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Ошибка удаления партии");
  }
  return res.json();
}

export async function argueWithAdvisor(gameId, playerArgument) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/argue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerArgument }),
  }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `argue failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSuggestions(gameId, actionMode = "decree") {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionMode }),
  }, 60000);
  if (!res.ok) throw new Error(`fetchSuggestions failed: ${res.status}`);
  return res.json();
}

export async function consultAdvisor(gameId, advisorId, playerDraft, actionMode) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/advisors/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ advisorId, playerDraft: playerDraft || null, actionMode: actionMode || "decree_reform" }),
  }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `consultAdvisor failed: ${res.status}`);
  }
  return res.json();
}

// Детерминированный расчёт "оптимального хода" (не ИИ, дёшево) — источник для баннера-
// рекомендации в AdvisorsTab (Петя, 2026-07-10: советы должны отслеживать выполнение и объяснять
// последствия — см. computeOptimalMove в backend/src/ai/advisors.js).
export async function fetchOptimalMove(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/advisors/optimal-move`, { method: "GET" }, 20000);
  if (!res.ok) throw new Error(`fetchOptimalMove failed: ${res.status}`);
  return res.json();
}

export async function regroupTurn(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/regroup`, { method: "POST" }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `regroupTurn failed: ${res.status}`);
  }
  return res.json();
}

export async function endMonth(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/end-month`, { method: "POST" }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `endMonth failed: ${res.status}`);
  }
  return res.json();
}

export async function skipTurn(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/turns/skip`, { method: "POST" }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `skipTurn failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAdminStats(password) {
  const res = await fetchWithTimeout(`${API_BASE}/admin/stats`, {
    headers: { "x-admin-password": password },
  }, 15000);
  if (res.status === 403) throw new Error("Неверный пароль");
  if (!res.ok) throw new Error(`fetchAdminStats failed: ${res.status}`);
  return res.json();
}

export async function fetchStatHistory(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/stat-history`, {}, 10000);
  if (!res.ok) return { history: [] };
  return res.json();
}

export async function fetchPolicyNews(gameId, keyword) {
  const url = `${API_BASE}/games/${gameId}/policy-news${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`;
  const res = await fetchWithTimeout(url, {}, 10000);
  if (!res.ok) return { items: [] };
  return res.json();
}

export async function fetchLegacy(gameId, outcome) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/legacy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome }),
  }, 90000);
  if (!res.ok) throw new Error(`fetchLegacy failed: ${res.status}`);
  return res.json();
}

export async function sendUkraineResponse(gameId, responseType, actionType, turnN) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/ukraine-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ responseType, actionType, turnN }),
  }, 8000);
  if (!res.ok) return { ok: false, delta: {}, outcome: "neutral", outcomeText: "" };
  return res.json();
}

export async function sendWorldResponse(gameId, responseType, source, turnN, reactionText) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/world-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ responseType, source, turnN, reactionText }),
  }, 8000);
  if (!res.ok) return { ok: false, delta: {}, outcome: "neutral", outcomeText: "" };
  return res.json();
}

export async function cancelPolicy(gameId, policyTitle) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/cancel-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyTitle }),
  }, 10000);
  if (!res.ok) throw new Error("Ошибка отмены указа");
  return res.json();
}


export async function respondToUkraineEvent(gameId, turnN, responseType) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/ukraine/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ turnN, responseType }),
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка ответа на событие");
  }
  return res.json();
}

export async function issueBonds(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/issue-bonds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка выпуска ОФЗ");
  }
  return res.json();
}

export async function repayBonds(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/repay-bonds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка погашения ОФЗ");
  }
  return res.json();
}

export async function convertReserves(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/convert-reserves`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка конвертации резервов");
  }
  return res.json();
}

export async function toggleFxRegime(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/toggle-fx-regime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка смены курсовой политики");
  }
  return res.json();
}

export async function cbPressure(gameId, direction) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/cb-pressure`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ direction }),
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка операции ЦБ");
  }
  return res.json();
}

export async function cbReplace(gameId, type) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/cb-replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ type }),
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка смены главы ЦБ");
  }
  return res.json();
}

export async function submitFeedback(message, contact, gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, contact, gameId, page: typeof window !== "undefined" ? window.location.pathname : "" }),
  }, 15000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось отправить сообщение");
  }
  return res.json();
}

export async function antiCorruptionCampaign(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/anti-corruption`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка антикоррупционной кампании");
  }
  return res.json();
}

export async function emergencyStimulus(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/emergency-stimulus`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка экстренного стимулирования");
  }
  return res.json();
}

export async function investSurplus(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/treasury/invest-surplus`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: "{}",
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка инвестирования");
  }
  return res.json();
}
