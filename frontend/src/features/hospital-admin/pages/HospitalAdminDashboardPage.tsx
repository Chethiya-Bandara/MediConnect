import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Filter,
  LayoutDashboard,
  LogOut,
  Moon,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Stethoscope,
  Sun,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBrandMark } from "../../../components/ui";
import { useAuth } from "../../auth/context/AuthContext";
import { useHospitalAdminDashboard } from "../hooks/useHospitalAdminDashboard";
import type { AffiliationDecisionStatus, CreateAvailabilityPayload } from "../types";

type DashboardView = "overview" | "staffing" | "scheduling" | "audit";
type ThemeMode = "light" | "dark";
type StaffFilter = "all" | "pending" | "approved" | "revoked";

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

function formatSlotTime(value: string | null | undefined) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildSriLankaIso(slotDate: string, slotTime: string) {
  return `${slotDate}T${slotTime}:00+05:30`;
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

function noticeTone(message: string | null | undefined) {
  if (!message) return "neutral";
  const lowered = message.toLowerCase();
  if (
    lowered.includes("fail") ||
    lowered.includes("error") ||
    lowered.includes("invalid") ||
    lowered.includes("could not") ||
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

function getRelativeDayLabel(date: string) {
  const today = new Date();
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const delta = Math.round((target.getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return null;
}

export function HospitalAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const dashboard = useHospitalAdminDashboard();

  const [view, setView] = useState<DashboardView>("overview");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteHospitalId, setInviteHospitalId] = useState("");
  const [selectedAffiliationId, setSelectedAffiliationId] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [slotDate, setSlotDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(15);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingStartTime, setEditingStartTime] = useState("");
  const [editingEndTime, setEditingEndTime] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState<StaffFilter>("all");
  const [auditActionFilter, setAuditActionFilter] = useState("ALL");
  const [auditRoleFilter, setAuditRoleFilter] = useState("ALL");
  const [slotSaveMessage, setSlotSaveMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const deferredAuditSearch = useDeferredValue(auditSearch.trim().toLowerCase());
  const deferredStaffSearch = useDeferredValue(staffSearch.trim().toLowerCase());

  const schedulingDoctors = useMemo(() => {
    const seenDoctorIds = new Set<string>();
    return dashboard.activeStaff.filter((doctor) => {
      if (!doctor.doctorId || seenDoctorIds.has(doctor.doctorId)) {
        return false;
      }
      seenDoctorIds.add(doctor.doctorId);
      return true;
    });
  }, [dashboard.activeStaff]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("hospital-admin-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("hospital-admin-theme", theme);
  }, [theme]);

  useEffect(() => {
    const firstDoctorId = schedulingDoctors[0]?.doctorId ?? "";
    const selectedDoctorExists = schedulingDoctors.some(
      (doctor) => doctor.doctorId === selectedDoctorId,
    );

    if (!selectedDoctorExists && selectedDoctorId !== firstDoctorId) {
      setSelectedDoctorId(firstDoctorId);
    }
  }, [schedulingDoctors, selectedDoctorId]);

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

  useEffect(() => {
    if (!selectedDoctorId || !slotDate) {
      return;
    }

    void dashboard.loadAvailability(selectedDoctorId, slotDate);
  }, [selectedDoctorId, slotDate]);

  const generatedSlots = useMemo(
    () => buildGeneratedSlots(slotDate, startTime, endTime, slotDurationMinutes),
    [slotDate, startTime, endTime, slotDurationMinutes],
  );

  const filteredAuditLogs = useMemo(() => {
    return dashboard.auditLogs.filter((row) => {
      const matchesSearch = !deferredAuditSearch
        || [row.actorName, row.actorRole, row.action, row.details]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(deferredAuditSearch);
      const matchesAction = auditActionFilter === "ALL" || (row.action ?? "UNKNOWN") === auditActionFilter;
      const matchesRole = auditRoleFilter === "ALL" || (row.actorRole ?? "Unknown") === auditRoleFilter;
      return matchesSearch && matchesAction && matchesRole;
    });
  }, [auditActionFilter, auditRoleFilter, dashboard.auditLogs, deferredAuditSearch]);

  const filteredPendingAffiliations = useMemo(() => {
    return dashboard.pendingAffiliations.filter((row) => {
      const matchesStatus = staffFilter === "all" || staffFilter === "pending";
      const haystack = [
        row.doctorName,
        row.doctorEmail,
        row.doctorId,
        row.specialization,
        row.slmcNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !deferredStaffSearch || haystack.includes(deferredStaffSearch);
      return matchesStatus && matchesSearch;
    });
  }, [dashboard.pendingAffiliations, deferredStaffSearch, staffFilter]);

  const filteredActiveStaff = useMemo(() => {
    return dashboard.activeStaff.filter((row) => {
      const matchesStatus = staffFilter === "all" || staffFilter === "approved";
      const haystack = [
        row.doctorName,
        row.doctorEmail,
        row.doctorId,
        row.specialization,
        row.slmcNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !deferredStaffSearch || haystack.includes(deferredStaffSearch);
      return matchesStatus && matchesSearch;
    });
  }, [dashboard.activeStaff, deferredStaffSearch, staffFilter]);

  const selectedDoctor = useMemo(
    () => schedulingDoctors.find((doctor) => doctor.doctorId === selectedDoctorId) ?? null,
    [schedulingDoctors, selectedDoctorId],
  );

  const auditActionOptions = useMemo(
    () => Array.from(new Set(dashboard.auditLogs.map((row) => row.action ?? "UNKNOWN"))).sort(),
    [dashboard.auditLogs],
  );

  const auditRoleOptions = useMemo(
    () => Array.from(new Set(dashboard.auditLogs.map((row) => row.actorRole ?? "Unknown"))).sort(),
    [dashboard.auditLogs],
  );

  const slotValidationMessage = useMemo(() => {
    if (!selectedDoctorId) return "Pick a doctor before generating slots.";
    if (!slotDate) return "Pick a schedule date first.";
    if (slotDurationMinutes < 5) return "Slot duration should be at least 5 minutes.";
    if (endTime <= startTime) return "End time has to be later than start time.";
    if (generatedSlots.length === 0) return "This range produces zero bookable slots.";
    return null;
  }, [endTime, generatedSlots.length, selectedDoctorId, slotDate, slotDurationMinutes, startTime]);

  const generatedSlotSummary = useMemo(() => {
    if (generatedSlots.length === 0) {
      return null;
    }

    return {
      total: generatedSlots.length,
      first: generatedSlots[0],
      last: generatedSlots[generatedSlots.length - 1],
      sessionMinutes: generatedSlots.length * slotDurationMinutes,
      dayLabel: getRelativeDayLabel(slotDate),
    };
  }, [generatedSlots, slotDate, slotDurationMinutes]);

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
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const normalizedHospitalId = inviteHospitalId.trim();
    if (!normalizedEmail || !normalizedHospitalId) {
      return;
    }

    const success = await dashboard.sendInvite({
      doctorEmail: normalizedEmail,
      hospitalId: normalizedHospitalId,
    });

    if (success) {
      setInviteEmail("");
    }
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
    if (!selectedDoctorId || !slotDate || slotValidationMessage) {
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
    const success = await dashboard.addAvailability(payload);
    setSlotSaveMessage(
      success
        ? `Availability saved for ${formatShortDate(slotDate)} at ${new Date().toLocaleTimeString("en-LK", {
          hour: "2-digit",
          minute: "2-digit",
        })}.`
        : null,
    );
  };

  const handleLoadAvailability = async (doctorId: string) => {
    dashboard.setAvailabilityDoctorIdInput(doctorId);
    await dashboard.loadAvailability(doctorId, slotDate);
  };

  const startEditingSlot = (slotId: string, start: string | null, end: string | null) => {
    setEditingSlotId(slotId);
    setEditingStartTime(formatSlotTime(start));
    setEditingEndTime(formatSlotTime(end));
  };

  const cancelEditingSlot = () => {
    setEditingSlotId(null);
    setEditingStartTime("");
    setEditingEndTime("");
  };

  const saveEditedSlot = async () => {
    if (!editingSlotId || !selectedDoctorId || !slotDate) {
      return;
    }

    const success = await dashboard.editAvailability(
      {
        slotId: editingSlotId,
        startTime: buildSriLankaIso(slotDate, editingStartTime),
        endTime: buildSriLankaIso(slotDate, editingEndTime),
      },
      selectedDoctorId,
      slotDate,
    );
    if (success) {
      cancelEditingSlot();
    }
  };

  const deleteSlot = async (slotId: string) => {
    if (!selectedDoctorId) {
      return;
    }

    await dashboard.removeAvailability(slotId, selectedDoctorId, slotDate);
  };

  const exportAuditLogs = () => {
    if (filteredAuditLogs.length === 0) {
      setExportMessage("Nothing matched the current filters, so there is nothing useful to export.");
      return;
    }

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
    setExportMessage(`Exported ${filteredAuditLogs.length} audit row(s) to CSV.`);
  };

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <div className="min-h-screen bg-[#f7fafc] font-body text-[#181c1e] antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-50 px-4 py-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8 px-2">
            <AppBrandMark
              subtitle={dashboard.hospital.name ?? "Hospital Workspace"}
              subtitleClassName="text-[11px] tracking-[0.16em] normal-case"
            />
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
                      <span>Doctor</span>
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
                  <RefreshCcw size={16} />
                  Refresh
                </button>
              </header>

              <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[1.4fr,0.8fr,0.8fr]">
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                    <Search size={14} />
                    Search doctors
                  </span>
                  <input
                    type="text"
                    value={staffSearch}
                    onChange={(event) => setStaffSearch(event.target.value)}
                    placeholder="Name, email, doctor ID, specialization, SLMC"
                    className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                  />
                </label>

                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                    <Filter size={14} />
                    Affiliation state
                  </span>
                  <select
                    value={staffFilter}
                    onChange={(event) => setStaffFilter(event.target.value as StaffFilter)}
                    className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="all">All live staff data</option>
                    <option value="pending">Pending requests only</option>
                    <option value="approved">Approved staff only</option>
                    <option value="revoked">Revoked affiliations</option>
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      Pending visible
                    </p>
                    <p className="mt-2 text-2xl font-extrabold">
                      {filteredPendingAffiliations.length}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      Approved visible
                    </p>
                    <p className="mt-2 text-2xl font-extrabold">
                      {filteredActiveStaff.length}
                    </p>
                  </div>
                </div>
              </section>

              {staffFilter === "revoked" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  Revoked affiliation history is not included in the current backend dashboard payload yet, so this view only shows the live records currently available.
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.6fr,0.9fr]">
                <div className="space-y-8">
                  <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="font-headline text-lg font-bold">
                          Pending Affiliation Requests
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Review incoming hospital credentialing requests with live doctor metadata.
                        </p>
                      </div>
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                        {filteredPendingAffiliations.length} visible
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                          <tr>
                            <th className="px-6 py-4">Doctor</th>
                            <th className="px-6 py-4">Specialty</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">SLMC</th>
                            <th className="px-6 py-4">Requested</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredPendingAffiliations.length > 0 ? (
                            filteredPendingAffiliations.map((row) => (
                              <tr key={row.affiliationId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                      {buildInitials(row.doctorName)}
                                    </div>
                                    <div>
                                      <p className="font-bold text-sm">
                                        {row.doctorName ?? `Doctor ${row.doctorId}`}
                                      </p>
                                      <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {row.doctorEmail ?? `Doctor ID ${row.doctorId}`}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                                  {row.specialization ?? "Not set"}
                                </td>
                                <td className="px-6 py-4">
                                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {formatStatusLabel(row.status ?? "PENDING")}
                                  </span>
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
                              <td colSpan={6} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                {deferredStaffSearch
                                  ? "No pending affiliation requests matched your search."
                                  : "No pending affiliation requests right now."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-headline text-xl font-bold">
                          Active Medical Staff Directory
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Approved hospital staff with direct jump-off into schedule management.
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {filteredActiveStaff.length} visible
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      {filteredActiveStaff.length > 0 ? (
                        filteredActiveStaff.map((doctor) => (
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
                                <span>Status:</span>
                                <span>{formatStatusLabel(doctor.status ?? "APPROVED")}</span>
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
                          {deferredStaffSearch
                            ? "No approved staff matched your current doctor search."
                            : "No approved doctors are attached to this hospital yet."}
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <aside className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="font-headline text-lg font-bold">Invite Doctor</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Send an invite to a doctor to join the selected hospital.
                  </p>
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

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                    <p className="font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Before you send
                    </p>
                    <ul className="mt-3 space-y-2">
                      <li>Use the doctor&apos;s login email, not a personal alias.</li>
                      <li>Hospital ID must match the ID given to this hospital.</li>
                      <li>Pending invites will remain pending until the doctor accepts the invitation. After which, the doctor will join the hospital.</li>
                    </ul>
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
                    <p className={`rounded-xl border px-4 py-3 text-sm ${noticeClassName(dashboard.doctorsMessage)}`}>
                      {dashboard.doctorsMessage}
                    </p>
                  ) : null}

                  {dashboard.affiliationsMessage ? (
                    <p className={`rounded-xl border px-4 py-3 text-sm ${noticeClassName(dashboard.affiliationsMessage)}`}>
                      {dashboard.affiliationsMessage}
                    </p>
                  ) : null}
                </aside>
              </div>
            </section>
          ) : null}

          {view === "scheduling" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold tracking-tight">
                    Scheduling & Availability
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Generate availability slots and load live schedule data for affiliated doctors.
                  </p>
                </div>
                {generatedSlotSummary ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                    {generatedSlotSummary.dayLabel ? `${generatedSlotSummary.dayLabel} • ` : ""}
                    {generatedSlotSummary.total} slots from {generatedSlotSummary.first} to {generatedSlotSummary.last}
                  </div>
                ) : null}
              </header>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
                <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-blue-500 dark:text-blue-300">
                      Schedule Context
                    </p>
                    <h3 className="mt-2 text-lg font-extrabold">Doctor and day</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Selecting a doctor and date to load data.
                    </p>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Doctor
                      </label>
                      <select
                        value={selectedDoctorId}
                        onChange={(event) => setSelectedDoctorId(event.target.value)}
                        className="w-full rounded-xl border-0 bg-slate-100 p-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="">Select a doctor...</option>
                        {schedulingDoctors.map((doctor) => (
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
                    <button
                      type="button"
                      onClick={() => void handleLoadAvailability(selectedDoctorId)}
                      disabled={dashboard.isLoadingAvailability || !selectedDoctorId}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <RefreshCcw size={15} />
                      {dashboard.isLoadingAvailability ? "Loading Slots..." : "Refresh Day Slots"}
                    </button>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4 text-sm dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      Selected
                    </p>
                    <p className="mt-2 font-bold">
                      {selectedDoctor?.doctorName ?? (selectedDoctorId ? `Doctor ${selectedDoctorId}` : "No doctor")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatShortDate(slotDate)} • {dashboard.availabilitySlots.length} loaded slot(s)
                    </p>
                  </div>
                </aside>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-6">
                    <h3 className="text-lg font-bold">2. Define Time Slots</h3>
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
                  </div>

                  {slotValidationMessage ? (
                    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                      {slotValidationMessage}
                    </div>
                  ) : null}

                  {generatedSlotSummary ? (
                    <div className="mb-6 grid gap-3 md:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                          Total slots
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{generatedSlotSummary.total}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                          First slot
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{generatedSlotSummary.first}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                          Last slot
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{generatedSlotSummary.last}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                          Session minutes
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{generatedSlotSummary.sessionMinutes}</p>
                      </div>
                    </div>
                  ) : null}

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
                      <div>
                        <p className="text-sm font-bold">Ready to publish</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Existing slots are checked before new ones are inserted.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCreateAvailability()}
                        disabled={dashboard.isSubmittingDoctorAction || Boolean(slotValidationMessage)}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-8 py-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Save size={16} />
                        {dashboard.isSubmittingDoctorAction ? "Saving..." : "Save Availability"}
                      </button>
                    </div>
                  </div>

                  {slotSaveMessage ? (
                    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeClassName(slotSaveMessage)}`}>
                      {slotSaveMessage}
                    </div>
                  ) : null}

                  <div className="mt-6 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold">Existing Slots For {formatShortDate(slotDate)}</h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Edit or delete open slots. Booked slots cannot be cancelled.
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        {dashboard.availabilitySlots.length} loaded
                      </span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {dashboard.availabilitySlots.length > 0 ? (
                        dashboard.availabilitySlots.map((slot) => {
                          const isEditing = editingSlotId === slot.id;

                          return (
                            <div
                              key={slot.id}
                              className="flex flex-col gap-3 rounded-xl bg-white px-4 py-3 dark:bg-slate-900 md:flex-row md:items-center md:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-slate-900 dark:text-slate-100">
                                    {slot.dayOfWeek || "Selected day"}
                                  </span>
                                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                    slot.isBooked
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  }`}>
                                    {slot.isBooked ? "Booked" : "Open"}
                                  </span>
                                </div>
                                {isEditing ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <input
                                      type="time"
                                      value={editingStartTime}
                                      onChange={(event) => setEditingStartTime(event.target.value)}
                                      className="rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800 dark:text-white"
                                    />
                                    <input
                                      type="time"
                                      value={editingEndTime}
                                      onChange={(event) => setEditingEndTime(event.target.value)}
                                      className="rounded-lg border-0 bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800 dark:text-white"
                                    />
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {formatDisplayDate(slot.startTime)} - {formatDisplayDate(slot.endTime)}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void saveEditedSlot()}
                                      disabled={dashboard.isSubmittingDoctorAction}
                                      className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                                    >
                                      <CheckCircle2 size={14} />
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditingSlot}
                                      className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                      <XCircle size={14} />
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => startEditingSlot(slot.id, slot.startTime, slot.endTime)}
                                      disabled={slot.isBooked}
                                      className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                      <Pencil size={14} />
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteSlot(slot.id)}
                                      disabled={slot.isBooked || dashboard.isSubmittingDoctorAction}
                                      className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300"
                                    >
                                      <Trash2 size={14} />
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                          {dashboard.isLoadingAvailability
                            ? "Loading availability for this day..."
                            : "No slots exist for this doctor on the selected date yet."}
                        </div>
                      )}
                    </div>
                  </div>

                  {dashboard.error ? (
                    <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                      {dashboard.error}
                    </p>
                  ) : null}

                  {dashboard.doctorsMessage ? (
                    <p className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeClassName(dashboard.doctorsMessage)}`}>
                      {dashboard.doctorsMessage}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {view === "audit" ? (
            <section className="space-y-8">
              <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
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
                  disabled={filteredAuditLogs.length === 0}
                  className="text-sm font-bold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400"
                >
                  Export Local CSV
                </button>
              </header>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr,0.8fr,0.8fr,auto,auto]">
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="Search actor, action, or detail"
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                  />
                  <select
                    value={auditRoleFilter}
                    onChange={(event) => setAuditRoleFilter(event.target.value)}
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
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
                    className="rounded-xl border-0 bg-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
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
                    Search Local Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditSearch("");
                      setAuditRoleFilter("ALL");
                      setAuditActionFilter("ALL");
                    }}
                    className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Clear Filters
                  </button>
                </div>

                <div className="mb-6 flex flex-wrap gap-3">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                            {dashboard.isLoadingDashboard
                              ? "Refreshing audit logs..."
                              : "No local audit rows matched the current search and filters."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {exportMessage ? (
                  <div className={`mt-6 rounded-xl border px-4 py-3 text-sm ${noticeClassName(exportMessage)}`}>
                    {exportMessage}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
