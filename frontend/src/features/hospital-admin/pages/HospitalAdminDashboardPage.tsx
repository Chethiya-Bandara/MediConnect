import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  ShieldCheck,
  Stethoscope,
  Sun,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/context/AuthContext";
import { useHospitalAdminDashboard } from "../hooks/useHospitalAdminDashboard";
import type { AffiliationDecisionStatus, CreateAvailabilityPayload } from "../types";

type DashboardView = "overview" | "staffing" | "scheduling" | "audit";
type ThemeMode = "light" | "dark";

const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "staffing", label: "Staffing & Affiliations", icon: Users },
  { id: "scheduling", label: "Scheduling Slots", icon: CalendarDays },
  { id: "audit", label: "Local Audit Logs", icon: ShieldCheck },
] satisfies Array<{
  id: DashboardView;
  label: string;
  icon: typeof LayoutDashboard;
}>;

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "N/A";
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

function formatShortDate(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function buildInitials(name: string | null | undefined) {
  const safe = (name || "Hospital Admin").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "HA";
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

function buildGeneratedSlots(slotDate: string, startTime: string, endTime: string, duration: number) {
  if (!slotDate || !startTime || !endTime || duration <= 0) {
    return [];
  }

  const start = new Date(`${slotDate}T${startTime}:00`);
  const end = new Date(`${slotDate}T${endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return [];
  }

  const slots: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() + duration * 60_000 <= end.getTime()) {
    slots.push(
      cursor.toLocaleTimeString("en-LK", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
    cursor.setMinutes(cursor.getMinutes() + duration);
  }
  return slots;
}

export function HospitalAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const dashboard = useHospitalAdminDashboard();

  const [view, setView] = useState<DashboardView>("overview");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteHospitalId, setInviteHospitalId] = useState("");
  const [selectedAffiliationId, setSelectedAffiliationId] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [slotDate, setSlotDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(15);
  const [auditSearch, setAuditSearch] = useState("");

  const deferredAuditSearch = useDeferredValue(auditSearch.trim().toLowerCase());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("hospital-admin-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("hospital-admin-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!selectedDoctorId && dashboard.activeStaff[0]?.doctorId) {
      setSelectedDoctorId(dashboard.activeStaff[0].doctorId);
    }
  }, [dashboard.activeStaff, selectedDoctorId]);

  useEffect(() => {
    if (!inviteHospitalId) {
      setInviteHospitalId(
        dashboard.hospital.id ?? String(user?.organisationId ?? ""),
      );
    }
  }, [dashboard.hospital.id, inviteHospitalId, user?.organisationId]);

  useEffect(() => {
    if (!selectedAffiliationId && dashboard.pendingAffiliations[0]?.affiliationId) {
      setSelectedAffiliationId(dashboard.pendingAffiliations[0].affiliationId);
    }
  }, [dashboard.pendingAffiliations, selectedAffiliationId]);

  const generatedSlots = useMemo(
    () => buildGeneratedSlots(slotDate, startTime, endTime, slotDurationMinutes),
    [slotDate, startTime, endTime, slotDurationMinutes],
  );

  const filteredAuditLogs = useMemo(() => {
    if (!deferredAuditSearch) {
      return dashboard.auditLogs;
    }

    return dashboard.auditLogs.filter((row) =>
      [row.actorName, row.actorRole, row.action, row.details]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(deferredAuditSearch),
    );
  }, [dashboard.auditLogs, deferredAuditSearch]);

  const metrics = useMemo(
    () => [
      {
        label: "Active Doctors",
        value: dashboard.dashboardStats.activeDoctors.toLocaleString("en-LK"),
        sublabel: `${dashboard.dashboardStats.pendingInvitations} pending invitations`,
        icon: Stethoscope,
        tone:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
      },
      {
        label: "Pending Affiliations",
        value: dashboard.dashboardStats.pendingAffiliations.toLocaleString("en-LK"),
        sublabel: "Needs staffing review",
        icon: Users,
        tone:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
      },
      {
        label: "Today's Appointments",
        value: dashboard.dashboardStats.appointmentsToday.toLocaleString("en-LK"),
        sublabel: "Live organisation schedule count",
        icon: CalendarDays,
        tone:
          "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
      },
      {
        label: "Capacity Load",
        value: `${dashboard.dashboardStats.capacityLoad}%`,
        sublabel: `${dashboard.dashboardStats.bookedSlotsToday}/${dashboard.dashboardStats.totalSlotsToday} slots booked today`,
        icon: Building2,
        tone:
          "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      },
    ],
    [dashboard.dashboardStats],
  );

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleInviteDoctor = async () => {
    if (!inviteEmail.trim() || !inviteHospitalId.trim()) {
      return;
    }

    await dashboard.sendInvite({
      doctorEmail: inviteEmail.trim(),
      hospitalId: inviteHospitalId.trim(),
    });
  };

  const handleAffiliationDecision = async (
    status: AffiliationDecisionStatus,
    affiliationId?: string,
  ) => {
    const targetId = affiliationId ?? selectedAffiliationId;
    if (!targetId) {
      return;
    }
    await dashboard.submitAffiliationDecision(targetId, status);
  };

  const handleCreateAvailability = async () => {
    if (!selectedDoctorId || !slotDate) {
      return;
    }

    const payload: CreateAvailabilityPayload = {
      doctorId: selectedDoctorId,
      slotDate,
      startTime,
      endTime,
      slotDurationMinutes,
    };

    dashboard.setAvailabilityDoctorIdInput(selectedDoctorId);
    await dashboard.addAvailability(payload);
  };

  const handleLoadAvailability = async (doctorId: string) => {
    dashboard.setAvailabilityDoctorIdInput(doctorId);
    await dashboard.loadAvailability(doctorId, slotDate);
  };

  const exportAuditLogs = () => {
    downloadCsv(
      "hospital-admin-audit-logs.csv",
      [
        ["Timestamp", "Actor", "Role", "Action", "Details"],
        ...filteredAuditLogs.map((row) => [
          row.timestamp ?? "",
          row.actorName ?? row.actorId ?? "",
          row.actorRole ?? "",
          row.action ?? "",
          row.details ?? "",
        ]),
      ],
    );
  };

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <div className="min-h-screen bg-[#f7fafc] font-body text-[#181c1e] antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-50 px-4 py-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8 px-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-white shadow-md">
                <Building2 size={18} />
              </div>
              <div>
                <h1 className="font-headline text-lg font-bold text-blue-950 dark:text-blue-100">
                  Admin Console
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {dashboard.hospital.name ?? "Hospital Workspace"}
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm font-medium transition-all ${
                    active
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                      : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-2 px-2">
            <div className="flex justify-center border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 transition-colors hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          </div>
        </aside>

        <header className="fixed left-64 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-8 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
          <div className="w-full max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="w-full rounded-full border-0 bg-slate-100 py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                placeholder="Search doctors, schedules, or logs..."
                type="text"
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
                className="rounded-full p-1 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400"
              >
                {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button
                type="button"
                className="relative rounded-full p-1 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400"
              >
                <Bell size={18} />
                <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-500" />
              </button>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-bold">{user?.name || "Hospital Admin"}</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {dashboard.hospital.name ?? "Hospital"}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-300 bg-blue-100 font-bold text-blue-700 dark:border-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {buildInitials(user?.name)}
              </div>
            </div>
          </div>
        </header>

        <main className="ml-64 min-h-screen p-8 pt-20">
          {dashboard.dashboardError ? (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              {dashboard.dashboardError}
            </div>
          ) : null}

          {view === "overview" ? (
            <section className="space-y-8">
              <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                {metrics.map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <article
                      key={metric.label}
                      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="mb-4 flex items-start justify-between">
                        <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                          {metric.label}
                        </span>
                        <div className={`rounded-lg p-2 ${metric.tone}`}>
                          <Icon size={18} />
                        </div>
                      </div>
                      <div>
                        <h3 className="mb-1 text-3xl font-extrabold">{metric.value}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {metric.sublabel}
                        </p>
                        {metric.label === "Capacity Load" ? (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-red-500"
                              style={{ width: `${dashboard.dashboardStats.capacityLoad}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </section>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="space-y-8 lg:col-span-2">
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between bg-slate-50 px-6 py-5 dark:bg-slate-800/50">
                      <h2 className="font-headline text-lg font-bold">
                        Recent Credentialing Requests
                      </h2>
                      <button
                        type="button"
                        onClick={() => setView("staffing")}
                        className="text-sm font-bold text-blue-700 hover:underline dark:text-blue-400"
                      >
                        View All
                      </button>
                    </div>
                    <div className="grid grid-cols-4 bg-slate-50/80 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                      <span>Practitioner</span>
                      <span>Specialization</span>
                      <span>Date Requested</span>
                      <span className="text-right">Actions</span>
                    </div>
                    {dashboard.pendingAffiliations.length > 0 ? (
                      dashboard.pendingAffiliations.map((row) => (
                        <div
                          key={row.affiliationId}
                          className="grid grid-cols-4 items-center border-t border-slate-100 px-6 py-5 transition-colors hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                              {buildInitials(row.doctorName)}
                            </div>
                            <span className="text-sm font-semibold">
                              {row.doctorName ?? `Doctor ${row.doctorId}`}
                            </span>
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400">
                            {row.specialization ?? "Not set"}
                          </span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">
                            {formatShortDate(row.requestedAt)}
                          </span>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void handleAffiliationDecision("APPROVED", row.affiliationId)}
                              className="rounded-lg p-2 text-blue-700 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                            >
                              <CheckCircle2 size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAffiliationDecision("REJECTED", row.affiliationId)}
                              className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                            >
                              <XCircle size={18} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="border-t border-slate-100 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        No pending affiliation requests yet.
                      </div>
                    )}
                  </section>
                </div>

                <div className="space-y-8">
                  <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-6 flex items-center justify-between">
                      <h2 className="font-headline text-lg font-bold">
                        Active Medical Staff
                      </h2>
                      <button
                        type="button"
                        onClick={() => setView("staffing")}
                        className="text-xs font-bold text-blue-700 hover:underline dark:text-blue-400"
                      >
                        View All
                      </button>
                    </div>
                    <div className="space-y-4">
                      {dashboard.activeStaff.length > 0 ? (
                        dashboard.activeStaff.slice(0, 3).map((doctor) => (
                          <div
                            key={doctor.affiliationId}
                            className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-800"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                {buildInitials(doctor.doctorName)}
                              </div>
                              <div>
                                <p className="text-sm font-bold">
                                  {doctor.doctorName ?? `Doctor ${doctor.doctorId}`}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {doctor.specialization ?? "Specialty not set"}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDoctorId(doctor.doctorId);
                                void handleLoadAvailability(doctor.doctorId);
                                setView("scheduling");
                              }}
                              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                            >
                              <CalendarDays size={18} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          No approved affiliated doctors yet.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </section>
          ) : null}

          {view === "staffing" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    Staffing & Affiliations
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Manage hospital staffing using live affiliation and invitation data.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void dashboard.refreshDashboard()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                >
                  <Clock3 size={16} />
                  Refresh
                </button>
              </header>

              <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.6fr,0.9fr]">
                <div className="space-y-8">
                  <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                      <h2 className="font-headline text-lg font-bold">
                        Pending Affiliation Requests
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                          <tr>
                            <th className="px-6 py-4">Practitioner</th>
                            <th className="px-6 py-4">Specialty</th>
                            <th className="px-6 py-4">SLMC</th>
                            <th className="px-6 py-4">Requested</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dashboard.pendingAffiliations.length > 0 ? (
                            dashboard.pendingAffiliations.map((row) => (
                              <tr key={row.affiliationId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                <td className="px-6 py-4">
                                  <p className="font-bold text-sm">
                                    {row.doctorName ?? `Doctor ${row.doctorId}`}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {row.doctorEmail ?? `Doctor ID ${row.doctorId}`}
                                  </p>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                  {row.specialization ?? "Not set"}
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                  {row.slmcNumber ?? "Not set"}
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                  {formatShortDate(row.requestedAt)}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleAffiliationDecision("APPROVED", row.affiliationId)}
                                    disabled={dashboard.isSubmittingAffiliationAction}
                                    className="rounded-lg bg-green-50 px-4 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-60 dark:bg-green-900/30 dark:text-green-400"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAffiliationDecision("REJECTED", row.affiliationId)}
                                    disabled={dashboard.isSubmittingAffiliationAction}
                                    className="rounded-lg bg-red-50 px-4 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60 dark:bg-red-900/30 dark:text-red-400"
                                  >
                                    Reject
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                No pending affiliation requests right now.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section>
                    <h2 className="mb-4 font-headline text-xl font-bold">
                      Active Medical Staff Directory
                    </h2>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      {dashboard.activeStaff.length > 0 ? (
                        dashboard.activeStaff.map((doctor) => (
                          <article
                            key={doctor.affiliationId}
                            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="mb-4 flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                  {buildInitials(doctor.doctorName)}
                                </div>
                                <div>
                                  <h3 className="font-bold">
                                    {doctor.doctorName ?? `Doctor ${doctor.doctorId}`}
                                  </h3>
                                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                                    {doctor.specialization ?? "Specialty not set"}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="mb-6 space-y-2">
                              <p className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>Doctor ID:</span>
                                <span className="font-mono">{doctor.doctorId}</span>
                              </p>
                              <p className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>Joined:</span>
                                <span>{formatShortDate(doctor.joinedAt)}</span>
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDoctorId(doctor.doctorId);
                                  void handleLoadAvailability(doctor.doctorId);
                                  setView("scheduling");
                                }}
                                className="rounded-lg bg-slate-100 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                              >
                                Schedule
                              </button>
                              <button
                                type="button"
                                onClick={() => void dashboard.submitAffiliationRevoke(doctor.affiliationId)}
                                className="flex items-center justify-center gap-1 rounded-lg bg-red-50 py-2 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                              >
                                <XCircle size={14} />
                                Revoke
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 md:col-span-2">
                          No approved doctors are attached to this hospital yet.
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <aside className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="font-headline text-lg font-bold">Invite Doctor</h2>
                  <div className="space-y-4">
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="doctor@hospital.lk"
                      className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                    />
                    <input
                      value={inviteHospitalId}
                      onChange={(event) => setInviteHospitalId(event.target.value)}
                      placeholder="Hospital ID"
                      className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => void handleInviteDoctor()}
                      disabled={dashboard.isSubmittingDoctorAction || !inviteEmail.trim() || !inviteHospitalId.trim()}
                      className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {dashboard.isSubmittingDoctorAction ? "Sending..." : "Send Invite"}
                    </button>
                  </div>

                  {dashboard.pendingInvitations.length > 0 ? (
                    <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                      <h3 className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Recent Invitations
                      </h3>
                      {dashboard.pendingInvitations.slice(0, 5).map((invitation) => (
                        <div
                          key={invitation.id}
                          className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <div className="font-semibold">{invitation.doctorEmail ?? "Unknown email"}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {invitation.status ?? "Pending"} • {formatShortDate(invitation.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {dashboard.doctorsMessage ? (
                    <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {dashboard.doctorsMessage}
                    </p>
                  ) : null}

                  {dashboard.affiliationsMessage ? (
                    <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {dashboard.affiliationsMessage}
                    </p>
                  ) : null}
                </aside>
              </div>
            </section>
          ) : null}

          {view === "scheduling" ? (
            <section className="space-y-8">
              <header>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                  Scheduling & Availability
                </h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Generate real availability slots and load live schedule data for affiliated doctors.
                </p>
              </header>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="mb-6 text-lg font-bold">1. Select Criteria</h3>
                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Practitioner
                      </label>
                      <select
                        value={selectedDoctorId}
                        onChange={(event) => setSelectedDoctorId(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 p-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="">Select a doctor...</option>
                        {dashboard.activeStaff.map((doctor) => (
                          <option key={doctor.affiliationId} value={doctor.doctorId}>
                            {(doctor.doctorName ?? `Doctor ${doctor.doctorId}`) +
                              (doctor.specialization ? ` (${doctor.specialization})` : "")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Select Date
                      </label>
                      <input
                        type="date"
                        value={slotDate}
                        onChange={(event) => setSlotDate(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 p-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Hospital Scope
                      </label>
                      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {dashboard.hospital.name ?? "Hospital not linked"} • {dashboard.hospital.id ?? "No org id"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
                  <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold">2. Define Time Slots</h3>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Active Doctor: {selectedDoctorId || "Not selected"}
                    </span>
                  </div>

                  <div className="mb-8 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50 md:flex-row md:items-end">
                    <div className="flex-1">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                        className="w-full rounded-lg border-0 bg-white p-2 text-sm dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        End Time
                      </label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(event) => setEndTime(event.target.value)}
                        className="w-full rounded-lg border-0 bg-white p-2 text-sm dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                    <div className="w-full md:w-40">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Duration (Min)
                      </label>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={slotDurationMinutes}
                        onChange={(event) => setSlotDurationMinutes(Number(event.target.value) || 15)}
                        className="w-full rounded-lg border-0 bg-white p-2 text-sm dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCreateAvailability()}
                      disabled={dashboard.isSubmittingDoctorAction || !selectedDoctorId || generatedSlots.length === 0}
                      className="rounded-lg bg-slate-900 p-2.5 text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                      <Clock3 size={16} />
                    </button>
                  </div>

                  <div className="mb-8">
                    <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      Generated Slots ({generatedSlots.length})
                    </h4>
                    <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6">
                      {generatedSlots.length > 0 ? (
                        generatedSlots.map((slot) => (
                          <div
                            key={slot}
                            className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-center text-sm font-bold text-blue-700 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-300"
                          >
                            {slot}
                          </div>
                        ))
                      ) : (
                        <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                          Pick a valid date range and slot duration to preview generated slots.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => void handleLoadAvailability(selectedDoctorId)}
                        disabled={dashboard.isLoadingAvailability || !selectedDoctorId}
                        className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        {dashboard.isLoadingAvailability ? "Loading..." : "Load Current Availability"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateAvailability()}
                        disabled={dashboard.isSubmittingDoctorAction || !selectedDoctorId || generatedSlots.length === 0}
                        className="rounded-xl bg-blue-700 px-8 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Save Availability
                      </button>
                    </div>
                  </div>

                  {dashboard.availabilitySlots.length > 0 ? (
                    <div className="mt-6 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                      <h4 className="mb-3 text-sm font-bold">Loaded Availability</h4>
                      <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                        {dashboard.availabilitySlots.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between rounded-lg bg-white px-4 py-3 dark:bg-slate-900"
                          >
                            <span>{slot.dayOfWeek || "Unknown day"}</span>
                            <span>
                              {formatDisplayDate(slot.startTime)} - {formatDisplayDate(slot.endTime)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {dashboard.error ? (
                    <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      {dashboard.error}
                    </p>
                  ) : null}

                  {dashboard.doctorsMessage ? (
                    <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {dashboard.doctorsMessage}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {view === "audit" ? (
            <section className="space-y-8">
              <header className="flex items-end justify-between">
                <div>
                  <h1 className="flex items-center gap-3 font-headline text-3xl font-extrabold tracking-tight">
                    Local Audit Logs
                    <span className="rounded-full border border-cyan-200 bg-cyan-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-900/20 dark:text-cyan-300">
                      Scoped to {dashboard.hospital.id ?? "ORG"}
                    </span>
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Search and export live audit records related to this hospital workspace.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportAuditLogs}
                  className="text-sm font-bold text-blue-700 hover:underline dark:text-blue-400"
                >
                  Export Local CSV
                </button>
              </header>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr,auto]">
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="Search actor, action, or detail"
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void dashboard.refreshDashboard()}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-slate-700"
                  >
                    Search Local Logs
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Timestamp</th>
                        <th className="px-4 py-3 font-semibold">Actor</th>
                        <th className="px-4 py-3 font-semibold">Action</th>
                        <th className="px-4 py-3 font-semibold">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredAuditLogs.length > 0 ? (
                        filteredAuditLogs.map((row) => (
                          <tr
                            key={`${row.id}-${row.timestamp}`}
                            className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3 font-mono text-xs">{formatDisplayDate(row.timestamp)}</td>
                            <td className="px-4 py-3">
                              {row.actorName ?? row.actorId ?? "Unknown"}{" "}
                              <span className="ml-1 rounded bg-slate-200 px-2 py-0.5 text-[10px] dark:bg-slate-700">
                                {row.actorRole ?? "Unknown"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-blue-700 dark:text-blue-400">
                                {row.action ?? "UNKNOWN"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                              {row.details ?? "No detail"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                            No local audit rows matched your current search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
