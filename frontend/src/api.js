/**
 * api.js
 * Тонкий клиент над backend API. Заменяет статичный initialState
 * из прототипа на реальные сетевые вызовы.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "https://realpolitik-game-production.up.railway.app";

// Fetch с таймаутом. AI-запросы (preview, confirm, suggestions) могут занимать 20-40 сек.
async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Запрос занял слишком долго — попробуйте ещё раз.");
    if (err.message === "Failed to fetch") throw new Error("Нет связи с сервером — проверьте интернет и попробуйте ещё раз.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGameState(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}`, {}, 15000);
  if (!res.ok) throw new Error(`fetchGameState failed: ${res.status}`);
  return res.json();
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

export async function createUser(displayName) {
  const res = await fetchWithTimeout(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  }, 15000);
  if (!res.ok) throw new Error("Не удалось создать пользователя");
  return res.json();
}

export async function createGame(countryId, userId) {
  const res = await fetchWithTimeout(`${API_BASE}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryId, userId }),
  }, 30000);
  if (!res.ok) throw new Error(`createGame failed: ${res.status}`);
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

export async function consultAdvisors(gameId, playerDraft) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/advisors/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerDraft: playerDraft || null }),
  }, 60000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `consultAdvisors failed: ${res.status}`);
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

export async function fetchLeaderboard(countryId) {
  const params = countryId ? `?countryId=${countryId}` : "";
  const res = await fetchWithTimeout(`${API_BASE}/leaderboard${params}`, {}, 15000);
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
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

export async function cancelPolicy(gameId, policyTitle) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/cancel-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyTitle }),
  }, 10000);
  if (!res.ok) throw new Error("Ошибка отмены указа");
  return res.json();
}
