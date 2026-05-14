import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCcw, Search, Shield } from "lucide-react";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";

interface AuditLogRow {
  id: number | string | null;
  timestamp: string | null;
  action: string | null;
  entity: string | null;
  entity_id: number | string | null;
  user_id: string | null;
  organisation_id: number | string | null;
  notes: string | null;
  // enriched fields from dashboard (may be absent in direct fetch)
  actorName?: string | null;
  actorRole?: string | null;
  organisationName?: string | null;
}

interface AuditLogsResponse {
  count: number;
  offset: number;
  limit: number;
  logs: AuditLogRow[];
}

const COMMON_ACTIONS = [
  "DOCTOR_APPROVED",
  "DOCTOR_REJECTED",
  "HOSPITAL_APPROVED",
  "HOSPITAL_REJECTED",
  "AUDIT_LOG_ACCESSED",
  "AUDIT_LOG_EXPORTED",
  "CONSENT_GRANTED",
  "CONSENT_REVOKED",
  "PRESCRIPTION_CREATED",
  "APPOINTMENT_BOOKED",
  "ENCOUNTER_SUBMITTED",
  "MEDICINE_CREATED",
  "MEDICINE_UPDATED",
  "MEDICINE_DELETED",
  "ENTITY_SUSPENDED",
  "ENTITY_ACTIVATED",
  "DELETION_REQUESTED",
  "DELETION_APPROVED",
];

const PAGE_SIZE = 50;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function actionBadge(action: string | null) {
  if (!action) return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  const up = action.toUpperCase();
  if (up.includes("APPROVED") || up.includes("GRANTED") || up.includes("ACTIVATED"))
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (
    up.includes("REJECTED") ||
    up.includes("REVOKED") ||
    up.includes("SUSPENDED") ||
    up.includes("DELETED")
  )
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (up.includes("ACCESSED") || up.includes("EXPORTED"))
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
}

function downloadCsv(rows: AuditLogRow[]) {
  const header = [
    "ID",
    "Timestamp",
    "Action",
    "Entity",
    "Entity ID",
    "User ID",
    "Organisation ID",
    "Notes",
  ];
  const lines = rows.map((r) =>
    [
      String(r.id ?? ""),
      r.timestamp ?? "",
      r.action ?? "",
      r.entity ?? "",
      String(r.entity_id ?? ""),
      r.user_id ?? "",
      String(r.organisation_id ?? ""),
      r.notes ?? "",
    ]
      .map((c) => `"${c.replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-investigation-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvestigationSection() {
  const [userId, setUserId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const runQuery = useCallback(
    async (newOffset: number) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (userId.trim()) params.set("user_id", userId.trim());
      if (orgId.trim()) params.set("organisation_id", orgId.trim());
      if (action) params.set("action", action);
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate + "T23:59:59");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(newOffset));

      try {
        const url = `${endpoints.healthMinistryAdmin.investigationLogs}?${params.toString()}`;
        const data = await apiRequest<AuditLogsResponse>(url);
        setRows(data.logs ?? []);
        setTotal(data.count ?? 0);
        setOffset(newOffset);
        setHasSearched(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load audit logs.");
      } finally {
        setIsLoading(false);
      }
    },
    [userId, orgId, action, fromDate, toDate],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleSearch() {
    void runQuery(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  const totalPages = total !== null ? Math.ceil(total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Investigation Mode
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Server-side filtered search across all audit logs. Filter by user,
            organisation, time range, and action type.
          </p>
        </div>
        <div className="flex gap-3">
          {hasSearched && rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(rows)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Download size={15} />
              Export CSV
            </button>
          )}
          <button
            type="button"
            onClick={handleSearch}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
          >
            <Search size={16} />
            Search
          </button>
        </div>
      </header>

      {/* Filter controls */}
      <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              User ID
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="UUID of the actor..."
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Organisation ID
            </label>
            <input
              type="text"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Numeric organisation ID..."
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Action Type
            </label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-500"
            >
              <option value="">All actions</option>
              {COMMON_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-500"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setUserId("");
                setOrgId("");
                setAction("");
                setFromDate("");
                setToDate("");
              }}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <div>
            <h2 className="font-headline text-lg font-bold">Audit Log Results</h2>
            {total !== null && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {total === 0
                  ? "No records matched your filters."
                  : `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} record${total !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
          {hasSearched && (
            <button
              type="button"
              onClick={() => void runQuery(offset)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <RefreshCcw size={13} />
              Refresh
            </button>
          )}
        </div>

        {!hasSearched ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-700">
              <Shield size={32} className="text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Set your filters and press Search to query the audit trail.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              All filters are optional — leaving them blank returns the latest 50 records.
            </p>
          </div>
        ) : isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Searching audit trail…
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            No records matched the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-semibold">Timestamp</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                  <th className="px-5 py-4 font-semibold">Entity</th>
                  <th className="px-5 py-4 font-semibold">Entity ID</th>
                  <th className="px-5 py-4 font-semibold">User ID</th>
                  <th className="px-5 py-4 font-semibold">Org ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((row, i) => (
                  <tr
                    key={`${String(row.id)}-${i}`}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDate(row.timestamp)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${actionBadge(row.action)}`}
                      >
                        {row.action ?? "UNKNOWN"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs font-mono text-slate-600 dark:text-slate-300">
                      {row.entity ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                      {row.entity_id ?? "—"}
                    </td>
                    <td className="px-5 py-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate">
                      {row.user_id ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                      {row.organisation_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700">
            <button
              type="button"
              disabled={currentPage <= 1 || isLoading}
              onClick={() => void runQuery(offset - PAGE_SIZE)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages || isLoading}
              onClick={() => void runQuery(offset + PAGE_SIZE)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
