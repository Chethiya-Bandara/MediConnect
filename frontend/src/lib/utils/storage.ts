export function getStoredToken() {
  return localStorage.getItem("token");
}

export function setStoredToken(token: string) {
  localStorage.setItem("token", token);
}

export function removeStoredToken() {
  localStorage.removeItem("token");
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
