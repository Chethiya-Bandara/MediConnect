import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AnomaliesSection } from "../sections/AnomaliesSection";
import { InvestigationSection } from "../sections/InvestigationSection";
import { PerformanceSection } from "../sections/PerformanceSection";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  LayoutDashboard,
  LogOut,
  Moon,
  PackagePlus,
  Pill,
  RefreshCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Stethoscope,
  Sun,
  Trash2,
  UserRoundCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBrandMark } from "../../../components/ui";
import { useAuth } from "../../auth/context/AuthContext";
import { updateHealthMinistryAdminProfile } from "../api/healthMinistryAdminApi";
import { useHealthMinistryAdminDashboard } from "../hooks/useHealthMinistryAdminDashboard";
import { SettingsSection } from "../sections/SettingsSection";
import type {
  ApprovalStatus,
  DeletionEntityType,
  DeletionRequest,
  GovernanceAction,
  GovernanceTargetType,
  ManagedMedicineItem,
  ManagedOrganisationItem,
  MonthlyReport,
  RegistryPersonItem,
} from "../types";

type DashboardView =
  | "overview"
  | "approvals"
  | "people"
  | "settings"
  | "organisations"
  | "medicines"
  | "analytics"
  | "audit"
  | "deletions"
  | "patientRegistry"
  | "anomalies"
  | "performance"
  | "investigation";
type ThemeMode = "light" | "dark";
type ApprovalEntityFilter = "doctors" | "admins";

const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "approvals", label: " User Approvals", icon: UserRoundCheck },
  { id: "deletions", label: "Deletion Requests", icon: ShieldAlert },
  { id: "patientRegistry", label: "Patient Registry", icon: Search },
  { id: "people", label: "Doctors & Admins Registry", icon: Users },
  { id: "organisations", label: "Organisation Registry", icon: Building2 },
  { id: "medicines", label: "Medicine Registry", icon: Pill },
  { id: "analytics", label: "Analytics & Reports", icon: BarChart3 },
  { id: "audit", label: "Audit Logs", icon: ClipboardList },
  { id: "anomalies", label: "Anomaly Flags", icon: AlertTriangle },
  { id: "performance", label: "Performance", icon: Clock },
  { id: "investigation", label: "Investigation Mode", icon: Search },
  { id: "settings", label: "Settings", icon: Settings },
] satisfies Array<{
  id: DashboardView;
  label: string;
  icon: typeof LayoutDashboard;
}>;

function formatDisplayDate(value: string | null | undefined) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLkr(value: number | null | undefined) {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(safeValue);
}

function noticeTone(message: string | null | undefined) {
  if (!message) return "neutral";
  const lowered = message.toLowerCase();
  if (
    lowered.includes("fail") ||
    lowered.includes("error") ||
    lowered.includes("invalid") ||
    lowered.includes("not found") ||
    lowered.includes("unavailable")
  ) {
    return "error";
  }
  return "success";
}

function noticeClassName(message: string | null | undefined) {
  const tone = noticeTone(message);
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300";
  }
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildInitials(name: string | null | undefined) {
  const safe = (name || "Ministry Admin").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "MA"
  );
}

