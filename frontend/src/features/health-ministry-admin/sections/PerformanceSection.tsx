import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, RefreshCcw } from "lucide-react";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type { SlowRequest, SlowRequestsReport } from "../types";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function durationBadge(ms: number, slaMs: number) {
  const ratio = ms / slaMs;
  if (ratio >= 2) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (ratio >= 1.5) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
}

function methodBadge(method: string) {
  if (method === "GET") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (method === "POST") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (method === "PUT" || method === "PATCH") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
}

interface RawSlowRequestsResponse {
  sla_ms?: number;
  total_slow?: number;
  requests?: Array<{
    path?: string;
    method?: string;
    status_code?: number;
    duration_ms?: number;
    timestamp?: string;
  }>;
}

async function fetchSlowRequests(): Promise<SlowRequestsReport> {
  const data = await apiRequest<RawSlowRequestsResponse>(endpoints.healthMinistryAdmin.slowRequests);
  return {
    slaMs: data.sla_ms ?? 2000,
    totalSlow: data.total_slow ?? 0,
    requests: (data.requests ?? []).map((r) => ({
      path: r.path ?? "",
      method: r.method ?? "GET",
      statusCode: r.status_code ?? 0,
      durationMs: r.duration_ms ?? 0,
      timestamp: r.timestamp ?? "",
    })),
  };
}

export function PerformanceSection() {
  const [report, setReport] = useState<SlowRequestsReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSlowRequests();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load performance data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const slaMs = report?.slaMs ?? 2000;

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Performance Monitor
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Requests that exceeded the {slaMs}ms SLA (NFR-4.1). The server adds an{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">X-Response-Time</code>{" "}
            header to every response — check DevTools Network tab to verify individual requests.
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

      {/* SLA summary cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <article className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="rounded-xl bg-blue-100 p-2 w-fit text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            <Activity size={18} />
          </div>
          <p className="text-3xl font-extrabold">{slaMs}ms</p>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            SLA Target
          </p>
        </article>
        <article className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className={`rounded-xl p-2 w-fit ${(report?.totalSlow ?? 0) > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
            <Activity size={18} />
          </div>
          <p className="text-3xl font-extrabold">{report?.totalSlow ?? "—"}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Slow Requests (since restart)
          </p>
        </article>
        <article className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="rounded-xl bg-slate-100 p-2 w-fit text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            <Activity size={18} />
          </div>
          <p className="text-3xl font-extrabold">
            {report && report.requests.length > 0
              ? `${Math.max(...report.requests.map((r) => r.durationMs)).toLocaleString()}ms`
              : "—"}
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Worst Response Time
          </p>
        </article>
      </div>

      <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <h2 className="font-headline text-lg font-bold">Slow Requests Log</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Last 100 requests exceeding {slaMs}ms — newest first. Resets on server restart.
          </p>
        </div>

        {isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading performance data…
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : !report || report.requests.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <CheckCircle2 size={36} className="text-emerald-400" />
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              No slow requests recorded since the last server restart.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              All responses are within the {slaMs}ms SLA.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-semibold">Timestamp</th>
                  <th className="px-5 py-4 font-semibold">Method</th>
                  <th className="px-5 py-4 font-semibold">Path</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {report.requests.map((req: SlowRequest, i: number) => (
                  <tr key={`${req.timestamp}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(req.timestamp)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${methodBadge(req.method)}`}>
                        {req.method}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-slate-300">
                      {req.path}
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {req.statusCode}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${durationBadge(req.durationMs, slaMs)}`}>
                        {req.durationMs.toLocaleString()}ms
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
