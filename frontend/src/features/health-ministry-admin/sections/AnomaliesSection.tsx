import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw, XCircle } from "lucide-react";
import { getAnomalyFlags, resolveAnomalyFlag } from "../api/anomalyFlagsApi";
import type { AnomalyFlag } from "../types";

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SPIKE: "Login Spike",
  DHID_ENUMERATION: "DHID Enumeration",
  PASSWORD_RESET_ABUSE: "Password Reset Abuse", // pragma: allowlist secret
  REQUEST_FLOOD: "Request Flood",
};

function formatWindowLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: AnomalyFlag["status"]) {
  if (status === "open") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (status === "resolved") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400";
}

function eventTypeBadge(eventType: string) {
  if (eventType === "LOGIN_SPIKE") return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (eventType === "DHID_ENUMERATION") return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
  if (eventType === "PASSWORD_RESET_ABUSE") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (eventType === "REQUEST_FLOOD") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
}

type StatusFilter = "all" | "open" | "resolved" | "dismissed";

export function AnomaliesSection() {
  const [flags, setFlags] = useState<AnomalyFlag[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [submitting, setSubmitting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getAnomalyFlags(statusFilter === "all" ? undefined : statusFilter);
      setFlags(result.flags);
      setOpenCount(result.openCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load anomaly flags.");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleResolve = async (flagId: number, action: "resolved" | "dismissed") => {
    setSubmitting(flagId);
    setActionMessage(null);
    try {
      await resolveAnomalyFlag(flagId, action);
      setActionMessage(`Flag #${flagId} marked as ${action}.`);
      void load();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Anomaly Flags
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Unusual usage spikes detected by the in-memory sliding-window monitor. Review open flags and resolve or dismiss them after investigation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
        >
          <RefreshCcw size={16} />
          Refresh
        </button>
      </header>

      {openCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            <span className="font-bold">{openCount} open flag{openCount !== 1 ? "s" : ""}</span> require investigation.
          </span>
        </div>
      )}

      {actionMessage && (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${
          actionMessage.toLowerCase().includes("fail") || actionMessage.toLowerCase().includes("error")
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300"
        }`}>
          {actionMessage}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "open", "resolved", "dismissed"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
              statusFilter === s
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading anomaly flags…
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : flags.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <CheckCircle2 size={36} className="text-emerald-400" />
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              No anomaly flags match the current filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-semibold">Event</th>
                  <th className="px-5 py-4 font-semibold">Source IP</th>
                  <th className="px-5 py-4 font-semibold">Count / Threshold</th>
                  <th className="px-5 py-4 font-semibold">Window</th>
                  <th className="px-5 py-4 font-semibold">Flagged At</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {flags.map((flag) => (
                  <tr key={flag.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${eventTypeBadge(flag.eventType)}`}>
                        {EVENT_LABELS[flag.eventType] ?? flag.eventType}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {flag.sourceIp ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-bold text-red-700 dark:text-red-400">{flag.eventCount}</span>
                      <span className="text-slate-400"> / {flag.threshold}</span>
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {formatWindowLabel(flag.windowSeconds)}
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {formatDate(flag.flaggedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(flag.status)}`}>
                        {flag.status}
                      </span>
                      {flag.resolvedAt && (
                        <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                          {formatDate(flag.resolvedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {flag.status === "open" ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={submitting === flag.id}
                            onClick={() => void handleResolve(flag.id, "resolved")}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
                          >
                            <CheckCircle2 size={13} />
                            Resolve
                          </button>
                          <button
                            type="button"
                            disabled={submitting === flag.id}
                            onClick={() => void handleResolve(flag.id, "dismissed")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <XCircle size={13} />
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-slate-400 dark:text-slate-500">—</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        <p className="font-semibold">Detection rules:</p>
        <ul className="mt-2 space-y-1">
          <li><span className="font-medium text-slate-700 dark:text-slate-200">Login Spike</span> — 15+ login attempts from same IP in 5 minutes</li>
          <li><span className="font-medium text-slate-700 dark:text-slate-200">DHID Enumeration</span> — 20+ DHID lookups from same IP in 10 minutes</li>
          <li><span className="font-medium text-slate-700 dark:text-slate-200">Password Reset Abuse</span> — 8+ reset attempts from same IP in 10 minutes</li>
          <li><span className="font-medium text-slate-700 dark:text-slate-200">Request Flood</span> — 500+ requests from same IP in 5 minutes</li>
        </ul>
        <p className="mt-3">Flags are written once per source per event type per 15-minute cooldown window. Resolve a flag after confirming it is not a genuine attack, or dismiss it if it is a false positive.</p>
      </aside>
    </section>
  );
}
