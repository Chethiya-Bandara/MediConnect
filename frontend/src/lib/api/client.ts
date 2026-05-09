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

function getStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatValidationIssue(issue: unknown) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const record = issue as Record<string, unknown>;
  const message =
    typeof record.msg === "string"
      ? record.msg.trim()
      : typeof record.message === "string"
        ? record.message.trim()
        : "";

  if (!message) {
    return null;
  }

  const location = Array.isArray(record.loc)
    ? record.loc
        .filter(
          (part): part is string | number => typeof part === "string" || typeof part === "number",
        )
        .join(" -> ")
    : "";

  return location ? `${location}: ${message}` : message;
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as ApiErrorPayload;
  } catch {
    return null;
  }
}

function normalizeErrorMessage(payload: ApiErrorPayload | null) {
  if (!payload) {
    return "Request failed";
  }

  const candidate = payload.detail ?? payload.message;

  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }

  if (Array.isArray(candidate)) {
    const formattedIssues = candidate
      .map((issue) => formatValidationIssue(issue))
      .filter((issue): issue is string => Boolean(issue));

    if (formattedIssues.length > 0) {
      return formattedIssues.join(", ");
    }
  }

  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    const nestedMessage = typeof record.message === "string" ? record.message.trim() : "";
    const nestedErrors = getStringList(record.errors);

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

  const topLevelMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  const topLevelErrors = getStringList(payload.errors);

  if (topLevelMessage && topLevelErrors.length > 0) {
    return `${topLevelMessage}: ${topLevelErrors.join(", ")}`;
  }

  if (topLevelMessage) {
    return topLevelMessage;
  }

  if (topLevelErrors.length > 0) {
    return topLevelErrors.join(", ");
  }

  return "Request failed";
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true } = options;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = buildHeaders(init?.headers);
  if (isFormData) {
    headers.delete("Content-Type");
  }

  if (auth) {
    const token = getStoredToken();

    if (!token) {
      throw new Error("Missing login token");
    }

    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new Error(
      `Cannot reach the backend at ${appConfig.apiBaseUrl}. Check that the API server is running and the port is correct.`,
    );
  }

  const text = await response.text();
  const payload = text ? tryParseJson(text) : null;

  if (!response.ok) {
    const message = normalizeErrorMessage(payload as ApiErrorPayload | null);
    throw new Error(message);
  }

  return payload as T;
}
