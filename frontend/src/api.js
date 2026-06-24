/**
 * api.js
 * Тонкий клиент над backend API. Заменяет статичный initialState
 * из прототипа на реальные сетевые вызовы.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "https://realpolitik-game-production.up.railway.app";

export async function fetchGameState(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}`);
  if (!res.ok) throw new Error(`fetchGameState failed: ${res.status}`);
  return res.json();
}

export async function previewTurn(gameId, playerInput) {
  const res = await fetch(`${API_BASE}/games/${gameId}/turns/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerInput }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `previewTurn failed: ${res.status}`);
  }
  return res.json();
}

export async function confirmTurn(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}/turns/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `confirmTurn failed: ${res.status}`);
  }
  return res.json();
}

export async function cancelTurn(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}/turns/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`cancelTurn failed: ${res.status}`);
  return res.json();
}

export async function fetchNewsfeed(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}/newsfeed`);
  if (!res.ok) throw new Error(`fetchNewsfeed failed: ${res.status}`);
  return res.json();
}

export async function fetchLog(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}/log`);
  if (!res.ok) throw new Error(`fetchLog failed: ${res.status}`);
  return res.json();
}

export async function createUser(displayName) {
  const res = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error("Не удалось создать пользователя");
  return res.json();
}

export async function createGame(countryId, userId) {
  const res = await fetch(`${API_BASE}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryId, userId }),
  });
  if (!res.ok) throw new Error(`createGame failed: ${res.status}`);
  return res.json();
}

export async function argueWithAdvisor(gameId, playerArgument) {
  const res = await fetch(`${API_BASE}/games/${gameId}/turns/argue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerArgument }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `argue failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSuggestions(gameId) {
  const res = await fetch(`${API_BASE}/games/${gameId}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`fetchSuggestions failed: ${res.status}`);
  return res.json();
}

export async function consultAdvisors(gameId, playerDraft) {
  const res = await fetch(`${API_BASE}/games/${gameId}/advisors/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerDraft: playerDraft || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `consultAdvisors failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchLeaderboard(countryId) {
  const params = countryId ? `?countryId=${countryId}` : "";
  const res = await fetch(`${API_BASE}/leaderboard${params}`);
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return res.json();
}
