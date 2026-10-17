// Shared admin auth helpers
// The backend uses JWT issued by POST /api/admin/login (authAdminJwt).
// The token is stored in sessionStorage so it clears on tab close.

const AUTH_KEY = 'apnaservo_admin_token';
const USER_KEY = 'apnaservo_admin_user';

// Read from env-like config injected at runtime, or fall back to localhost.
// In production, set window.ADMIN_API_BASE before loading this script.
function apiBase() {
  return (window.ADMIN_API_BASE || 'http://localhost:5000').replace(/\/$/, '');
}

function getToken() {
  return sessionStorage.getItem(AUTH_KEY) || '';
}

function getUser() {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

function saveSession(token, user) {
  sessionStorage.setItem(AUTH_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(apiBase() + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (res.status === 401 || res.status === 403) {
    clearSession();
    window.location.href = 'index.html';
    throw new Error('Session expired');
  }
  return res;
}

function logout() {
  clearSession();
  window.location.href = 'index.html';
}
