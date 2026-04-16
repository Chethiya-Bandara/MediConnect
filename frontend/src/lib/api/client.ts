import type { ApiRequestOptions } from "../../types/api";
import type { ApiErrorPayload } from "../../types/common";
import { appConfig } from "../constants/appConfig";
import { getStoredToken } from "../utils/storage";

function buildHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function normalizeErrorMessage(payload: ApiErrorPayload | null) {
  if (!payload) {
    return "Request failed";
  }

  const candidate = payload.detail ?? payload.message;

  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }

  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    const nestedMessage =
      typeof record.message === "string" ? record.message.trim() : "";
    const nestedErrors = Array.isArray(record.errors)
      ? record.errors.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    if (nestedMessage && nestedErrors.length > 0) {
      return `${nestedMessage}: ${nestedErrors.join(", ")}`;
    }

    if (nestedMessage) {
      return nestedMessage;
    }

    if (nestedErrors.length > 0) {
      return nestedErrors.join(", ");
    }
  }

  if (Array.isArray(payload.errors)) {
    const flatErrors = payload.errors.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (flatErrors.length > 0) {
      return flatErrors.join(", ");
    }
  }

  return "Request failed";
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true } = options;
  const headers = buildHeaders(init?.headers);

  if (auth) {
    const token = getStoredToken();

    if (!token) {
      throw new Error("Missing login token");
    }

    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ApiErrorPayload | T) : null;

  if (!response.ok) {
    const message = normalizeErrorMessage(payload as ApiErrorPayload | null);
    throw new Error(message);
  }

  return payload as T;
}