function StatCard({
  label,
  value,
  note,
  icon: Icon,
  accent = false,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof LayoutDashboard;
  accent?: boolean;
  tone?: string;
}) {
  if (accent) {
    return (
      <article className="flex min-h-[168px] flex-col justify-between rounded-[1.75rem] bg-[#8d4401] p-6 text-white shadow-xl shadow-orange-900/15 dark:bg-orange-900/80">
        <div className="flex items-start justify-between">
          <div className="rounded-xl bg-white/20 p-2">
            <Icon size={18} />
          </div>
          <span className="rounded-full bg-white/20 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.24em]">
            Action Needed
          </span>
        </div>
        <div>
          <p className="text-3xl font-extrabold">{value}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-white/80">
            {label}
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="flex min-h-[168px] flex-col justify-between rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-2 ${tone}`}>
          <Icon size={18} />
        </div>
        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{note}</span>
      </div>
      <div>
        <p className="text-3xl font-extrabold">{value}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          {label}
        </p>
      </div>
    </article>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMonthlyReportDocument(report: MonthlyReport) {
  const renderList = (items: string[]) =>
    items.length > 0
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="muted">No items available.</p>`;

  const renderMetricCards = report.keyMetrics
    .map(
      (item) => `
        <div class="metric">
          <div class="metric-label">${escapeHtml(item.label)}</div>
          <div class="metric-value">${escapeHtml(item.value)}</div>
        </div>
      `,
    )
    .join("");

  const renderDiagnosisRows = report.topDiagnoses.length
    ? `
      <table>
        <thead><tr><th>Diagnosis</th><th>Count</th></tr></thead>
        <tbody>
          ${report.topDiagnoses
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.label)}</td>
                  <td>${item.count.toLocaleString("en-LK")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `
    : `<p class="muted">No diagnosis signal was available for this reporting window.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #172033; background: #eef4fb; }
    .page { max-width: 980px; margin: 0 auto; padding: 40px 32px 56px; }
    .sheet { background: #ffffff; border: 1px solid #d9e4f2; border-radius: 20px; padding: 32px; box-shadow: 0 18px 48px rgba(20, 38, 63, 0.08); }
    h1 { margin: 0; font-size: 30px; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    p { margin: 0; line-height: 1.7; }
    .sub { margin-top: 8px; color: #5e6c84; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
    .meta-card, .metric { background: #f7fafd; border: 1px solid #e3edf7; border-radius: 14px; padding: 14px 16px; }
    .label, .metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #6d7d96; font-weight: 700; }
    .value, .metric-value { margin-top: 8px; font-size: 18px; font-weight: 800; color: #18253b; }
    .grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px; margin-top: 24px; }
    .section { border: 1px solid #e3edf7; border-radius: 16px; padding: 20px; background: #fff; }
    .section.full { margin-top: 18px; }
    ul { margin: 0; padding-left: 20px; line-height: 1.7; }
    .metrics-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #ebf1f7; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #6d7d96; }
    .muted { color: #748399; }
    .footer { margin-top: 24px; font-size: 12px; color: #72839a; }
    @media print { body { background: white; } .page { padding: 0; } .sheet { box-shadow: none; border: 0; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="sheet">
      <h1>${escapeHtml(report.title)}</h1>
      <p class="sub">${escapeHtml(report.subtitle ?? "Ministry reporting document")}</p>
      <div class="meta">
        <div class="meta-card"><div class="label">Generated For</div><div class="value">${escapeHtml(report.generatedFor ?? "Health Ministry Admin")}</div></div>
        <div class="meta-card"><div class="label">Generated At</div><div class="value">${escapeHtml(formatDisplayDate(report.generatedAt))}</div></div>
        <div class="meta-card"><div class="label">Reporting Window</div><div class="value">${escapeHtml(report.reportingWindow ?? "Current cycle")}</div></div>
      </div>

      <div class="grid">
        <div class="section">
          <h2>Executive Summary</h2>
          ${renderList(report.executiveSummary)}
        </div>
        <div class="section">
          <h2>Top Diagnoses</h2>
          ${renderDiagnosisRows}
        </div>
      </div>

      <div class="section full">
        <h2>Key Metrics</h2>
        <div class="metrics-grid">${renderMetricCards}</div>
      </div>

      <div class="grid">
        <div class="section">
          <h2>Operational Highlights</h2>
          ${renderList(report.operationalHighlights)}
        </div>
        <div class="section">
          <h2>Risk & Watch Items</h2>
          ${renderList(report.riskItems)}
        </div>
      </div>

      <div class="grid">
        <div class="section">
          <h2>Recommendations</h2>
          ${renderList(report.recommendations)}
        </div>
        <div class="section">
          <h2>Data Limitations</h2>
          ${renderList(report.dataLimitations)}
        </div>
      </div>

      <div class="footer">Generated from MediConnect ministry analytics.</div>
    </div>
  </div>
</body>
</html>`;
}

type DashboardHook = ReturnType<typeof useHealthMinistryAdminDashboard>;

function statusBadge(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s === "pending")
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  if (s === "approved")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (s === "rejected") return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
  if (s === "suspended") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  if (s === "expired") return "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400";
  if (s === "deactivated") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
}

function timeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  return `${hours}h ${mins}m remaining`;
}

const approvalEntityOptions: Array<{
  value: ApprovalEntityFilter;
  label: string;
}> = [
  { value: "doctors", label: "Doctors" },
  { value: "admins", label: "Admin Roles" },
];

function DeletionsView({
  dashboard,
  formatDisplayDate,
}: {
  dashboard: DashboardHook;
  formatDisplayDate: (v: string | null | undefined) => string;
}) {
  const [requestSearch, setRequestSearch] = useState("");

  const filteredRequests = dashboard.deletionRequests.filter((r) => {
    const q = requestSearch.trim().toLowerCase();
    if (!q) return true;
    return [r.entityDisplayName, r.entityType, r.entityId, r.requestedByName, r.status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const pendingCount = dashboard.deletionRequests.filter((r) => r.status === "pending").length;

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Deletion Requests
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            All deactivations require a second Ministry admin to approve within 48 hours. Records
            are never removed — only access is revoked.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void dashboard.refreshDeletionRequests();
            void dashboard.refreshPeopleRegistries();
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
        >
          <RefreshCcw size={16} />
          Refresh
        </button>
      </header>

      {pendingCount > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          <Clock size={16} className="shrink-0" />
          <span>
            <span className="font-bold">
              {pendingCount} pending deletion request{pendingCount !== 1 ? "s" : ""}
            </span>{" "}
            awaiting a second admin's approval.
          </span>
        </div>
      ) : null}

      {dashboard.deletionMessage ? (
        <div
          className={`rounded-2xl border px-5 py-4 text-sm ${
            dashboard.deletionMessage.toLowerCase().includes("fail") ||
            dashboard.deletionMessage.toLowerCase().includes("error") ||
            dashboard.deletionMessage.toLowerCase().includes("cannot")
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300"
          }`}
        >
          {dashboard.deletionMessage}
        </div>
      ) : null}

      {/* Pending requests table */}
      <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-700 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-headline text-lg font-bold">All Deletion Requests</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Pending requests can only be approved by a{" "}
              <span className="font-semibold">different</span> Ministry admin from the one who
              submitted them.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <input
              type="text"
              value={requestSearch}
              onChange={(e) => setRequestSearch(e.target.value)}
              placeholder="Search entity, status, admin…"
              className="w-full rounded-xl border-0 bg-slate-100 px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
            />
            <Search className="absolute right-3 top-3 text-slate-400" size={16} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-5 py-4 font-semibold">Entity</th>
                <th className="px-5 py-4 font-semibold">Requested By</th>
                <th className="px-5 py-4 font-semibold">Submitted</th>
                <th className="px-5 py-4 font-semibold">Window</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Approved By</th>
                <th className="px-5 py-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((req: DeletionRequest) => {
                  const referenceId =
                    req.entityType === "hospital"
                    || req.entityType === "pharmacy"
                    || req.entityType === "organisation"
                      ? req.organisationId ?? req.entityId
                      : req.entityId;
                  return (
                  <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-4">
                      <div className="font-semibold">{req.entityDisplayName ?? req.entityId}</div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] uppercase dark:bg-slate-700">
                          {req.entityType}
                        </span>{" "}
                        #{referenceId}
                      </div>
                      {req.reason ? (
                        <div className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                          "{req.reason}"
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                      {req.requestedByName ?? "Unknown"}
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {formatDisplayDate(req.requestedAt)}
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {req.status === "pending" ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {timeRemaining(req.expiresAt)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(req.status)}`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                      {req.approvedByName ? (
                        <>
                          {req.approvedByName}
                          <div className="text-xs">{formatDisplayDate(req.approvedAt)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {req.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          {req.canApprove ? (
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingDeletion}
                              onClick={() => void dashboard.submitDeletionApproval(req.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
                            >
                              <CheckCircle2 size={13} />
                              Approve
                            </button>
                          ) : (
                            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                              Your request
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={dashboard.isSubmittingDeletion}
                            onClick={() => void dashboard.submitDeletionCancel(req.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                          >
                            <XCircle size={13} />
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            No action
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-slate-500 dark:text-slate-400"
                  >
                    {dashboard.isLoadingDeletions
                      ? "Loading deletion requests…"
                      : requestSearch
                        ? "No requests matched your search."
                        : "No deletion requests yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </section>
  );
}

function PatientRegistryView({
  dashboard,
  formatDisplayDate,
}: {
  dashboard: DashboardHook;
  formatDisplayDate: (v: string | null | undefined) => string;
}) {
  const [query, setQuery] = useState("");

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    await dashboard.lookupPatientRegistry(trimmed);
  };

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Patient Registry
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Search by a full DHID or full NIC to find one patient record, then activate or
            deactivate that patient account.
          </p>
        </div>
      </header>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_auto]">
          <label className="space-y-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              <Search size={14} />
              Patient Lookup
            </span>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder="Enter full DHID or NIC"
              className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={dashboard.isSearchingPatientRegistry || !query.trim()}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 dark:bg-slate-700"
          >
            {dashboard.isSearchingPatientRegistry ? "Searching..." : "Search Patient"}
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Full match only. Type the complete DHID or NIC.
        </p>
      </section>

      {dashboard.patientRegistryMessage ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${noticeClassName(dashboard.patientRegistryMessage)}`}>
          {dashboard.patientRegistryMessage}
        </div>
      ) : null}

      <section className="space-y-4">
        {dashboard.patientRegistryResults.length > 0 ? (
          dashboard.patientRegistryResults.map((patient) => {
            const statusLower = (patient.status ?? "").toLowerCase();
            const nextStatus = statusLower === "deactivated" ? "active" : "deactivated";

            return (
              <article
                key={patient.patientId}
                className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Matched Patient
                      </p>
                      <h2 className="mt-2 font-headline text-2xl font-extrabold">
                        {patient.preferredName ?? patient.name ?? "Unnamed patient"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Legal name: {patient.legalName ?? "Not set"}
                      </p>
                    </div>

                    <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">DHID:</span>{" "}
                        {patient.dhid ?? "Not set"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">NIC:</span>{" "}
                        {patient.nic ?? "Not set"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">Email:</span>{" "}
                        {patient.email ?? "Not set"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">Role:</span>{" "}
                        {formatStatusLabel(patient.role ?? "patient")}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">Address:</span>{" "}
                        {patient.address ?? "Not set"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">Joined:</span>{" "}
                        {formatDisplayDate(patient.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-[220px] flex-col items-start gap-3 lg:items-end">
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(patient.status)}`}
                    >
                      {formatStatusLabel(patient.status ?? "unknown")}
                    </span>
                    <button
                      type="button"
                      disabled={dashboard.isSubmittingPatientRegistry}
                      onClick={() =>
                        void dashboard.submitPatientRegistryStatus(
                          patient.userId,
                          nextStatus,
                          query.trim(),
                        )
                      }
                      className={`rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${
                        nextStatus === "active" ? "bg-emerald-600" : "bg-red-600"
                      }`}
                    >
                      {dashboard.isSubmittingPatientRegistry
                        ? "Applying..."
                        : nextStatus === "active"
                          ? "Activate Patient"
                          : "Deactivate Patient"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            Search with a full DHID or NIC to load a patient record here.
          </div>
        )}
      </section>
    </section>
  );
}

function roleLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PeopleManagementView({
  dashboard,
  doctors,
  adminUsers,
  onRefresh,
  onDoctorDecision,
  onAdminDecision,
  onAdminDeleteRequest,
  onDoctorDeleteRequest,
  formatDisplayDate,
}: {
  dashboard: DashboardHook;
  doctors: RegistryPersonItem[];
  adminUsers: RegistryPersonItem[];
  onRefresh: () => void;
  onDoctorDecision: (status: ApprovalStatus, targetId: string) => void;
  onAdminDecision: (status: ApprovalStatus, targetId: string, label?: string | null) => void;
  onAdminDeleteRequest: (person: RegistryPersonItem) => void;
  onDoctorDeleteRequest: (person: RegistryPersonItem) => void;
  formatDisplayDate: (v: string | null | undefined) => string;
}) {
  const [doctorSearch, setDoctorSearch] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminRoleFilter, setAdminRoleFilter] = useState("ALL");

  const filteredDoctors = useMemo(() => {
    const q = doctorSearch.trim().toLowerCase();
    return doctors.filter((row) => {
      const statusLower = (row.status ?? "").toLowerCase();
      if (statusLower === "deactivated" || statusLower === "rejected") {
        return false;
      }
      if (!q) return true;
      return [row.name, row.email, row.id, row.specialization, row.slmcNumber, row.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [doctorSearch, doctors]);

  const filteredAdminUsers = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    return adminUsers.filter((row) => {
      const statusLower = (row.status ?? "").toLowerCase();
      if (statusLower === "deactivated" || statusLower === "rejected") {
        return false;
      }
      const matchesRole =
        adminRoleFilter === "ALL" || (row.adminRole ?? "").toLowerCase() === adminRoleFilter;
      if (!matchesRole) return false;
      if (!q) return true;
      return [
        row.name,
        row.email,
        row.id,
        row.adminRole,
        row.organisationName,
        row.organisationId,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [adminRoleFilter, adminSearch, adminUsers]);

  const doctorPendingCount = doctors.filter((row) => (row.status ?? "").toLowerCase() === "pending").length;
  const adminPendingCount = adminUsers.filter((row) => (row.status ?? "").toLowerCase() === "pending").length;

  return (
    <section className="space-y-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight">
            Doctors & Admin Roles
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Approve, suspend, reject, or send deletion requests for doctor accounts and Ministry-managed
            admin roles.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
        >
          <RefreshCcw size={16} />
          Refresh People
        </button>
      </header>

      {dashboard.usersMessage ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${noticeClassName(dashboard.usersMessage)}`}>
          {dashboard.usersMessage}
        </div>
      ) : null}
      {dashboard.deletionMessage ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${noticeClassName(dashboard.deletionMessage)}`}>
          {dashboard.deletionMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Doctors under review
          </p>
          <p className="mt-3 text-3xl font-extrabold">{doctorPendingCount.toLocaleString("en-LK")}</p>
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Admin roles under review
          </p>
          <p className="mt-3 text-3xl font-extrabold">{adminPendingCount.toLocaleString("en-LK")}</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-headline text-lg font-bold">Doctors</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Only approved doctors can log in. Pending, suspended, and rejected stay blocked.
              </p>
            </div>
            <div className="relative w-full max-w-sm">
              <input
                type="text"
                value={doctorSearch}
                onChange={(event) => setDoctorSearch(event.target.value)}
                placeholder="Search doctor, SLMC, email…"
                className="w-full rounded-xl border-0 bg-slate-100 px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
              />
              <Search className="absolute right-3 top-3 text-slate-400" size={16} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-semibold">Doctor</th>
                  <th className="px-5 py-4 font-semibold">SLMC / Specialty</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Joined</th>
                  <th className="px-5 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filteredDoctors.length > 0 ? (
                  filteredDoctors.map((row) => {
                    const statusLower = (row.status ?? "").toLowerCase();
                    const isDeactivated = statusLower === "deactivated";
                    const displayName = row.name ?? row.email ?? `Doctor ${row.id}`;
                    return (
                      <tr key={row.id} className={isDeactivated ? "opacity-60" : ""}>
                        <td className="px-5 py-4">
                          <div className="font-semibold">{displayName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {row.email ?? "No email"}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                          <div>{row.slmcNumber ? `SLMC: ${row.slmcNumber}` : "SLMC not set"}</div>
                          <div className="mt-1">{row.specialization ?? "Specialization not set"}</div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(row.status)}`}>
                            {row.status ?? "unknown"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                          {formatDisplayDate(row.createdAt)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "approved"}
                              onClick={() => onDoctorDecision("approved", row.id)}
                              className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "suspended"}
                              onClick={() => onDoctorDecision("suspended", row.id)}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-300"
                            >
                              Suspend
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "rejected"}
                              onClick={() => onDoctorDecision("rejected", row.id)}
                              className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-900/20 dark:text-rose-300"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingDeletion || isDeactivated}
                              onClick={() => onDoctorDeleteRequest(row)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-slate-500 dark:text-slate-400">
                      {dashboard.isLoadingRegistry
                        ? "Loading doctors…"
                        : doctorSearch
                          ? "No doctors matched the current search."
                          : "No doctors available yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-headline text-lg font-bold">Admin Roles</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Manage health ministry, hospital admin, and pharmacy admin accounts from one place.
                </p>
              </div>
              <div className="flex w-full max-w-md gap-3">
                <select
                  value={adminRoleFilter}
                  onChange={(event) => setAdminRoleFilter(event.target.value)}
                  className="rounded-xl border-0 bg-slate-100 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                >
                  <option value="ALL">All roles</option>
                  <option value="health_ministry_admin">MOH Admin</option>
                  <option value="hospital_admin">Hospital Admin</option>
                  <option value="pharmacy_admin">Pharmacy Admin</option>
                </select>
                <div className="relative w-full">
                  <input
                    type="text"
                    value={adminSearch}
                    onChange={(event) => setAdminSearch(event.target.value)}
                    placeholder="Search admin, org, email…"
                    className="w-full rounded-xl border-0 bg-slate-100 px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  />
                  <Search className="absolute right-3 top-3 text-slate-400" size={16} />
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-semibold">Admin</th>
                  <th className="px-5 py-4 font-semibold">Role</th>
                  <th className="px-5 py-4 font-semibold">Organisation</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filteredAdminUsers.length > 0 ? (
                  filteredAdminUsers.map((row) => {
                    const statusLower = (row.status ?? "").toLowerCase();
                    const isDeactivated = statusLower === "deactivated";
                    const displayName = row.name ?? row.email ?? `Admin ${row.id}`;
                    return (
                      <tr key={row.id} className={isDeactivated ? "opacity-60" : ""}>
                        <td className="px-5 py-4">
                          <div className="font-semibold">{displayName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {row.email ?? "No email"}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                          {roleLabel(row.adminRole ?? row.id)}
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                          {row.organisationName
                            ? `${row.organisationName}${row.organisationId ? ` (#${row.organisationId})` : ""}`
                            : row.organisationId
                              ? `Organisation #${row.organisationId}`
                              : "National scope"}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(row.status)}`}>
                            {row.status ?? "unknown"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "approved"}
                              onClick={() => onAdminDecision("approved", row.id, displayName)}
                              className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "suspended"}
                              onClick={() => onAdminDecision("suspended", row.id, displayName)}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-300"
                            >
                              Suspend
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingApproval || isDeactivated || statusLower === "rejected"}
                              onClick={() => onAdminDecision("rejected", row.id, displayName)}
                              className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-900/20 dark:text-rose-300"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={dashboard.isSubmittingDeletion || isDeactivated}
                              onClick={() => onAdminDeleteRequest(row)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-slate-500 dark:text-slate-400">
                      {dashboard.isLoadingRegistry
                        ? "Loading admin roles…"
                        : adminSearch || adminRoleFilter !== "ALL"
                          ? "No admin roles matched the current filters."
                          : "No admin accounts available yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

export function HealthMinistryAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const dashboard = useHealthMinistryAdminDashboard();

  const [view, setView] = useState<DashboardView>("overview");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [profileSaveMessage, setProfileSaveMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [organisationSearch, setOrganisationSearch] = useState("");
  const [newOrganisationName, setNewOrganisationName] = useState("");
  const [newOrganisationType, setNewOrganisationType] = useState("hospital");
  const [governanceTargetId, setGovernanceTargetId] = useState("");
  const [governanceTargetType, setGovernanceTargetType] =
    useState<GovernanceTargetType>("ORGANIZATION");
  const [governanceAction, setGovernanceAction] = useState<GovernanceAction>("SUSPEND");
  const [auditSearch, setAuditSearch] = useState("");
  const [approvalsSearch, setApprovalsSearch] = useState("");
  const [approvalEntityFilter, setApprovalEntityFilter] =
    useState<ApprovalEntityFilter>("doctors");
  const [analyticsExportMessage, setAnalyticsExportMessage] = useState<string | null>(null);
  const [auditRoleFilter, setAuditRoleFilter] = useState("ALL");
  const [auditActionFilter, setAuditActionFilter] = useState("ALL");
  const [reportDownloadMessage, setReportDownloadMessage] = useState<string | null>(null);
  const [auditExportMessage, setAuditExportMessage] = useState<string | null>(null);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [newMedicineName, setNewMedicineName] = useState("");
  const [newMedicineUnit, setNewMedicineUnit] = useState("");
  const [newWholesalePrice, setNewWholesalePrice] = useState("");
  const [newRetailPrice, setNewRetailPrice] = useState("");
  const [medicineDrafts, setMedicineDrafts] = useState<
    Record<
      string,
      {
        name: string;
        unit: string;
        wholesalePrice: string;
        retailPrice: string;
      }
    >
  >({});

  useEffect(() => {
    if (view === "people" || view === "deletions") {
      void dashboard.refreshPeopleRegistries();
    }
    if (view === "deletions") {
      void dashboard.refreshDeletionRequests();
    }
  }, [view]);

  const deferredAuditSearch = useDeferredValue(auditSearch.trim().toLowerCase());
  const deferredApprovalSearch = useDeferredValue(approvalsSearch.trim().toLowerCase());
  const deferredOrganisationSearch = useDeferredValue(organisationSearch.trim().toLowerCase());
  const deferredMedicineSearch = useDeferredValue(medicineSearch.trim().toLowerCase());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("health-ministry-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("health-ministry-theme", theme);
  }, [theme]);

  useEffect(() => {
    setMedicineDrafts(
      Object.fromEntries(
        dashboard.managedMedicines.map((row) => [
          row.id,
          {
            name: row.name ?? "",
            unit: row.unit ?? "",
            wholesalePrice: String(row.wholesalePrice ?? 0),
            retailPrice: String(row.retailPrice ?? 0),
          },
        ]),
      ),
    );
  }, [dashboard.managedMedicines]);

  const topDiagnosis = dashboard.topDiagnoses[0]?.code ?? "No diagnosis feed yet";
  const userDisplayName = user?.preferredName || "Ministry Admin";
  const userInitials = buildInitials(user?.name ?? user?.preferredName ?? "Ministry Admin");
  const totalPendingApprovals =
    dashboard.dashboardStats.pendingDoctors +
    dashboard.dashboardStats.pendingOrganisations +
    dashboard.dashboardStats.pendingAdmins;

  const stats = useMemo(
    () => [
      {
        label: "Registered Patients",
        value: dashboard.dashboardStats.totalPatients.toLocaleString("en-LK"),
        note: "Live",
        icon: Users,
        tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
      },
      {
        label: "Registered Doctors",
        value: dashboard.dashboardStats.totalDoctors.toLocaleString("en-LK"),
        note: `${dashboard.dashboardStats.pendingDoctors} pending`,
        icon: Stethoscope,
        tone: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
      },
      {
        label: "Organisations",
        value: dashboard.dashboardStats.totalOrganisations.toLocaleString("en-LK"),
        note: `${dashboard.dashboardStats.pendingOrganisations} pending`,
        icon: Building2,
        tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
      },
      {
        label: "Pending Approvals",
        value: totalPendingApprovals.toLocaleString("en-LK"),
        note: "Action Needed",
        icon: ClipboardList,
        accent: true,
      },
    ],
    [dashboard.dashboardStats, totalPendingApprovals],
  );

  const filteredAuditLogs = useMemo(() => {
    return dashboard.auditLogs.filter((row) => {
      const matchesSearch =
        !deferredAuditSearch ||
        [row.actorName, row.actorRole, row.organisationName, row.action, row.details]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(deferredAuditSearch);
      const matchesRole =
        auditRoleFilter === "ALL" || (row.actorRole ?? "Unknown") === auditRoleFilter;
      const matchesAction =
        auditActionFilter === "ALL" || (row.action ?? "UNKNOWN") === auditActionFilter;
      return matchesSearch && matchesRole && matchesAction;
    });
  }, [auditActionFilter, auditRoleFilter, dashboard.auditLogs, deferredAuditSearch]);

  const filteredPendingDoctors = useMemo(() => {
    return dashboard.pendingDoctors.filter((row) => {
      const haystack = [
        row.preferredName,
        row.name,
        row.email,
        row.doctorId,
        row.specialization,
        row.slmcNumber,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !deferredApprovalSearch || haystack.includes(deferredApprovalSearch);
    });
  }, [approvalEntityFilter, dashboard.pendingDoctors, deferredApprovalSearch]);

  const filteredPendingAdmins = useMemo(() => {
    return dashboard.pendingAdmins.filter((row) => {
      const haystack = [
        row.preferredName,
        row.name,
        row.email,
        row.userId,
        row.adminRole,
        row.role,
        row.organisationId,
        row.organisationName,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !deferredApprovalSearch || haystack.includes(deferredApprovalSearch);
    });
  }, [approvalEntityFilter, dashboard.pendingAdmins, deferredApprovalSearch]);

  const pendingAdminsOnly = filteredPendingAdmins.filter(
    (row) => (row.status ?? "").toLowerCase() === "pending"
  );

  const filteredManagedOrganisations = useMemo(() => {
    return dashboard.managedOrganisations.filter((row) => {
      const statusLower = (row.status ?? "").toLowerCase();
      if (statusLower === "deactivated" || statusLower === "rejected") {
        return false;
      }
      const haystack = [row.name, row.id, row.type, row.status, row.linkedTable]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !deferredOrganisationSearch || haystack.includes(deferredOrganisationSearch);
    });
  }, [dashboard.managedOrganisations, deferredOrganisationSearch]);

  const filteredHospitalOrganisations = useMemo(
    () =>
      filteredManagedOrganisations.filter(
        (row) => (row.type ?? "").trim().toLowerCase() === "hospital",
      ),
    [filteredManagedOrganisations],
  );

  const filteredPharmacyOrganisations = useMemo(
    () =>
      filteredManagedOrganisations.filter(
        (row) => (row.type ?? "").trim().toLowerCase() === "pharmacy",
      ),
    [filteredManagedOrganisations],
  );

  const filteredManagedMedicines = useMemo(() => {
    return dashboard.managedMedicines.filter((row) => {
      const haystack = [row.id, row.name, row.unit, row.wholesalePrice, row.retailPrice]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !deferredMedicineSearch || haystack.includes(deferredMedicineSearch);
    });
  }, [dashboard.managedMedicines, deferredMedicineSearch]);

  const organisationRegistryStats = useMemo(() => {
    const counts = {
      active: 0,
      pending: 0,
      suspended: 0,
    };

    for (const row of dashboard.managedOrganisations) {
      const normalized = (row.status ?? "").toLowerCase();
      if (normalized === "suspended") {
        counts.suspended += 1;
      } else if (normalized === "pending") {
        counts.pending += 1;
      } else if (normalized === "active" || normalized === "approved") {
        counts.active += 1;
      }
    }

    return counts;
  }, [dashboard.managedOrganisations]);

  const medicineRegistryStats = useMemo(() => {
    const totalMedicines = dashboard.managedMedicines.length;
    const stockedCatalogLinks = dashboard.managedMedicines.filter(
      (row) => row.inventoryLinks > 0,
    ).length;
    const totalRetail = dashboard.managedMedicines.reduce(
      (sum, row) => sum + (row.retailPrice ?? 0),
      0,
    );
    const totalWholesale = dashboard.managedMedicines.reduce(
      (sum, row) => sum + (row.wholesalePrice ?? 0),
      0,
    );

    return {
      totalMedicines,
      stockedCatalogLinks,
      averageRetail: totalMedicines > 0 ? totalRetail / totalMedicines : 0,
      averageWholesale: totalMedicines > 0 ? totalWholesale / totalMedicines : 0,
    };
  }, [dashboard.managedMedicines]);

  const auditRoleOptions = useMemo(
    () => Array.from(new Set(dashboard.auditLogs.map((row) => row.actorRole ?? "Unknown"))).sort(),
    [dashboard.auditLogs],
  );

  const auditActionOptions = useMemo(
    () => Array.from(new Set(dashboard.auditLogs.map((row) => row.action ?? "UNKNOWN"))).sort(),
    [dashboard.auditLogs],
  );

  const analyticsRangeMessage = useMemo(() => {
    if (!dashboard.filters.startDate || !dashboard.filters.endDate) {
      return "Pick both a start date and an end date before refreshing analytics.";
    }

    if (dashboard.filters.endDate < dashboard.filters.startDate) {
      return "End date has to be on or after the start date.";
    }

    return null;
  }, [dashboard.filters.endDate, dashboard.filters.startDate]);

  const incidencePeak = dashboard.incidence[0] ?? null;
  const incidenceTotal = dashboard.incidence.reduce((sum, item) => sum + item.count, 0);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleProfileSave = async (payload: { preferredName: string; address: string }) => {
    setIsSavingProfile(true);
    setProfileSaveMessage(null);

    try {
      const response = await updateHealthMinistryAdminProfile({
        preferred_name: payload.preferredName.trim(),
        address: payload.address.trim(),
      });
      const nextUser = response.user;
      if (nextUser) {
        updateUser({
          name: nextUser.name ?? user?.name ?? "Ministry Admin",
          preferredName: nextUser.preferred_name ?? payload.preferredName.trim(),
          legalName: nextUser.legal_name ?? user?.legalName ?? null,
          address: nextUser.address ?? payload.address.trim(),
          status: nextUser.status ?? user?.status ?? null,
          organisationId: nextUser.organisation_id ?? user?.organisationId ?? null,
          organisationName: nextUser.organisation_name ?? user?.organisationName ?? null,
          organisationType: nextUser.organisation_type ?? user?.organisationType ?? null,
          organisationStatus: nextUser.organisation_status ?? user?.organisationStatus ?? null,
          adminRole: nextUser.admin_role ?? user?.adminRole ?? null,
        });
      }
      setProfileSaveMessage(response.message ?? "Settings saved.");
    } catch (error) {
      setProfileSaveMessage(
        error instanceof Error ? error.message : "Ministry admin settings could not be saved.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDoctorDecision = async (status: ApprovalStatus, targetId: string) => {
    const resolvedId = targetId.trim();
    if (!resolvedId) return;
    const actionLabel =
      status === "approved"
        ? "Approve"
        : status === "rejected"
          ? "Reject"
          : status === "suspended"
            ? "Suspend"
            : "Move back to pending";
    const confirmed = window.confirm(
      `${actionLabel} doctor ${resolvedId}?`,
    );
    if (!confirmed) return;
    await dashboard.submitDoctorApproval(resolvedId, status);
  };

  const handleAdminDecision = async (
    status: ApprovalStatus,
    targetId: string,
    label?: string | null,
  ) => {
    if (!targetId.trim()) return;

    const actionLabel =
      status === "approved"
        ? "Approve"
        : status === "rejected"
          ? "Reject"
          : status === "pending"
            ? "Move back to pending"
            : "Suspend";
    const confirmed = window.confirm(`${actionLabel} admin account ${label ?? targetId}?`);
    if (!confirmed) return;
    await dashboard.submitAdminApproval(targetId, status);
  };

  const handleGovernanceAction = async () => {
    const trimmedTarget = governanceTargetId.trim();
    if (!trimmedTarget) return;
    const confirmed = window.confirm(
      `${governanceAction === "SUSPEND" ? "Suspend" : "Reactivate"} ${governanceTargetType.toLowerCase()} ${trimmedTarget}?`,
    );
    if (!confirmed) return;
    await dashboard.submitUserAction(trimmedTarget, governanceTargetType, governanceAction);
  };

  const handleOrganisationCreate = async () => {
    const trimmedName = newOrganisationName.trim();
    if (!trimmedName) return;

    const created = await dashboard.submitOrganisationCreate({
      name: trimmedName,
      type: newOrganisationType,
      status: "active",
    });

    if (created) {
      setNewOrganisationName("");
      setNewOrganisationType("hospital");
    }
  };

  const handleOrganisationRegistryAction = async (
    row: ManagedOrganisationItem,
    action: GovernanceAction,
  ) => {
    const actionLabel =
      action === "ACTIVATE" ? "Active" : "Suspend";
    const confirmed = window.confirm(
      `${actionLabel} ${row.name ?? `organisation ${row.id}`}?`,
    );
    if (!confirmed) return;
    await dashboard.submitUserAction(row.id, "ORGANIZATION", action);
  };

  const updateMedicineDraft = (
    medicineId: string,
    field: "name" | "unit" | "wholesalePrice" | "retailPrice",
    value: string,
  ) => {
    setMedicineDrafts((current) => ({
      ...current,
      [medicineId]: {
        name: field === "name" ? value : (current[medicineId]?.name ?? ""),
        unit: field === "unit" ? value : (current[medicineId]?.unit ?? ""),
        wholesalePrice:
          field === "wholesalePrice" ? value : (current[medicineId]?.wholesalePrice ?? "0"),
        retailPrice: field === "retailPrice" ? value : (current[medicineId]?.retailPrice ?? "0"),
      },
    }));
  };

  const handleMedicineCreate = async () => {
    if (
      !newMedicineName.trim() ||
      !newMedicineUnit.trim() ||
      !newWholesalePrice.trim() ||
      !newRetailPrice.trim()
    ) {
      return;
    }

    const created = await dashboard.submitMedicineCreate({
      name: newMedicineName.trim(),
      unit: newMedicineUnit.trim(),
      wholesalePrice: Number(newWholesalePrice),
      retailPrice: Number(newRetailPrice),
    });

    if (created) {
      setNewMedicineName("");
      setNewMedicineUnit("");
      setNewWholesalePrice("");
      setNewRetailPrice("");
    }
  };

  const handleMedicineSave = async (row: ManagedMedicineItem) => {
    const draft = medicineDrafts[row.id];
    if (!draft) return;

    await dashboard.submitMedicineUpdate(row.id, {
      name: draft.name.trim(),
      unit: draft.unit.trim(),
      wholesalePrice: Number(draft.wholesalePrice),
      retailPrice: Number(draft.retailPrice),
    });
  };

  const handleMedicineDelete = async (row: ManagedMedicineItem) => {
    const confirmed = window.confirm(
      `Request deactivation of ${row.name ?? `medicine ${row.id}`}?\n\nThis will create a pending deletion request that requires a second Ministry admin to approve within 48 hours. The record will not be removed from the database.`,
    );
    if (!confirmed) return;
    await dashboard.submitDeletionRequest({
      entityType: "medicine",
      entityId: row.id,
      entityDisplayName: row.name ?? `Medicine #${row.id}`,
    });
    setView("deletions");
    void dashboard.refreshDeletionRequests();
  };

  const handleOrganisationDeleteRequest = async (row: ManagedOrganisationItem) => {
    const orgType = (
      row.linkedTable === "hospitals"
        ? "hospital"
        : row.linkedTable === "pharmacies"
          ? "pharmacy"
          : "organisation"
    ) as DeletionEntityType;
    const entityId =
      orgType !== "organisation" && row.linkedRecordId != null
        ? String(row.linkedRecordId)
        : row.id;
    const confirmed = window.confirm(
      `Request deactivation of ${row.name ?? `organisation ${row.id}`}?\n\nThis will create a pending deletion request that requires a second Ministry admin to approve within 48 hours. All records are preserved.`,
    );
    if (!confirmed) return;
    await dashboard.submitDeletionRequest({
      entityType: orgType,
      entityId,
      entityDisplayName: row.name ?? `${orgType} #${entityId}`,
    });
    setView("deletions");
    void dashboard.refreshDeletionRequests();
  };

  const handlePersonDeleteRequest = async (
    person: RegistryPersonItem,
    entityType: DeletionEntityType,
  ) => {
    const displayName = person.name ?? person.email ?? `${entityType} #${person.id}`;
    const confirmed = window.confirm(
      `Request deactivation of ${displayName}?\n\nThis will revoke their access and create a pending deletion request that requires a second Ministry admin to approve within 48 hours. All records are preserved.`,
    );
    if (!confirmed) return;
    await dashboard.submitDeletionRequest({
      entityType,
      entityId: person.id,
      entityDisplayName: displayName,
    });
    setView("deletions");
    void dashboard.refreshDeletionRequests();
  };

  const handleAdminDeleteRequest = async (person: RegistryPersonItem) => {
    const adminRole = (person.adminRole ?? "").trim().toLowerCase();
    const entityType: DeletionEntityType =
      adminRole === "pharmacy_admin"
        ? "pharmacy_admin"
        : adminRole === "health_ministry_admin"
          ? "health_ministry_admin"
          : "hospital_admin";
    await handlePersonDeleteRequest(person, entityType);
  };

  const exportAuditLogs = () => {
    if (filteredAuditLogs.length === 0) {
      setAuditExportMessage(
        "Nothing matched the current audit filters, so there is nothing useful to export.",
      );
      return;
    }

    downloadCsv("health-ministry-audit-logs.csv", [
      ["Timestamp", "Actor", "Role", "Organisation", "Action", "Details"],
      ...filteredAuditLogs.map((row) => [
        row.timestamp ?? "",
        row.actorName ?? row.actorId ?? "",
        row.actorRole ?? "",
        row.organisationName ?? "",
        row.action ?? "",
        row.details ?? "",
      ]),
    ]);
    setAuditExportMessage(`Exported ${filteredAuditLogs.length} audit row(s) to CSV.`);
  };

  const exportIncidenceCsv = () => {
    if (dashboard.incidence.length === 0) {
      setAnalyticsExportMessage(
        "No incidence rows are available for the current filter range, so there is nothing useful to export.",
      );
      return;
    }

    downloadCsv("health-ministry-incidence.csv", [
      ["Diagnosis", "Count"],
      ...dashboard.incidence.map((row) => [row.code, row.count.toString()]),
    ]);
    setAnalyticsExportMessage(`Exported ${dashboard.incidence.length} analytics row(s) to CSV.`);
  };

  const generateAndDownloadReport = async () => {
    setReportDownloadMessage(null);
    const response = await dashboard.requestMonthlyReport();
    if (!response?.report) {
      setReportDownloadMessage(
        "Monthly report generation failed, so there was nothing real to download.",
      );
      return;
    }

    const documentHtml = buildMonthlyReportDocument(response.report);
    const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "health-ministry-monthly-report.html";
    link.click();
    window.URL.revokeObjectURL(url);
    setReportDownloadMessage("Generated and downloaded the monthly report document.");
  };

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <div className="min-h-screen bg-[#f7fafc] font-body text-[#181c1e] antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sky-200/60 bg-sky-100 px-4 py-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8 px-2">
            <AppBrandMark subtitle="Ministry Admin" />
          </div>

          <nav className="flex-1 space-y-1 text-sm font-medium">
            {views.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                    active
                      ? "bg-blue-100 text-blue-900 shadow-sm dark:bg-blue-900/50 dark:text-blue-100"
                      : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-1 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2 text-left text-xs text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </aside>

        <header className="fixed left-64 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/85 px-8 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
          <div className="flex items-center gap-4">
            <span className="font-headline text-[1.45rem] font-extrabold uppercase tracking-[0.08em] text-blue-900 dark:text-blue-400 sm:text-[1.75rem]">
              National Health Portal
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
              className="rounded-full p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-300"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/70">
              <div className="text-right">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {userDisplayName}
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Ministry Admin
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-300 bg-blue-100 font-bold text-blue-700 dark:border-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {userInitials}
              </div>
            </div>
          </div>
        </header>

        <main className="ml-64 min-h-screen px-8 pb-12 pt-24">
          {dashboard.dashboardError ? (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              {dashboard.dashboardError}
            </div>
          ) : null}

          {view === "overview" ? (
            <section className="space-y-10">
              <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h1 className="font-headline text-4xl font-extrabold tracking-tight">
                    National Admin Dashboard
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                    Strategic oversight and ecosystem management for the MediConnect national
                    digital health ministry workspace.
                  </p>
                </div>
                <div className="flex max-w-md gap-4 rounded-3xl border-l-4 border-cyan-600 bg-cyan-50 p-5 dark:border-blue-500 dark:bg-blue-900/20">
                  <Bot className="mt-1 text-cyan-700 dark:text-blue-400" size={20} />
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.28em] text-cyan-700 dark:text-blue-400">
                      AI Insights Summary
                    </p>
                    <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      Leading diagnosis feed says{" "}
                      <span className="font-semibold">{topDiagnosis}</span>. If this looks empty,
                      diagnosis telemetry is not available yet.
                    </p>
                  </div>
                </div>
              </header>

              <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                {stats.map((item) => (
                  <StatCard key={item.label} {...item} />
                ))}
              </section>

              <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
                <section className="space-y-6 xl:col-span-2">
                  <h2 className="px-2 font-headline text-xl font-bold">
                    National Oversight Snapshot
                  </h2>
                  <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="grid gap-5 md:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-900">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Audit Events 24h
                        </p>
                        <p className="mt-3 text-3xl font-extrabold">
                          {dashboard.dashboardStats.auditEvents24h.toLocaleString("en-LK")}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-900">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Pending Organisations
                        </p>
                        <p className="mt-3 text-3xl font-extrabold">
                          {dashboard.dashboardStats.pendingOrganisations.toLocaleString("en-LK")}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-900">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Pending Doctors
                        </p>
                        <p className="mt-3 text-3xl font-extrabold">
                          {dashboard.dashboardStats.pendingDoctors.toLocaleString("en-LK")}
                        </p>
                      </div>
                    </div>
                    {dashboard.isLoadingDashboard ? (
                      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        Refreshing governance data...
                      </div>
                    ) : null}
                  </div>
                </section>

                <aside className="space-y-6">
                  <h2 className="px-2 font-headline text-xl font-bold">Account Management</h2>
                  <div className="space-y-6 rounded-[2rem] border border-slate-200 bg-slate-100/70 p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="space-y-4">
                      <label className="block text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Identify Entity
                      </label>
                      <div className="relative">
                        <input
                          value={governanceTargetId}
                          onChange={(event) => setGovernanceTargetId(event.target.value)}
                          className="w-full rounded-xl border-0 bg-white px-4 py-4 pr-11 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                          placeholder="UID or organisation id"
                          type="text"
                        />
                        <Search
                          className="absolute right-4 top-4 text-slate-400 dark:text-slate-500"
                          size={18}
                        />
                      </div>
                    </div>

                    <select
                      value={governanceTargetType}
                      onChange={(event) =>
                        setGovernanceTargetType(event.target.value as GovernanceTargetType)
                      }
                      className="w-full rounded-xl border-0 bg-white px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="ORGANIZATION">Organization</option>
                      <option value="USER">User</option>
                    </select>

                    <select
                      value={governanceAction}
                      onChange={(event) =>
                        setGovernanceAction(event.target.value as GovernanceAction)
                      }
                      className="w-full rounded-xl border-0 bg-white px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="SUSPEND">Suspend</option>
                      <option value="ACTIVATE">Reactivate</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => void handleGovernanceAction()}
                      disabled={dashboard.isSubmittingUserAction || !governanceTargetId.trim()}
                      className="w-full rounded-2xl bg-red-600 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-red-900/10 transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {dashboard.isSubmittingUserAction ? "Applying..." : "Apply Action"}
                    </button>

                    {dashboard.usersMessage ? (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm ${noticeClassName(dashboard.usersMessage)}`}
                      >
                        {dashboard.usersMessage}
                      </div>
                    ) : null}
                  </div>
                </aside>
              </div>
            </section>
          ) : null}

          {view === "approvals" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    Pending Approvals
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Review onboarding requests using real pending data from the backend.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void dashboard.refreshDashboard()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                >
                  <RefreshCcw size={16} />
                  Refresh
                </button>
              </header>

              <section className="grid gap-4 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                    <Search size={14} />
                    Search queue
                  </span>
                  <input
                    type="text"
                    value={approvalsSearch}
                    onChange={(event) => setApprovalsSearch(event.target.value)}
                    placeholder="Name, email, user ID, doctor ID, org ID, specialty"
                    className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  />
                </label>
                <div className="space-y-2">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                    <Users size={14} />
                    Entity type
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {approvalEntityOptions.map((option) => {
                      const isActive = approvalEntityFilter === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setApprovalEntityFilter(option.value)}
                          className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                            isActive
                              ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {dashboard.approvalsMessage ? (
                  <div
                    className={`rounded-2xl border px-5 py-4 text-sm ${noticeClassName(dashboard.approvalsMessage)}`}
                  >
                    {dashboard.approvalsMessage}
                  </div>
                ) : null}

              <div className="space-y-8">

                {approvalEntityFilter === "doctors" ? (
                  <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-col gap-2 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                    <h2 className="font-headline text-lg font-bold">
                      Doctors ({filteredPendingDoctors.length})
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Doctor verification queue with specialty and SLMC context.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-6 py-4">Doctor</th>
                          <th className="px-6 py-4">Specialty</th>
                          <th className="px-6 py-4">SLMC</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {filteredPendingDoctors.length > 0 ? (
                          filteredPendingDoctors.map((row) => (
                            <tr key={row.doctorId}>
                              <td className="px-6 py-4">
                                <div className="font-semibold">
                                  {row.preferredName ?? row.name ?? `Doctor ${row.doctorId}`}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {row.email ?? "No email"}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {row.specialization ?? "Not set"}
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {row.slmcNumber ?? "Not set"}
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {formatStatusLabel(row.status ?? "pending")}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDoctorDecision("approved", row.doctorId)
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                                  >
                                    <CheckCircle2 size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDoctorDecision("rejected", row.doctorId)
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                  >
                                    <AlertTriangle size={18} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-6 py-8 text-center text-slate-500 dark:text-slate-400"
                            >
                              {deferredApprovalSearch
                                  ? "No doctor approvals matched your current search."
                                  : "No pending doctor approvals right now."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  </div>
                ) : null}

                {approvalEntityFilter === "admins" ? (
                  <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-col gap-2 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                    <h2 className="font-headline text-lg font-bold">
                      Admin Roles ({filteredPendingAdmins.length})
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Ministry-controlled approval queue for hospital, pharmacy, and ministry admin accounts.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-6 py-4">Admin</th>
                          <th className="px-6 py-4">Role</th>
                          <th className="px-6 py-4">Organisation</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {pendingAdminsOnly.length > 0 ? (
                          pendingAdminsOnly.map((row) => (
                            <tr key={row.userId}>
                              <td className="px-6 py-4">
                                <div className="font-semibold">
                                  {row.preferredName ?? row.name ?? row.email ?? `Admin ${row.userId}`}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {row.email ?? "No email"}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                                  User ID: {row.userId}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                  {formatStatusLabel(row.adminRole ?? row.role ?? "admin")}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {row.organisationName ?? row.organisationId ?? "National scope"}
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusBadge(row.status)}`}
                                >
                                  {formatStatusLabel(row.status ?? "pending")}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleAdminDecision(
                                        "approved",
                                        row.userId,
                                        row.preferredName ?? row.name ?? row.email,
                                      )
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                                    title="Approve"
                                  >
                                    <CheckCircle2 size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleAdminDecision(
                                        "rejected",
                                        row.userId,
                                        row.preferredName ?? row.name ?? row.email,
                                      )
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                                    title="Reject"
                                  >
                                    <XCircle size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleAdminDecision(
                                        "pending",
                                        row.userId,
                                        row.preferredName ?? row.name ?? row.email,
                                      )
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                    title="Set pending"
                                  >
                                    <Clock size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleAdminDecision(
                                        "suspended",
                                        row.userId,
                                        row.preferredName ?? row.name ?? row.email,
                                      )
                                    }
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                    title="Suspend"
                                  >
                                    <ShieldAlert size={18} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-6 py-8 text-center text-slate-500 dark:text-slate-400"
                            >
                              {deferredApprovalSearch
                                    ? "No admin approvals matched your current search."
                                    : "No pending admin approvals right now."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {view === "people" ? (
            <PeopleManagementView
              dashboard={dashboard}
              doctors={dashboard.doctorsRegistry}
              adminUsers={dashboard.hospitalAdminsRegistry}
              onRefresh={() => {
                void dashboard.refreshPeopleRegistries();
                void dashboard.refreshDashboard();
              }}
              onDoctorDecision={(status, targetId) => {
                void handleDoctorDecision(status, targetId);
              }}
              onAdminDecision={(status, targetId, label) => {
                void handleAdminDecision(status, targetId, label);
              }}
              onAdminDeleteRequest={(person) => {
                void handleAdminDeleteRequest(person);
              }}
              onDoctorDeleteRequest={(person) => {
                void handlePersonDeleteRequest(person, "doctor");
              }}
              formatDisplayDate={formatDisplayDate}
            />
          ) : null}

          {view === "organisations" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    Organisation Registry
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Create organisations centrally and flip them between active and suspended
                    states.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void dashboard.refreshDashboard()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                >
                  <RefreshCcw size={16} />
                  Refresh Registry
                </button>
              </header>

              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Total organisations
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {dashboard.managedOrganisations.length.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Active or approved
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {organisationRegistryStats.active.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Pending
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {organisationRegistryStats.pending.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Suspended
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {organisationRegistryStats.suspended.toLocaleString("en-LK")}
                  </p>
                </div>
              </div>

              <div className="space-y-8">
                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-headline text-lg font-bold">Create Organisation</h2>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Hospitals and pharmacies get their linked facility rows automatically.
                        Everything else stays as a clean organisation record.
                      </p>
                    </div>
                    <Building2 className="text-blue-700 dark:text-blue-400" size={20} />
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(180px,0.9fr)_minmax(180px,0.9fr)_minmax(220px,1fr)] xl:items-end">
                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Organisation name
                      </span>
                      <input
                        value={newOrganisationName}
                        onChange={(event) => setNewOrganisationName(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        placeholder="Test Hospital 3"
                        type="text"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Type
                      </span>
                      <select
                        value={newOrganisationType}
                        onChange={(event) => setNewOrganisationType(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                      >
                        <option value="hospital">Hospital</option>
                        <option value="pharmacy">Pharmacy</option>
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Initial status
                      </span>
                      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        Active
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleOrganisationCreate()}
                      disabled={dashboard.isCreatingOrganisation || !newOrganisationName.trim()}
                      className="w-full rounded-2xl bg-blue-700 px-5 py-4 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-blue-600 xl:self-end"
                    >
                      {dashboard.isCreatingOrganisation ? "Creating..." : "Create Organisation"}
                    </button>
                  </div>

                  {dashboard.organisationMessage ? (
                    <div
                      className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${noticeClassName(dashboard.organisationMessage)}`}
                    >
                      {dashboard.organisationMessage}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="font-headline text-lg font-bold">
                        Live Organisation Registry
                      </h2>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Search the current organisation records and toggle active or suspended state
                        per row.
                      </p>
                    </div>
                    <div className="relative w-full max-w-sm">
                      <input
                        type="text"
                        value={organisationSearch}
                        onChange={(event) => setOrganisationSearch(event.target.value)}
                        placeholder="Search name, type, id, status"
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 pr-11 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                      />
                      <Search
                        className="absolute right-4 top-3.5 text-slate-400 dark:text-slate-500"
                        size={18}
                      />
                    </div>
                  </div>

                  <div className="mt-6 grid gap-6 xl:grid-cols-2">
                    <section className="rounded-2xl border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                        <div>
                          <h3 className="font-headline text-base font-bold">Hospitals</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {filteredHospitalOrganisations.length.toLocaleString("en-LK")} matched
                          </p>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            <tr>
                              <th className="px-4 py-3 font-semibold">Organisation</th>
                              <th className="px-4 py-3 font-semibold">Status</th>
                              <th className="px-4 py-3 font-semibold">Created</th>
                              <th className="px-4 py-3 text-right font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {filteredHospitalOrganisations.length > 0 ? (
                              filteredHospitalOrganisations.map((row) => {
                                const statusLower = (row.status ?? "").toLowerCase();

                                return (
                                  <tr key={row.id}>
                                    <td className="px-4 py-4">
                                      <div className="font-semibold">
                                        {row.name ?? `Organisation ${row.id}`}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        ID: {row.id}
                                      </div>
                                    </td>
                                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                                      {formatStatusLabel(row.status)}
                                    </td>
                                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                                      {formatDisplayDate(row.createdAt)}
                                    </td>
                                    <td className="px-4 py-4">
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationRegistryAction(row, "ACTIVATE")}
                                          disabled={
                                            dashboard.isSubmittingUserAction
                                            || statusLower === "active"
                                            || statusLower === "approved"
                                          }
                                          className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300"
                                        >
                                          Active
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationRegistryAction(row, "SUSPEND")}
                                          disabled={dashboard.isSubmittingUserAction || statusLower === "suspended"}
                                          className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-300"
                                        >
                                          Suspend
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationDeleteRequest(row)}
                                          disabled={dashboard.isSubmittingDeletion}
                                          className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td
                                  colSpan={5}
                                  className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                                >
                                  {dashboard.isLoadingDashboard
                                    ? "Refreshing hospital registry..."
                                    : "No hospitals matched the current search."}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                        <div>
                          <h3 className="font-headline text-base font-bold">Pharmacies</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {filteredPharmacyOrganisations.length.toLocaleString("en-LK")} matched
                          </p>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            <tr>
                              <th className="px-4 py-3 font-semibold">Organisation</th>
                              <th className="px-4 py-3 font-semibold">Status</th>
                              <th className="px-4 py-3 font-semibold">Created</th>
                              <th className="px-4 py-3 text-right font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {filteredPharmacyOrganisations.length > 0 ? (
                              filteredPharmacyOrganisations.map((row) => {
                                const statusLower = (row.status ?? "").toLowerCase();

                                return (
                                  <tr key={row.id}>
                                    <td className="px-4 py-4">
                                      <div className="font-semibold">
                                        {row.name ?? `Organisation ${row.id}`}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        ID: {row.id}
                                      </div>
                                    </td>
                                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                                      {formatStatusLabel(row.status)}
                                    </td>
                                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                                      {formatDisplayDate(row.createdAt)}
                                    </td>
                                    <td className="px-4 py-4">
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationRegistryAction(row, "ACTIVATE")}
                                          disabled={
                                            dashboard.isSubmittingUserAction
                                            || statusLower === "active"
                                            || statusLower === "approved"
                                          }
                                          className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300"
                                        >
                                          Active
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationRegistryAction(row, "SUSPEND")}
                                          disabled={dashboard.isSubmittingUserAction || statusLower === "suspended"}
                                          className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-300"
                                        >
                                          Suspend
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleOrganisationDeleteRequest(row)}
                                          disabled={dashboard.isSubmittingDeletion}
                                          className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td
                                  colSpan={5}
                                  className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                                >
                                  {dashboard.isLoadingDashboard
                                    ? "Refreshing pharmacy registry..."
                                    : "No pharmacies matched the current search."}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {view === "medicines" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    National Medicine Registry
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Central catalog control for medicine names, pack units, and national wholesale
                    and retail pricing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void dashboard.refreshMedicines()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                >
                  <RefreshCcw size={16} />
                  Refresh Registry
                </button>
              </header>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Total medicines
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {medicineRegistryStats.totalMedicines.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Avg wholesale
                  </p>
                  <p className="mt-3 text-2xl font-extrabold">
                    {formatLkr(medicineRegistryStats.averageWholesale)}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Avg retail
                  </p>
                  <p className="mt-3 text-2xl font-extrabold">
                    {formatLkr(medicineRegistryStats.averageRetail)}
                  </p>
                </div>
              </div>

              <div className="space-y-8">
                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-headline text-lg font-bold">Add Medicine</h2>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Ensure correct spelling and valid prices are entered.
                      </p>
                    </div>
                    <PackagePlus className="text-blue-700 dark:text-blue-400" size={20} />
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(140px,0.9fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(220px,1fr)] xl:items-end">
                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Medicine name
                      </span>
                      <input
                        value={newMedicineName}
                        onChange={(event) => setNewMedicineName(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        placeholder="PANTOPRAZOLE INJ 40MG"
                        type="text"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Unit
                      </span>
                      <input
                        value={newMedicineUnit}
                        onChange={(event) => setNewMedicineUnit(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        placeholder="VIAL / 100T / 100G"
                        type="text"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Wholesale price
                      </span>
                      <input
                        value={newWholesalePrice}
                        onChange={(event) => setNewWholesalePrice(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        placeholder="5100"
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Retail price
                      </span>
                      <input
                        value={newRetailPrice}
                        onChange={(event) => setNewRetailPrice(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        placeholder="5750"
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleMedicineCreate()}
                      disabled={
                        dashboard.isSubmittingMedicine ||
                        !newMedicineName.trim() ||
                        !newMedicineUnit.trim() ||
                        !newWholesalePrice.trim() ||
                        !newRetailPrice.trim()
                      }
                      className="w-full rounded-2xl bg-blue-700 px-5 py-4 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-blue-600 xl:self-end"
                    >
                      {dashboard.isSubmittingMedicine ? "Saving..." : "Add Medicine"}
                    </button>
                  </div>

                  {dashboard.medicineMessage ? (
                    <div
                      className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${noticeClassName(dashboard.medicineMessage)}`}
                    >
                      {dashboard.medicineMessage}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="font-headline text-lg font-bold">Live Medicine Registry</h2>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Search, adjust pricing, and remove catalog rows that are not tied to
                        pharmacy stock yet.
                      </p>
                    </div>
                    <div className="relative w-full max-w-sm">
                      <input
                        type="text"
                        value={medicineSearch}
                        onChange={(event) => setMedicineSearch(event.target.value)}
                        placeholder="Search name, unit, id, or price"
                        className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 pr-11 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                      />
                      <Search
                        className="absolute right-4 top-3.5 text-slate-400 dark:text-slate-500"
                        size={18}
                      />
                    </div>
                  </div>

                  <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-semibold w-[35%]">Medicine</th>
                          <th className="px-4 py-3 font-semibold">Unit</th>
                          <th className="px-4 py-3 font-semibold w-[120px]">Wholesale</th>
                          <th className="px-4 py-3 font-semibold w-[120px]">Retail</th>
                          <th className="px-4 py-3 font-semibold w-[120px]">Created</th>
                          <th className="px-4 py-3 text-right font-semibold w-[180px]">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {filteredManagedMedicines.length > 0 ? (
                          filteredManagedMedicines.map((row) => {
                            const draft = medicineDrafts[row.id] ?? {
                              name: row.name ?? "",
                              unit: row.unit ?? "",
                              wholesalePrice: String(row.wholesalePrice ?? 0),
                              retailPrice: String(row.retailPrice ?? 0),
                            };

                            return (
                              <tr key={row.id}>
                                <td className="px-4 py-4 align-top w-[35%]">
                                  <input
                                    type="text"
                                    value={draft.name}
                                    onChange={(event) =>
                                      updateMedicineDraft(row.id, "name", event.target.value)
                                    }
                                    className="w-full min-w-[240px] rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                                  />
                                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    ID: {row.id}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top w-[150px]">
                                  <input
                                    type="text"
                                    value={draft.unit}
                                    onChange={(event) =>
                                      updateMedicineDraft(row.id, "unit", event.target.value)
                                    }
                                    className="w-full min-w-[60px] rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                                  />
                                </td>
                                <td className="px-4 py-4 align-top w-[150px]">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft.wholesalePrice}
                                    onChange={(event) =>
                                      updateMedicineDraft(
                                        row.id,
                                        "wholesalePrice",
                                        event.target.value,
                                      )
                                    }
                                    className="w-full min-w-[20px] rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                                  />
                                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {formatLkr(Number(draft.wholesalePrice))}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft.retailPrice}
                                    onChange={(event) =>
                                      updateMedicineDraft(row.id, "retailPrice", event.target.value)
                                    }
                                    className="w-full rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                                  />
                                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {formatLkr(Number(draft.retailPrice))}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top text-slate-500 dark:text-slate-400">
                                  {formatDisplayDate(row.createdAt)}
                                </td>
                                <td className="px-4 py-4 align-top w-[180px] text-right">
                                  <div className="flex flex-col items-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleMedicineSave(row)}
                                      className="w-[110px] inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white hover:opacity-90 disabled:opacity-60 dark:bg-blue-600"
                                    >
                                      <Save size={14} />
                                      Save
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => void handleMedicineDelete(row)}
                                      className="w-[110px] inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
                                    >
                                      <Trash2 size={14} />
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                            >
                              {dashboard.isLoadingMedicines
                                ? "Refreshing medicine registry..."
                                : "No medicine rows matched the current search."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {view === "analytics" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    Analytics & Gov Reporting
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Live analytics of diseases and healthcare workflowa.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateAndDownloadReport()}
                  disabled={dashboard.isGeneratingReport}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition-all hover:opacity-90 disabled:opacity-60 dark:bg-blue-600"
                >
                  <Bot size={16} />
                  {dashboard.isGeneratingReport ? "Generating..." : "Generate & Download AI Monthly Report"}
                </button>
              </header>

              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 xl:flex-row">
                <select
                  value={dashboard.filters.district}
                  onChange={(event) =>
                    dashboard.setFilters((current) => ({
                      ...current,
                      district: event.target.value,
                    }))
                  }
                  className="rounded-lg border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                >
                  <option value="">All Districts</option>
                  <option value="Colombo">Colombo</option>
                  <option value="Gampaha">Gampaha</option>
                  <option value="Matara">Matara</option>
                </select>
                <input
                  type="date"
                  value={dashboard.filters.startDate}
                  onChange={(event) =>
                    dashboard.setFilters((current) => ({
                      ...current,
                      startDate: event.target.value,
                    }))
                  }
                  className="rounded-lg border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                />
                <input
                  type="date"
                  value={dashboard.filters.endDate}
                  onChange={(event) =>
                    dashboard.setFilters((current) => ({ ...current, endDate: event.target.value }))
                  }
                  className="rounded-lg border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void dashboard.refreshAnalytics()}
                  disabled={dashboard.isLoadingAnalytics || Boolean(analyticsRangeMessage)}
                  className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-slate-700"
                >
                  {dashboard.isLoadingAnalytics ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={exportIncidenceCsv}
                  className="rounded-lg bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Export CSV
                </button>
              </div>

              {analyticsRangeMessage ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {analyticsRangeMessage}
                </div>
              ) : null}

              {dashboard.analyticsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                  {dashboard.analyticsError}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Incidence rows
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {dashboard.incidence.length.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Total tracked cases
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {incidenceTotal.toLocaleString("en-LK")}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Leading live diagnosis
                  </p>
                  <p className="mt-3 text-2xl font-extrabold">
                    {incidencePeak?.code ?? "No live diagnosis feed"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="font-headline text-lg font-bold">Top Diagnoses Incidence</h3>
                  {dashboard.topDiagnoses.length > 0 ? (
                    <div className="mt-6 space-y-4">
                      {dashboard.topDiagnoses.slice(0, 5).map((item, index) => {
                        const total = dashboard.topDiagnoses[0]?.count || 1;
                        const width = `${Math.max(12, Math.round((item.count / total) * 100))}%`;
                        const tones = [
                          "bg-red-500",
                          "bg-cyan-500",
                          "bg-orange-500",
                          "bg-blue-500",
                          "bg-emerald-500",
                        ];

                        return (
                          <div key={`${item.code}-${index}`}>
                            <div className="mb-1 flex justify-between text-sm">
                              <span className="font-semibold">{item.code}</span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {item.count.toLocaleString("en-LK")} cases
                              </span>
                            </div>
                            <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                              <div
                                className={`h-2.5 rounded-full ${tones[index % tones.length]}`}
                                style={{ width }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      No diagnosis records are available from the current backend yet, so this chart
                      stays empty instead of making things up.
                    </div>
                  )}
                </div>

                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-headline text-lg font-bold">Analytics Integrity Notes</h3>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        System overview analytics.
                      </p>
                    </div>
                    <Bot className="text-cyan-600 dark:text-cyan-400" size={20} />
                  </div>
                  <div className="mt-6 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Registered patients:{" "}
                      {dashboard.dashboardStats.totalPatients.toLocaleString("en-LK")}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Registered organisations:{" "}
                      {dashboard.dashboardStats.totalOrganisations.toLocaleString("en-LK")}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Audit activity in last 24h:{" "}
                      {dashboard.dashboardStats.auditEvents24h.toLocaleString("en-LK")}
                    </div>
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900">
                      {incidencePeak
                        ? `Peak diagnosis in the current live dataset is ${incidencePeak.code} with ${incidencePeak.count.toLocaleString("en-LK")} recorded cases.`
                        : "Current backend payload does not contain enough diagnosis detail to produce a richer breakdown yet."}
                    </div>
                  </div>
                </div>
              </div>

              {(analyticsExportMessage || reportDownloadMessage || dashboard.reportMessage) ? (
                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  {analyticsExportMessage ? (
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm ${noticeClassName(analyticsExportMessage)}`}
                    >
                      {analyticsExportMessage}
                    </div>
                  ) : null}
                  {reportDownloadMessage ? (
                    <div
                      className={`${analyticsExportMessage ? "mt-4 " : ""}rounded-xl border px-4 py-3 text-sm ${noticeClassName(reportDownloadMessage)}`}
                    >
                      {reportDownloadMessage}
                    </div>
                  ) : null}
                  {dashboard.reportMessage ? (
                    <div
                      className={`${analyticsExportMessage || reportDownloadMessage ? "mt-4 " : ""}rounded-xl border px-4 py-3 text-sm ${noticeClassName(dashboard.reportMessage)}`}
                    >
                      {dashboard.reportMessage}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {view === "settings" ? (
            <SettingsSection
              user={user}
              theme={theme}
              saveMessage={profileSaveMessage}
              isSaving={isSavingProfile}
              onThemeChange={setTheme}
              onSave={handleProfileSave}
              onLogout={handleLogout}
            />
          ) : null}

          {view === "audit" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">Audit Logs</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Search and export the live audit records currently available to the ministry
                    admin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportAuditLogs}
                  disabled={filteredAuditLogs.length === 0}
                  className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400"
                >
                  <Download size={16} />
                  Export CSV
                </button>
              </header>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr,0.8fr,0.8fr,auto,auto]">
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="Search actor, role, organisation, action, or details"
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  />
                  <select
                    value={auditRoleFilter}
                    onChange={(event) => setAuditRoleFilter(event.target.value)}
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="ALL">All roles</option>
                    {auditRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <select
                    value={auditActionFilter}
                    onChange={(event) => setAuditActionFilter(event.target.value)}
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="ALL">All actions</option>
                    {auditActionOptions.map((action) => (
                      <option key={action} value={action}>
                        {formatStatusLabel(action)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void dashboard.refreshDashboard()}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                  >
                    Search Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditSearch("");
                      setAuditRoleFilter("ALL");
                      setAuditActionFilter("ALL");
                    }}
                    className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Clear Filters
                  </button>
                </div>

                <div className="mb-6 flex flex-wrap gap-3">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {filteredAuditLogs.length} visible row(s)
                  </span>
                  {auditRoleFilter !== "ALL" ? (
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      Role: {auditRoleFilter}
                    </span>
                  ) : null}
                  {auditActionFilter !== "ALL" ? (
                    <span className="rounded-full bg-cyan-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                      Action: {formatStatusLabel(auditActionFilter)}
                    </span>
                  ) : null}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <tr>
                        {["Timestamp", "Actor (Role)", "Target Org", "Action", "Details"].map(
                          (heading) => (
                            <th key={heading} className="px-4 py-3 font-semibold">
                              {heading}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {filteredAuditLogs.length > 0 ? (
                        filteredAuditLogs.map((row) => (
                          <tr
                            key={`${row.id}-${row.timestamp}`}
                            className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <td className="px-4 py-3 font-mono text-xs">
                              {formatDisplayDate(row.timestamp)}
                            </td>
                            <td className="px-4 py-3">
                              {row.actorName ?? row.actorId ?? "Unknown actor"}{" "}
                              <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] dark:bg-slate-700">
                                {row.actorRole ?? "Unknown"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {row.organisationName ?? "National Scope"}
                            </td>
                            <td className="px-4 py-3 font-semibold text-blue-700 dark:text-blue-400">
                              {row.action ?? "UNKNOWN"}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                              {row.details ?? "No detail"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                          >
                            {dashboard.isLoadingDashboard
                              ? "Refreshing live audit rows..."
                              : "No audit rows matched the current investigation filters."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  Logged in as{" "}
                  <span className="font-semibold">
                    {user?.name || user?.email || "Health Ministry Admin"}
                  </span>
                  .
                </div>

                {auditExportMessage ? (
                  <div
                    className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeClassName(auditExportMessage)}`}
                  >
                    {auditExportMessage}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {view === "deletions" ? (
            <DeletionsView
              dashboard={dashboard}
              formatDisplayDate={formatDisplayDate}
            />
          ) : null}

          {view === "patientRegistry" ? (
            <PatientRegistryView
              dashboard={dashboard}
              formatDisplayDate={formatDisplayDate}
            />
          ) : null}

          {view === "anomalies" ? <AnomaliesSection /> : null}
          {view === "performance" ? <PerformanceSection /> : null}
          {view === "investigation" ? <InvestigationSection /> : null}
        </main>

        <footer className="ml-64 mt-12 border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-8 py-12 text-center text-xs uppercase tracking-[0.24em] text-slate-500 md:flex-row md:text-left dark:text-slate-400">
            <div>
              <p className="mb-2 font-bold text-slate-800 dark:text-slate-300">
                © 2026 National Digital Health Ministry.
              </p>
              <p>All rights reserved. Secured by Project MediConnect.</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
