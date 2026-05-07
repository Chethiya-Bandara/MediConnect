// Default: sessionStorage — cleared when the tab closes, never persisted to disk.
// With rememberDevice=true: localStorage — survives browser restarts.
// Full migration to httpOnly cookies is the next step.
export function getStoredToken() {
  return localStorage.getItem("token") ?? sessionStorage.getItem("token");
}

export function setStoredToken(token: string, persistent = false) {
  if (persistent) {
    localStorage.setItem("token", token);
  } else {
    sessionStorage.setItem("token", token);
  }
}

export function removeStoredToken() {
  localStorage.removeItem("token");
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
