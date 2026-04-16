import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardPlus,
  FileArchive,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  LogOut,
  MessageCircle,
  MoonStar,
  Pill,
  Plus,
  Search,
  SendHorizontal,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/context/AuthContext";
import {
  askDoctorAssistant,
  getDoctorDashboard,
  submitDoctorEncounter,
  updateDoctorProfile,
} from "../api/doctorApi";
import type {
  DoctorActivePatient,
  DoctorDashboardData,
  DoctorScheduleItem,
} from "../types";

type DoctorPage = "overview" | "encounter" | "appointments" | "settings";
type DoctorModal = "submit" | "urgent" | "archives" | null;
type Theme = "light" | "dark";

type DraftPrescriptionItem = {
  id: string;
  medicine_name: string;
  dosage: string;
  duration: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const navItems = [
  { id: "overview", label: "Doctor Overview", icon: LayoutDashboard },
  { id: "encounter", label: "Encounter Record", icon: ClipboardPlus },
  { id: "appointments", label: "Schedule", icon: CalendarDays },
  { id: "settings", label: "Profile Settings", icon: Settings },
] as const;

const commonIcdSuggestions = [
  { code: "I10", name: "Essential (primary) hypertension" },
  { code: "E11", name: "Type 2 diabetes mellitus" },
  { code: "J00", name: "Acute nasopharyngitis [common cold]" },
  { code: "M54.5", name: "Low back pain" },
] as const;

function makeDraftMedicine(
  medicine_name: string,
  dosage: string,
  duration: string,
): DraftPrescriptionItem {
  return {
    id: `med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    medicine_name,
    dosage,
    duration,
  };
}

function makeChat(role: "assistant" | "user", text: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid date";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTimelineTone(item: DoctorScheduleItem) {
  const status = item.status.toLowerCase();
  if (status === "completed") {
    return "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  }
  if (status === "cancelled") {
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  }
  if (item.consent.granted) {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  }
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
}

function getScheduleBadge(item: DoctorScheduleItem) {
  const status = item.status.toLowerCase();
  if (status === "completed") {
    return "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  }
  if (status === "cancelled") {
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  }
  if (item.encounter) {
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  }
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
}

function buildInitialAssistantMessage(activePatient: DoctorActivePatient | null, scheduleCount: number) {
  if (!activePatient) {
    return "No active patient is loaded from the database yet. I can still summarize your schedule once appointments show up.";
  }

  return (
    `You are viewing ${activePatient.patient.name}. ` +
    `There are ${activePatient.summary.medical_records} saved records and ${scheduleCount} total appointments in your queue.`
  );
}

export function DoctorDashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState<DoctorPage>("encounter");
  const [theme, setTheme] = useState<Theme>("light");
  const [modal, setModal] = useState<DoctorModal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DoctorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnosisInput, setDiagnosisInput] = useState("");
  const [encounterType, setEncounterType] = useState("Routine Follow-up");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [medDuration, setMedDuration] = useState("");
  const [prescriptionDraft, setPrescriptionDraft] = useState<DraftPrescriptionItem[]>([]);
  const [submittingEncounter, setSubmittingEncounter] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSpecialization, setProfileSpecialization] = useState("");
  const [profileSlmcNumber, setProfileSlmcNumber] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const activePatient = dashboard?.active_patient ?? null;
  const doctorName =
    dashboard?.user.name?.trim() ||
    dashboard?.user.email ||
    "Doctor";
  const avatarSeed = encodeURIComponent(doctorName);

  const filteredCodes = useMemo(() => {
    const query = diagnosisInput.trim().toLowerCase();
    if (!query) return [];
    return commonIcdSuggestions.filter(
      (item) =>
        item.code.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query),
    );
  }, [diagnosisInput]);

  const queueItems = useMemo(() => {
    const schedule = dashboard?.schedule ?? [];
    return schedule.slice(0, 6);
  }, [dashboard]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getDoctorDashboard();
      setDashboard(payload);
      setProfileName(payload.user.name ?? "");
      setProfileSpecialization(payload.doctor.specialization ?? "");
      setProfileSlmcNumber(payload.doctor.slmc_number ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Doctor dashboard could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("patient-dashboard-theme");
    setTheme(saved === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("patient-dashboard-theme", theme);
  }, [theme]);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const storageKey = `doctor-chat-history-${dashboard?.user.id ?? "guest"}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ChatMessage[];
        if (parsed.length > 0) {
          setChatMessages(parsed);
          return;
        }
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    setChatMessages([
      makeChat(
        "assistant",
        buildInitialAssistantMessage(activePatient, dashboard?.schedule.length ?? 0),
      ),
    ]);
  }, [dashboard?.user.id, activePatient, dashboard?.schedule.length]);

  useEffect(() => {
    if (!dashboard?.user.id || chatMessages.length === 0) return;
    localStorage.setItem(
      `doctor-chat-history-${dashboard.user.id}`,
      JSON.stringify(chatMessages),
    );
  }, [chatMessages, dashboard?.user.id]);

  const logoutNow = () => {
    logout();
    navigate("/login");
  };

  const addMedicine = () => {
    const medicine_name = medName.trim();
    if (!medicine_name) return;

    setPrescriptionDraft((current) => [
      ...current,
      makeDraftMedicine(medicine_name, medDose.trim(), medDuration.trim()),
    ]);
    setMedName("");
    setMedDose("");
    setMedDuration("");
    showToast("Medicine added to the encounter draft.");
  };

  const submitEncounter = async () => {
    if (!activePatient) {
      showToast("No active patient is selected yet.");
      return;
    }

    if (!diagnosisInput.trim() || !clinicalNotes.trim()) {
      showToast("Diagnosis and clinical notes are required.");
      return;
    }

    setSubmittingEncounter(true);
    try {
      await submitDoctorEncounter({
        patient_id: activePatient.patient.id,
        appointment_id: activePatient.appointment.id,
        diagnosis: diagnosisInput.trim(),
        encounter_type: encounterType,
        clinical_notes: clinicalNotes.trim(),
        prescription_items: prescriptionDraft.map((item) => ({
          medicine_name: item.medicine_name,
          dosage: item.dosage,
          duration: item.duration,
        })),
      });
      setModal(null);
      setDiagnosisInput("");
      setClinicalNotes("");
      setPrescriptionDraft([]);
      showToast("Encounter and prescription saved.");
      await loadDashboard();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Encounter could not be saved");
    } finally {
      setSubmittingEncounter(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateDoctorProfile({
        name: profileName.trim(),
        specialization: profileSpecialization.trim(),
        slmc_number: profileSlmcNumber.trim(),
      });
      showToast("Doctor profile updated.");
      await loadDashboard();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Profile update failed");
    } finally {
      setSavingProfile(false);
    }
  };

  const sendMessage = async (preset?: string) => {
    const text = (preset ?? chatInput).trim();
    if (!text || chatLoading) return;

    const nextHistory = [...chatMessages, makeChat("user", text)];
    setChatMessages(nextHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await askDoctorAssistant({
        message: text,
        patient_id: activePatient?.patient.id,
        history: nextHistory.map((item) => ({
          role: item.role,
          text: item.text,
        })),
      });
      setChatMessages((current) => [
        ...current,
        makeChat("assistant", response.answer),
      ]);
    } catch (err) {
      setChatMessages((current) => [
        ...current,
        makeChat(
          "assistant",
          err instanceof Error ? err.message : "Assistant is unavailable right now.",
        ),
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const onChatKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      void sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface dark:bg-slate-950">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <LoaderCircle className="animate-spin" size={18} />
          Loading doctor workspace...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-6 dark:bg-slate-950">
        <div className="w-full max-w-2xl rounded-3xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900/40 dark:bg-slate-900">
          <h2 className="text-2xl font-bold text-red-700 dark:text-red-300">Doctor dashboard failed to load</h2>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="mt-6 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-100 bg-slate-50 py-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-white shadow-lg">
              <ShieldCheck size={20} />
            </div>
            <div>
              <p className="font-headline font-bold text-blue-900 dark:text-blue-400">Health Identity</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">PRO DOCTOR</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPage(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
                    : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1 px-4">
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-4 dark:border-red-900/30 dark:bg-red-950/20">
            <button
              type="button"
              onClick={() => setModal("urgent")}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 py-2 text-xs font-bold uppercase text-white"
            >
              <ShieldAlert size={14} />
              ER Protocol
            </button>
          </div>
          <button type="button" className="flex w-full items-center gap-3 px-4 py-2 text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <HelpCircle size={14} />
            Help Center
          </button>
          <button type="button" onClick={logoutNow} className="flex w-full items-center gap-3 px-4 py-2 text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>

      <header className="fixed left-64 right-0 top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white/80 px-8 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="font-headline text-xl font-extrabold text-blue-900 dark:text-blue-400">Clinical Workspace</h1>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Active Patient:</span>
              <span className="text-sm font-semibold dark:text-slate-200">
                {activePatient?.patient.name ?? "No patient selected"}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {activePatient?.patient.dhid ? `DHID: ${activePatient.patient.dhid}` : "Awaiting booking"}
              </span>
            </div>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 lg:block dark:bg-slate-700" />
          <div className="hidden items-center gap-2 lg:flex">
            <span className={`h-2 w-2 rounded-full ${activePatient?.appointment.consent.granted ? "animate-pulse bg-green-500" : "bg-amber-500"}`} />
            <span className="text-xs font-bold uppercase text-green-700 dark:text-green-400">
              Consent: {activePatient?.appointment.consent.status ?? "Unavailable"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
          </button>
          <div className="relative">
            <Bell className="text-slate-500 dark:text-slate-400" size={22} />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full border-2 border-white bg-red-600 dark:border-slate-900" />
          </div>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-700">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold dark:text-slate-200">{doctorName}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                {dashboard?.doctor.specialization ?? "Specialization pending"}
              </p>
            </div>
            <button type="button" onClick={() => setPage("settings")} className="h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-blue-100 shadow-sm dark:border-slate-800 dark:bg-blue-900">
              <img className="h-full w-full object-cover" src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`} alt="Doctor avatar" />
            </button>
          </div>
        </div>
      </header>

      <main className="ml-64 flex min-h-screen flex-col">
        <div className="flex-1 px-8 pb-12 pt-24">
          {page === "overview" ? (
            <section className="animate-fadeIn">
              <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-3xl font-extrabold text-blue-900 dark:text-blue-400">Doctor Dashboard</h2>
                  <p className="mt-1 text-sm text-slate-500">Live clinical summary.</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Today&apos;s Date</p>
                  <p className="text-lg font-bold dark:text-white">{formatDate(new Date().toISOString())}</p>
                </div>
              </div>
              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><UserRound className="mb-4 text-blue-500" size={28} /><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Patients Seen Today</p><p className="text-3xl font-black dark:text-white">{dashboard?.stats.patients_seen_today ?? 0}</p></div>
                <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><AlertTriangle className="mb-4 text-orange-500" size={28} /><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pending Reports</p><p className="text-3xl font-black dark:text-white">{dashboard?.stats.pending_reports ?? 0}</p></div>
                <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><FileArchive className="mb-4 text-green-500" size={28} /><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Recorded Encounters</p><p className="text-3xl font-black dark:text-white">{dashboard?.stats.recorded_encounters ?? 0}</p></div>
                <div className="relative overflow-hidden rounded-3xl bg-primary p-6 text-white shadow-xl"><ClipboardPlus className="mb-4" size={28} /><p className="text-[10px] font-bold uppercase tracking-widest text-blue-200">Current Patient</p><p className="text-xl font-bold">{activePatient?.patient.name ?? "No active session"}</p><button type="button" onClick={() => setPage("encounter")} className="mt-2 text-xs font-bold underline">Open Encounter →</button></div>
              </div>
              <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-6 flex items-center justify-between"><h3 className="text-lg font-bold dark:text-white">Upcoming In Queue</h3><button type="button" onClick={() => setPage("appointments")} className="text-sm font-bold text-primary dark:text-blue-400">View Full Schedule</button></div>
                <div className="space-y-4">
                  {queueItems.length > 0 ? queueItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-2xl border border-transparent bg-slate-50 p-4 dark:bg-slate-800/50">
                      <div className="flex items-center gap-4"><div className="flex h-10 w-14 items-center justify-center rounded-xl bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-900/50 dark:text-blue-300">{formatDateTime(item.start_time).split(", ").slice(-1)[0]}</div><div><p className="font-bold dark:text-white">{item.patient.name}</p><p className="text-xs text-slate-500">{item.organisation.name} • {item.patient.dhid ?? "DHID pending"}</p></div></div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getScheduleBadge(item)}`}>{item.status}</span>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                      No schedule rows yet. Once patients book you through affiliated organisations, queue items will show here.
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {page === "encounter" ? (
            <section className="grid grid-cols-12 gap-8 animate-fadeIn">
              <div className="col-span-12 space-y-8 lg:col-span-8">
                <div className="flex items-start gap-4 rounded-2xl border border-amber-200/50 bg-[#ffdcc7] p-5 text-amber-900 shadow-sm dark:border-amber-700/30 dark:bg-amber-900/30 dark:text-amber-100">
                  <div className="rounded-xl bg-white/50 p-2 dark:bg-amber-800/50"><Sparkles size={18} /></div>
                  <div className="flex-1">
                    <h4 className="font-headline text-xs font-bold uppercase tracking-widest">Clinical Guard</h4>
                    <p className="mt-1 text-sm leading-relaxed">
                      {activePatient
                        ? activePatient.latest_record?.notes
                          ? "Latest patient record is loaded below. Double-check consent and update the encounter instead of winging it."
                          : "There is an active patient, but no previous encounter note is saved yet. Your next submit becomes the first real record."
                        : "No active patient is loaded. Get affiliations and bookings first."}
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary dark:text-blue-400"><ClipboardPlus size={18} />Encounter Details</h3>
                  {activePatient ? (
                    <>
                      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Primary Diagnosis (ICD-10 quick search)</label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input value={diagnosisInput} onChange={(event) => setDiagnosisInput(event.target.value)} className="w-full rounded-xl border-0 bg-slate-50 py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white" placeholder="Search or type diagnosis..." />
                            {filteredCodes.length > 0 ? (
                              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                                {filteredCodes.map((item) => (
                                  <button key={item.code} type="button" onClick={() => setDiagnosisInput(`${item.code} - ${item.name}`)} className="flex w-full justify-between border-b border-slate-50 px-4 py-3 text-left text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700">
                                    <span className="font-bold text-blue-700 dark:text-blue-300">{item.code}</span>
                                    <span className="text-slate-500 dark:text-slate-400">{item.name}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Encounter Type</label>
                          <select value={encounterType} onChange={(event) => setEncounterType(event.target.value)} className="w-full rounded-xl border-0 bg-slate-50 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white">
                            <option>Routine Follow-up</option>
                            <option>Acute Consultation</option>
                            <option>Specialist Referral</option>
                          </select>
                        </div>
                      </div>
                      <div className="mb-8 space-y-2">
                        <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Clinical Notes</label>
                        <textarea value={clinicalNotes} onChange={(event) => setClinicalNotes(event.target.value)} className="w-full resize-none rounded-xl border-0 bg-slate-50 px-4 py-4 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white" placeholder="Document findings and assessment..." rows={6} />
                      </div>
                      <div className="space-y-2">
                        <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Attachments</label>
                        <div className="mt-2 flex flex-wrap gap-4">
                          <button type="button" onClick={() => showToast("Attachment storage is not wired yet, so no fake upload drama here.")} className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Plus className="text-slate-400" size={18} /><span className="text-[8px] font-bold uppercase text-slate-400">ADD</span></button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                      No active patient yet.
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-8 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-primary dark:text-blue-400"><Pill size={18} />ePrescription</h3>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="text-green-500" size={16} />
                      <span className="text-[10px] font-black uppercase tracking-widest text-green-600 dark:text-green-400">DB Ready</span>
                    </div>
                  </div>
                  <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <input value={medName} onChange={(event) => setMedName(event.target.value)} className="rounded-xl border-0 bg-slate-50 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white" placeholder="Drug name" />
                    <input value={medDose} onChange={(event) => setMedDose(event.target.value)} className="rounded-xl border-0 bg-slate-50 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white" placeholder="Dosage" />
                    <input value={medDuration} onChange={(event) => setMedDuration(event.target.value)} className="rounded-xl border-0 bg-slate-50 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-container dark:bg-slate-800 dark:text-white" placeholder="Duration" />
                    <button type="button" onClick={addMedicine} className="flex items-center justify-center rounded-xl bg-primary-container py-3 text-white shadow-md shadow-blue-500/20 hover:bg-primary">
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-100 text-[10px] uppercase text-slate-400 dark:border-slate-800">
                        <tr>
                          <th className="px-2 pb-3">Medication</th>
                          <th className="px-2 pb-3">Dosage</th>
                          <th className="px-2 pb-3">Duration</th>
                          <th className="px-2 pb-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {prescriptionDraft.length > 0 ? prescriptionDraft.map((item) => (
                          <tr key={item.id} className="border-b border-slate-50 dark:border-slate-800/50">
                            <td className="px-2 py-4 font-bold dark:text-slate-200">{item.medicine_name}</td>
                            <td className="px-2 py-4 text-slate-500 dark:text-slate-400">{item.dosage || "As directed"}</td>
                            <td className="px-2 py-4 text-slate-500 dark:text-slate-400">{item.duration || "N/A"}</td>
                            <td className="px-2 py-4 text-right">
                              <button type="button" onClick={() => setPrescriptionDraft((current) => current.filter((entry) => entry.id !== item.id))} className="rounded-lg bg-red-50 p-2 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                              No prescription items added yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-span-12 space-y-6 lg:col-span-4">
                <button type="button" onClick={() => setModal("archives")} className="group flex w-full items-center justify-between rounded-2xl bg-secondary p-4 text-white shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-white/20 p-2"><FolderOpen size={18} /></div>
                    <div className="text-left">
                      <p className="font-bold">Medical Archives</p>
                      <p className="text-[10px] uppercase tracking-widest opacity-80">Saved patient records</p>
                    </div>
                  </div>
                  <ChevronRight className="transition-transform group-hover:translate-x-1" size={18} />
                </button>

                <div className="rounded-3xl bg-primary p-6 text-white shadow-xl">
                  <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest opacity-60">Patient Profile</h4>
                  {activePatient ? (
                    <>
                      <div className="mb-6 flex items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl border border-white/30 bg-white/20 p-1">
                          <img className="h-full w-full rounded-xl object-cover" src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(activePatient.patient.name)}`} alt={activePatient.patient.name} />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold">{activePatient.patient.name}</h2>
                          <p className="text-xs opacity-70">{activePatient.patient.dhid ?? "DHID pending"} • {activePatient.patient.email ?? "No email saved"}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/5 bg-white/10 p-3"><p className="text-[8px] font-bold uppercase opacity-60">Records</p><p className="text-lg font-bold">{activePatient.summary.medical_records}</p></div>
                        <div className="rounded-xl border border-white/5 bg-white/10 p-3"><p className="text-[8px] font-bold uppercase opacity-60">Prescriptions</p><p className="text-lg font-bold">{activePatient.summary.active_prescriptions}</p></div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-blue-100/80">No patient is attached to the current doctor session yet.</p>
                  )}
                </div>

                <div className="rounded-3xl border border-red-100 bg-red-50 p-6 shadow-sm dark:border-red-900/30 dark:bg-red-950/20">
                  <h4 className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-red-600 dark:text-red-400"><AlertTriangle size={12} />Patient Allergies</h4>
                  <div className="flex flex-wrap gap-2">
                    {activePatient?.allergies.length ? activePatient.allergies.map((item) => (
                      <span key={item} className="rounded-lg bg-red-600 px-3 py-1 text-[10px] font-bold uppercase text-white">{item}</span>
                    )) : (
                      <span className="rounded-lg bg-slate-200 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">No allergy data saved</span>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Clinical History</h4>
                  <div className="relative space-y-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-slate-100 dark:before:bg-slate-800">
                    {activePatient?.history.length ? activePatient.history.slice(0, 5).map((item, index) => (
                      <div key={item.id} className="relative pl-6">
                        <div className={`absolute left-0 top-1.5 z-10 h-4 w-4 rounded-full border-4 border-white dark:border-slate-900 ${index === 0 ? "bg-primary" : "bg-slate-300 dark:bg-slate-700"}`} />
                        <p className="text-[10px] font-bold text-slate-400">{formatDate(item.created_at)}</p>
                        <p className="text-sm font-bold dark:text-slate-200">{item.notes?.split("\n")[0] ?? "Encounter record"}</p>
                        <p className="text-[10px] text-slate-500">{item.doctor_name}{item.organisation_name ? ` • ${item.organisation_name}` : ""}</p>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No clinical history saved for the active patient yet.</p>
                    )}
                  </div>
                </div>

                <div className="sticky bottom-6 z-10 bg-surface pb-2 pt-4 dark:bg-slate-950">
                  <button type="button" onClick={() => setModal("submit")} disabled={!activePatient || submittingEncounter} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-bold text-white shadow-lg shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-60">
                    {submittingEncounter ? <LoaderCircle className="animate-spin" size={18} /> : <Lock size={18} />}
                    Finish & Submit
                  </button>
                  <p className="mt-3 text-center text-[9px] italic text-slate-400">On submit, the  encounter is saved and the appointment is marked completed.</p>
                </div>
              </div>
            </section>
          ) : null}

          {page === "appointments" ? (
            <section className="mx-auto max-w-4xl animate-fadeIn">
              <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div><h2 className="text-3xl font-extrabold text-blue-900 dark:text-blue-400">Clinical Schedule</h2><p className="mt-1 text-sm text-slate-500">Appointments for the doctor.</p></div>
                <div className="flex items-center gap-4"><button type="button" onClick={() => showToast("Availability management is not wired yet.")} className="rounded-xl bg-primary px-5 py-3 text-xs font-bold text-white shadow-md">Manage Availability Slots</button><div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"><CalendarDays className="text-slate-400" size={18} /><span className="text-sm font-bold dark:text-slate-200">{formatDate(new Date().toISOString())}</span></div></div>
              </div>
              <div className="relative rounded-3xl border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="absolute bottom-12 left-16 top-12 w-px bg-slate-200 dark:bg-slate-700" />
                <div className="space-y-8">
                  {dashboard?.schedule.length ? dashboard.schedule.map((item) => (
                    <div key={item.id} className="relative flex items-start gap-6">
                      <div className="w-16 pt-1 text-right"><p className="text-sm font-bold dark:text-slate-300">{formatDateTime(item.start_time).split(", ").slice(-1)[0]}</p><p className="text-[10px] font-bold tracking-widest text-slate-500">{item.start_time ? new Date(item.start_time).toLocaleTimeString([], { hour12: true }).split(" ")[1] : "--"}</p></div>
                      <div className={`absolute left-16 top-2 z-10 h-3 w-3 -translate-x-1/2 rounded-full ring-4 ring-white dark:ring-slate-900 ${getTimelineTone(item)}`} />
                      <div className="flex-1 rounded-2xl border border-slate-100 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-lg font-bold dark:text-slate-200">{item.patient.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{item.organisation.name} • {item.patient.dhid ?? "DHID pending"}</p>
                            <p className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-300">Consent: {item.consent.status}</p>
                          </div>
                          <button type="button" onClick={() => { setPage("encounter"); setDiagnosisInput(""); setClinicalNotes(""); setPrescriptionDraft([]); }} className="rounded-lg bg-primary px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">
                            {item.encounter ? "Review" : "Open"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                      No appointments yet.
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {page === "settings" ? (
            <section className="mx-auto max-w-3xl animate-fadeIn">
              <h2 className="mb-8 text-3xl font-extrabold text-blue-900 dark:text-blue-400">Doctor Profile & Settings</h2>
              <div className="space-y-8 rounded-3xl border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div><h3 className="mb-4 border-b border-slate-100 pb-2 text-lg font-bold dark:border-slate-800 dark:text-white">Professional Identity</h3><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><div><label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Full Name & Title</label><input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} className="w-full rounded-xl border-0 bg-slate-50 px-4 py-3 shadow-inner dark:bg-slate-800 dark:text-white" /></div><div><label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">SLMC Reg Number</label><input type="text" value={profileSlmcNumber} onChange={(event) => setProfileSlmcNumber(event.target.value)} className="w-full rounded-xl border-0 bg-slate-50 px-4 py-3 shadow-inner dark:bg-slate-800 dark:text-white" /></div><div className="md:col-span-2"><label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Specialization</label><input type="text" value={profileSpecialization} onChange={(event) => setProfileSpecialization(event.target.value)} className="w-full rounded-xl border-0 bg-slate-50 px-4 py-3 shadow-inner dark:bg-slate-800 dark:text-white" /></div></div></div>
                <div><h3 className="mb-4 border-b border-slate-100 pb-2 text-lg font-bold dark:border-slate-800 dark:text-white">Hospital Affiliations</h3><div className="space-y-3">{dashboard?.affiliations.length ? dashboard.affiliations.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                    <p className="font-bold dark:text-slate-200">{item.organisation.name}</p>
                    <p className="text-xs text-slate-500">{item.organisation.type ?? "Organisation type unavailable"} • {item.status}</p>
                  </div>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">No doctor affiliations saved yet. That is why schedule/booking looks empty too.</div>}</div></div>
                <div><h3 className="mb-4 border-b border-slate-100 pb-2 text-lg font-bold dark:border-slate-800 dark:text-white">Credential Upload</h3><div className="flex flex-col gap-2"><label className="cursor-pointer rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800"><span className="flex items-center gap-3"><Upload size={16} /><span className="text-sm dark:text-white">Credential upload UI only</span></span><input type="file" accept=".pdf,.jpg,.jpeg" className="hidden" /></label><p className="text-[10px] font-medium text-slate-500">Real storage pipeline is still not wired, so this stays visual for now instead of lying to you.</p></div></div>
                <div><h3 className="mb-4 border-b border-slate-100 pb-2 text-lg font-bold dark:border-slate-800 dark:text-white">System Preferences</h3><div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50"><div><p className="text-sm font-bold dark:text-slate-200">Dark Mode Interface</p><p className="text-xs text-slate-500">Same shared theme as the rest of the portal.</p></div><button type="button" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white">Toggle Theme</button></div></div>
                <div className="border-t border-slate-100 pt-6 text-right dark:border-slate-800"><button type="button" onClick={() => void saveProfile()} disabled={savingProfile} className="rounded-xl bg-green-600 px-8 py-3 font-bold text-white shadow-lg shadow-green-600/20 disabled:cursor-not-allowed disabled:opacity-60">{savingProfile ? "Saving..." : "Save Configuration"}</button></div>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="border-t border-slate-100 bg-slate-50 px-8 py-12 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
            <div><p className="text-sm font-bold dark:text-slate-300">National Health Identity System</p><p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">© 2026 Digital Health Ministry SL • Doctor Portal v3.1</p></div>
            <div className="flex gap-8">{["Privacy", "Terms", "Security"].map((item) => <a key={item} href="#" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:underline">{item}</a>)}</div>
          </div>
        </footer>
      </main>

      {modal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={(event) => event.target === event.currentTarget && setModal(null)}>
          {modal === "submit" ? (
            <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl dark:bg-slate-900">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"><Lock size={28} /></div>
              <h3 className="mb-2 text-xl font-bold dark:text-white">Finalize & Lock?</h3>
              <p className="mb-8 text-sm leading-relaxed text-slate-500 dark:text-slate-400">This saves the encounter and pushes the prescription into the actual patient record.</p>
              <div className="flex gap-3"><button type="button" onClick={() => setModal(null)} className="flex-1 rounded-xl bg-slate-100 py-3 font-bold dark:bg-slate-800">Cancel</button><button type="button" onClick={() => void submitEncounter()} disabled={submittingEncounter || !activePatient} className="flex-1 rounded-xl bg-primary py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{submittingEncounter ? "Saving..." : "Submit"}</button></div>
            </div>
          ) : null}

          {modal === "urgent" ? (
            <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl dark:bg-slate-900">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"><ShieldAlert size={28} /></div>
              <h3 className="mb-2 text-xl font-bold dark:text-white">Activate Emergency Protocol?</h3>
              <p className="mb-6 text-sm leading-relaxed text-slate-500 dark:text-slate-400">UI is ready, but the real ER escalation backend is not wired yet. So this button will stay honest instead of pretending to alert the universe.</p>
              <div className="flex gap-3"><button type="button" onClick={() => setModal(null)} className="flex-1 rounded-xl bg-slate-100 py-3 font-bold dark:bg-slate-800">Go Back</button><button type="button" onClick={() => { setModal(null); showToast("ER escalation backend is not wired yet."); }} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white">Acknowledge</button></div>
            </div>
          ) : null}

          {modal === "archives" ? (
            <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-3xl bg-white p-8 shadow-2xl dark:bg-slate-900">
              <div className="mb-6 flex items-center justify-between">
                <div><h3 className="text-2xl font-bold dark:text-white">{activePatient?.patient.name ?? "Patient"} archives</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Saved encounters and prescriptions only. No fake file props.</p></div>
                <button type="button" onClick={() => setModal(null)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
              </div>
              <div className="space-y-4 overflow-y-auto pr-2">
                {activePatient?.archives.length ? activePatient.archives.map((item) => (
                  <div key={item.id} className="group flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                    <div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">{item.type === "prescription" ? <Pill size={18} /> : <FileArchive size={18} />}</div><div><p className="font-bold dark:text-slate-200">{item.title}</p><p className="text-xs font-medium text-slate-500">{item.meta}</p></div></div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.type}</span>
                  </div>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">No saved archives for the active patient yet.</div>}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        <div className={`${chatOpen ? "flex" : "hidden"} mb-4 w-80 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900`}>
          <div className="flex items-center justify-between bg-primary p-4 text-white"><div className="flex items-center gap-2"><Sparkles size={18} /><span className="text-sm font-bold">Clinical AI</span></div><button type="button" onClick={() => setChatOpen(false)}><X size={16} /></button></div>
          <div className="border-b border-amber-100 bg-amber-50 p-2 text-center dark:border-amber-900 dark:bg-amber-900/30"><p className="text-[8px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">Disclaimer: AI is advisory only, not diagnostic.</p></div>
          <div className="flex h-64 flex-col gap-3 overflow-y-auto bg-slate-50/50 p-4 dark:bg-slate-800/30">
            {chatMessages.map((message) => (
              <div key={message.id} className={`max-w-[85%] rounded-xl p-3 text-[11px] leading-relaxed shadow-sm ${message.role === "assistant" ? "self-start bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100" : "self-end bg-white dark:bg-slate-700 dark:text-white"}`}>{message.text}</div>
            ))}
            {chatLoading ? <div className="self-start rounded-xl bg-blue-100 p-3 text-[11px] text-blue-900 shadow-sm dark:bg-blue-900/50 dark:text-blue-100">Thinking...</div> : null}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 dark:border-slate-800"><button type="button" onClick={() => void sendMessage("Summarize the active patient history for me.")} className="w-full rounded-md bg-slate-100 py-1.5 text-center text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Summarize Medical History</button></div>
          <div className="flex gap-2 border-t border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={onChatKeyDown} className="flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-xs focus:ring-1 focus:ring-primary dark:bg-slate-800 dark:text-white" placeholder="Ask AI clinical advice..." /><button type="button" onClick={() => void sendMessage()} className="text-primary dark:text-blue-400"><SendHorizontal size={18} /></button></div>
        </div>
        <button type="button" onClick={() => setChatOpen((current) => !current)} className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30">{chatOpen ? <X size={24} /> : <MessageCircle size={24} />}</button>
      </div>

      {toast ? <div className="fixed left-1/2 top-6 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-green-600 px-6 py-3 text-sm font-bold text-white shadow-2xl"><CheckCircle2 size={18} /><span>{toast}</span></div> : null}
    </div>
  );
}
