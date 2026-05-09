import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type { AnomalyFlag } from "../types";

interface AnomalyFlagsResponse {
  flags?: Array<{
    id?: number | null;
    event_type?: string | null;
    source_ip?: string | null;
    event_count?: number | null;
    window_seconds?: number | null;
    threshold?: number | null;
    flagged_at?: string | null;
    resolved_at?: string | null;
    resolved_by?: string | null;
    status?: string | null;
  }>;
  total?: number;
  open_count?: number;
}

function normaliseFlag(raw: NonNullable<AnomalyFlagsResponse["flags"]>[number]): AnomalyFlag {
  return {
    id: raw.id ?? 0,
    eventType: raw.event_type ?? "UNKNOWN",
    sourceIp: raw.source_ip ?? null,
    eventCount: raw.event_count ?? 0,
    windowSeconds: raw.window_seconds ?? 0,
    threshold: raw.threshold ?? 0,
    flaggedAt: raw.flagged_at ?? "",
    resolvedAt: raw.resolved_at ?? null,
    resolvedBy: raw.resolved_by ?? null,
    status: (raw.status as AnomalyFlag["status"]) ?? "open",
  };
}

export async function getAnomalyFlags(
  status?: string,
): Promise<{ flags: AnomalyFlag[]; openCount: number }> {
  const url = status
    ? `${endpoints.healthMinistryAdmin.anomalies}?status=${encodeURIComponent(status)}`
    : endpoints.healthMinistryAdmin.anomalies;

  const data = await apiRequest<AnomalyFlagsResponse>(url);
  return {
    flags: (data.flags ?? []).map(normaliseFlag),
    openCount: data.open_count ?? 0,
  };
}

export async function resolveAnomalyFlag(
  flagId: number,
  action: "resolved" | "dismissed",
): Promise<void> {
  await apiRequest<unknown>(`${endpoints.healthMinistryAdmin.anomalies}/${flagId}/resolve`, {
    method: "PUT",
    body: JSON.stringify({ action }),
  });
}
