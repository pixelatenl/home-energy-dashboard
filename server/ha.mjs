// Minimal Home Assistant REST client. Reads HA_URL and HA_TOKEN from the
// environment and never logs them. All calls fail soft: any error resolves
// to null so callers can degrade gracefully.

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

const stateCache = new Map(); // entityId -> { fetchedAt, state }

export async function haGetState(entityId) {
  if (!entityId) {
    return null;
  }
  const cached = stateCache.get(entityId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.state;
  }
  const baseUrl = process.env.HA_URL;
  const token = process.env.HA_TOKEN;
  if (!baseUrl || !token) {
    return null;
  }
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/states/${entityId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      return null;
    }
    const state = await response.json();
    stateCache.set(entityId, { fetchedAt: Date.now(), state });
    return state;
  } catch {
    return null;
  }
}
