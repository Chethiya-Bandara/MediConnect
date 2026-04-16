import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  LayoutDashboard,
  LogOut,
  Moon,
  RefreshCcw,
  Search,
  ShieldAlert,
  Stethoscope,
  Sun,
  UserCircle2,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/context/AuthContext";
import { useHealthMinistryAdminDashboard } from "../hooks/useHealthMinistryAdminDashboard";
import type { ApprovalStatus, GovernanceAction, GovernanceTargetType } from "../types";

type DashboardView = "overview" | "approvals" | "analytics" | "audit";
type ThemeMode = "light" | "dark";

const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "approvals", label: "Approvals", icon: UserRoundCheck },
  { id: "analytics", label: "Analytics & Reports", icon: BarChart3 },
  { id: "audit", label: "Audit Logs", icon: ClipboardList },
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
        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
          {note}
        </span>
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
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function HealthMinistryAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const dashboard = useHealthMinistryAdminDashboard();

  const [view, setView] = useState<DashboardView>("overview");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [organizationId, setOrganizationId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [governanceTargetId, setGovernanceTargetId] = useState("");
  const [governanceTargetType, setGovernanceTargetType] =
    useState<GovernanceTargetType>("ORGANIZATION");
  const [governanceAction, setGovernanceAction] =
    useState<GovernanceAction>("SUSPEND");
  const [auditSearch, setAuditSearch] = useState("");

  const deferredAuditSearch = useDeferredValue(auditSearch.trim().toLowerCase());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("health-ministry-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("health-ministry-theme", theme);
  }, [theme]);

  const topDiagnosis = dashboard.topDiagnoses[0]?.code ?? "No diagnosis feed yet";
  const totalPendingApprovals =
    dashboard.dashboardStats.pendingDoctors +
    dashboard.dashboardStats.pendingOrganisations;

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
        tone:
          "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
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
    if (!deferredAuditSearch) {
      return dashboard.auditLogs;
    }

    return dashboard.auditLogs.filter((row) =>
      [
        row.actorName,
        row.actorRole,
        row.organisationName,
        row.action,
        row.details,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(deferredAuditSearch),
    );
  }, [dashboard.auditLogs, deferredAuditSearch]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleOrganizationDecision = async (status: ApprovalStatus, targetId?: string) => {
    await dashboard.submitOrganizationApproval(targetId ?? organizationId, status);
  };

  const handleDoctorDecision = async (status: ApprovalStatus, targetId?: string) => {
    await dashboard.submitDoctorApproval(targetId ?? doctorId, status);
  };

  const handleGovernanceAction = async () => {
    await dashboard.submitUserAction(
      governanceTargetId,
      governanceTargetType,
      governanceAction,
    );
  };

  const exportAuditLogs = () => {
    downloadCsv(
      "health-ministry-audit-logs.csv",
      [
        ["Timestamp", "Actor", "Role", "Organisation", "Action", "Details"],
        ...filteredAuditLogs.map((row) => [
          row.timestamp ?? "",
          row.actorName ?? row.actorId ?? "",
          row.actorRole ?? "",
          row.organisationName ?? "",
          row.action ?? "",
          row.details ?? "",
        ]),
      ],
    );
  };

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <div className="min-h-screen bg-[#f7fafc] font-body text-[#181c1e] antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <nav className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white/85 px-6 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
          <div className="flex items-center gap-4">
            <span className="font-headline text-xl font-extrabold text-blue-950 dark:text-blue-300">
              National Health Portal
            </span>
            <span className="hidden rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.28em] text-blue-900 md:inline-block dark:bg-blue-900/50 dark:text-blue-100">
              Ministry of Health
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
              className="rounded-full p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-300"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-300"
            >
              <Bell size={20} />
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-300"
            >
              <UserCircle2 size={20} />
            </button>
          </div>
        </nav>

        <aside className="fixed left-0 top-14 flex h-[calc(100vh-56px)] w-64 flex-col border-r border-slate-200 bg-slate-50 px-4 py-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8 px-2">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#005a9c] text-white shadow-md shadow-blue-900/15 dark:bg-blue-800">
                <ShieldAlert size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-blue-900 dark:text-blue-300">
                  Health Gov
                </p>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                  Ministry Admin
                </p>
              </div>
            </div>
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

        <main className="ml-64 min-h-screen px-8 pb-12 pt-20">
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
                    Strategic oversight and ecosystem management for the
                    MediConnect national digital health ministry workspace.
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
                      <span className="font-semibold">{topDiagnosis}</span>. If
                      that looks empty, blame the missing diagnosis telemetry,
                      not the paint job.
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
                  <h2 className="px-2 font-headline text-xl font-bold">
                    Account Management
                  </h2>
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
                        <Search className="absolute right-4 top-4 text-slate-400 dark:text-slate-500" size={18} />
                      </div>
                    </div>

                    <select
                      value={governanceTargetType}
                      onChange={(event) => setGovernanceTargetType(event.target.value as GovernanceTargetType)}
                      className="w-full rounded-xl border-0 bg-white px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="ORGANIZATION">Organization</option>
                      <option value="USER">User</option>
                    </select>

                    <select
                      value={governanceAction}
                      onChange={(event) => setGovernanceAction(event.target.value as GovernanceAction)}
                      className="w-full rounded-xl border-0 bg-white px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="SUSPEND">Suspend</option>
                      <option value="ACTIVATE">Reactivate</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => void handleGovernanceAction()}
                      disabled={
                        dashboard.isSubmittingUserAction || !governanceTargetId.trim()
                      }
                      className="w-full rounded-2xl bg-red-600 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-red-900/10 transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {dashboard.isSubmittingUserAction ? "Applying..." : "Apply Action"}
                    </button>

                    {dashboard.usersMessage ? (
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
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

              <div className="grid gap-8 xl:grid-cols-2">
                <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                    <h2 className="font-headline text-lg font-bold">
                      Organisations ({dashboard.pendingOrganisations.length})
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-6 py-4">Name</th>
                          <th className="px-6 py-4">Type</th>
                          <th className="px-6 py-4">Submitted</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {dashboard.pendingOrganisations.length > 0 ? (
                          dashboard.pendingOrganisations.map((row) => (
                            <tr key={row.id}>
                              <td className="px-6 py-4 font-semibold">
                                {row.name ?? `Organisation ${row.id}`}
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {row.type ?? "Unknown"}
                              </td>
                              <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                {formatDisplayDate(row.createdAt)}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleOrganizationDecision("approved", row.id)}
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                                  >
                                    <CheckCircle2 size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleOrganizationDecision("rejected", row.id)}
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
                            <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                              No pending organisation approvals right now.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                    <h2 className="font-headline text-lg font-bold">
                      Doctors ({dashboard.pendingDoctors.length})
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <tr>
                          <th className="px-6 py-4">Doctor</th>
                          <th className="px-6 py-4">Specialty</th>
                          <th className="px-6 py-4">SLMC</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {dashboard.pendingDoctors.length > 0 ? (
                          dashboard.pendingDoctors.map((row) => (
                            <tr key={row.doctorId}>
                              <td className="px-6 py-4">
                                <div className="font-semibold">
                                  {row.name ?? `Doctor ${row.doctorId}`}
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
                              <td className="px-6 py-4">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleDoctorDecision("approved", row.doctorId)}
                                    disabled={dashboard.isSubmittingApproval}
                                    className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                                  >
                                    <CheckCircle2 size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDoctorDecision("rejected", row.doctorId)}
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
                            <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                              No pending doctor approvals right now.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <h2 className="font-headline text-lg font-bold">Manual Organisation Review</h2>
                  <div className="mt-5 space-y-4">
                    <input
                      value={organizationId}
                      onChange={(event) => setOrganizationId(event.target.value)}
                      className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                      placeholder="Organisation ID"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => void handleOrganizationDecision("approved")}
                        disabled={dashboard.isSubmittingApproval || !organizationId.trim()}
                        className="flex-1 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOrganizationDecision("rejected")}
                        disabled={dashboard.isSubmittingApproval || !organizationId.trim()}
                        className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <h2 className="font-headline text-lg font-bold">Manual Doctor Review</h2>
                  <div className="mt-5 space-y-4">
                    <input
                      value={doctorId}
                      onChange={(event) => setDoctorId(event.target.value)}
                      className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                      placeholder="Doctor ID"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => void handleDoctorDecision("approved")}
                        disabled={dashboard.isSubmittingApproval || !doctorId.trim()}
                        className="flex-1 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDoctorDecision("rejected")}
                        disabled={dashboard.isSubmittingApproval || !doctorId.trim()}
                        className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {dashboard.approvalsMessage ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {dashboard.approvalsMessage}
                </div>
              ) : null}
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
                    Live analytics where data exists, and honest empty states where the backend has no diagnosis telemetry yet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void dashboard.requestMonthlyReport()}
                  disabled={dashboard.isGeneratingReport}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition-all hover:opacity-90 disabled:opacity-60 dark:bg-blue-600"
                >
                  <Bot size={16} />
                  {dashboard.isGeneratingReport ? "Generating..." : "Generate AI Monthly Report"}
                </button>
              </header>

              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:flex-row">
                <select
                  value={dashboard.filters.district}
                  onChange={(event) =>
                    dashboard.setFilters((current) => ({ ...current, district: event.target.value }))
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
                    dashboard.setFilters((current) => ({ ...current, startDate: event.target.value }))
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
                  disabled={dashboard.isLoadingAnalytics}
                  className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-slate-700"
                >
                  {dashboard.isLoadingAnalytics ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {dashboard.analyticsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                  {dashboard.analyticsError}
                </div>
              ) : null}

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
                              <div className={`h-2.5 rounded-full ${tones[index % tones.length]}`} style={{ width }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      No diagnosis records are available from the current backend yet, so this chart stays empty instead of making things up.
                    </div>
                  )}
                </div>

                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="font-headline text-lg font-bold">Analytics Integrity Notes</h3>
                  <div className="mt-6 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Registered patients: {dashboard.dashboardStats.totalPatients.toLocaleString("en-LK")}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Registered organisations: {dashboard.dashboardStats.totalOrganisations.toLocaleString("en-LK")}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-900">
                      Audit activity in last 24h: {dashboard.dashboardStats.auditEvents24h.toLocaleString("en-LK")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-headline text-lg font-bold">Monthly AI Report</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Generated at {formatDisplayDate(dashboard.reportGeneratedAt)}
                    </p>
                  </div>
                  {dashboard.reportMessage ? (
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {dashboard.reportMessage}
                    </span>
                  ) : null}
                </div>
                <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {dashboard.report ?? "No report generated yet. Hit the button and the backend will summarise the live registry data it actually has."}
                </div>
              </div>
            </section>
          ) : null}

          {view === "audit" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="flex items-center gap-3 font-headline text-3xl font-extrabold tracking-tight">
                    Investigation Mode
                    <span className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                      High Privilege
                    </span>
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Search and export the live audit records currently available to the ministry admin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportAuditLogs}
                  className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:underline dark:text-blue-400"
                >
                  <Download size={16} />
                  Export CSV
                </button>
              </header>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr,auto]">
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="Search actor, role, organisation, action, or details"
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void dashboard.refreshDashboard()}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                  >
                    Search Logs
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <tr>
                        {["Timestamp", "Actor (Role)", "Target Org", "Action", "Details"].map((heading) => (
                          <th key={heading} className="px-4 py-3 font-semibold">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {filteredAuditLogs.length > 0 ? (
                        filteredAuditLogs.map((row) => (
                          <tr key={`${row.id}-${row.timestamp}`} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="px-4 py-3 font-mono text-xs">
                              {formatDisplayDate(row.timestamp)}
                            </td>
                            <td className="px-4 py-3">
                              {(row.actorName ?? row.actorId ?? "Unknown actor")}{" "}
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
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                            No audit rows matched your current search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  Logged in as <span className="font-semibold">{user?.name || user?.email || "Health Ministry Admin"}</span>.
                </div>
              </div>
            </section>
          ) : null}
        </main>

        <footer className="ml-64 mt-12 border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-8 py-12 text-center text-xs uppercase tracking-[0.24em] text-slate-500 md:flex-row md:text-left dark:text-slate-400">
            <div>
              <p className="mb-2 font-bold text-slate-800 dark:text-slate-300">
                © 2026 National Digital Health Ministry.
              </p>
              <p>All rights reserved. Secured by Project MediConnect.</p>
            </div>
            <div className="flex flex-wrap gap-6">
              <span>Privacy Policy</span>
              <span>Audit Terms</span>
              <span>Security</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
