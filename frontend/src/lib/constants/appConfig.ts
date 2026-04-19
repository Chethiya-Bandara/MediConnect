function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:8000";
  }

  const { hostname, protocol } = window.location;

  // Browsers sometimes resolve localhost to ::1 while uvicorn is bound to 127.0.0.1.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://127.0.0.1:8000";
  }

  return `${protocol}//${hostname}:8000`;
}

export const appConfig = {
  apiBaseUrl: resolveApiBaseUrl(),
} as const;
