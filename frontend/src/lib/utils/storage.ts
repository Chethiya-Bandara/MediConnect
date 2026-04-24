// Tokens stored in sessionStorage instead of localStorage so they are
// never persisted to disk and are cleared when the browser tab closes.
// Full migration to httpOnly cookies is the next step.
export function getStoredToken() {
  return sessionStorage.getItem("token");
}

export function setStoredToken(token: string) {
  sessionStorage.setItem("token", token);
}

export function removeStoredToken() {
  sessionStorage.removeItem("token");
}

export function getStoredJson<T>(key: string): T | null {
  const value = localStorage.getItem(key);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function setStoredJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function removeStoredValue(key: string) {
  localStorage.removeItem(key);
}
