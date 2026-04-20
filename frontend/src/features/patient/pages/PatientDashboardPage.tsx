import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  ClipboardList,
  Copy,
  LogOut,
  Menu,
  MessageCircle,
  MoonStar,
  Pill,
  RefreshCw,
  SendHorizontal,
  Settings,
  ShieldPlus,
  SunMedium,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "../../../components/feedback/AlertBanner";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { ToastMessage } from "../../../components/feedback/ToastMessage";
import { useAuth } from "../../auth/context/AuthContext";
import {
  askHealthAssistant,
  createAppointment,
  getAvailableSlots,
  getAppointments,
  getBookingOptions,
  getDashboardOverview,
  getDispensingSummary,
  getPatientPharmacies,
  getPharmacyEstimate,
  getMedicalRecords,
  updateAppointment,
  updateAppointmentConsent,
  updatePatientProfile,
} from "../api/patientApi";
import type {
  AvailableSlot,
  AssistantChatMessage,
  BookingOption,
  DashboardAppointment,
  DashboardOverview,
  DashboardRecord,
  DispensingSummary,
  PatientPharmacyOption,
  PharmacyEstimate,
} from "../types";

type Page =
  | "overview"
  | "assistant"
  | "records"
  | "appointments"
  | "pharmacy"
  | "settings";
type Modal = "digital-id" | "appointment" | null;
type Theme = "light" | "dark";

const navItems = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "assistant", label: "Health Assistant", icon: MessageCircle },
  { id: "records", label: "Medical Records", icon: ClipboardList },
  { id: "appointments", label: "Appointments", icon: CalendarDays },
  { id: "pharmacy", label: "Pharmacy", icon: Pill },
  { id: "settings", label: "Settings", icon: Settings },
] as const satisfies Array<{ id: Page; label: string; icon: typeof Activity }>;

const initialForm = {
  organisationId: "",
  doctorId: "",
  appointmentDate: "",
  slotId: "",
  startTime: "",
  endTime: "",
};

const assistantPrompts = [
  "Can you explain my last diagnosis?",
  "When is my next appointment?",
  "What medicines are on my record?",
] as const;

const assistantHistoryVersion = 1;

function createChatMessage(
  role: "assistant" | "user",
  text: string,
): AssistantChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    text,
    created_at: new Date().toISOString(),
  };
}

function createWelcomeMessage(name: string) {
  return createChatMessage(
    "assistant",
    `Hello ${name}! How can I help with your health records today?`,
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("cancel")) return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  if (normalized.includes("pending")) return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (normalized.includes("complete")) return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
}

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLkr(value: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(value);
}

function estimateTone(status: string) {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "insufficient_stock":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
    case "out_of_stock":
    case "not_listed":
      return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
    default:
      return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  }
}

function recordPreview(record: DashboardRecord) {
  const cleaned = (record.notes || "").trim();
  if (!cleaned) {
    return "No notes stored for this encounter.";
  }

  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function toDateInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function isSessionProfileError(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    "user profile not found",
    "patient profile not found",
    "invalid token",
    "missing login token",
    "patient access required",
  ].includes(normalized);
}

export function PatientDashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState<Page>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [appointments, setAppointments] = useState<DashboardAppointment[]>([]);
  const [bookingOptions, setBookingOptions] = useState<BookingOption[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [records, setRecords] = useState<DashboardRecord[]>([]);
  const [pharmacyOptionsList, setPharmacyOptionsList] = useState<PatientPharmacyOption[]>([]);
  const [dispensingSummary, setDispensingSummary] = useState<DispensingSummary>({
    stats: {
      dispensing_events: 0,
      prescriptions_dispensed: 0,
      total_billed: 0,
    },
    items: [],
  });
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [pharmacyEstimateError, setPharmacyEstimateError] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEstimateLoading, setIsEstimateLoading] = useState(false);
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<DashboardAppointment | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<DashboardRecord | null>(null);
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState("");
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [pharmacyEstimate, setPharmacyEstimate] = useState<PharmacyEstimate | null>(null);
  const [appointmentForm, setAppointmentForm] = useState(initialForm);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [assistantHistoryLoaded, setAssistantHistoryLoaded] = useState(false);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const assistantScrollRef = useRef<HTMLDivElement | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const displayName = overview?.user.name || user?.name || user?.email?.split("@")[0] || "Patient";
  const avatarSeed = encodeURIComponent(displayName);
  const upcomingAppointments = appointments.filter((item) => item.status.toLowerCase() !== "cancelled");
  const deferredAssistantMessages = useDeferredValue(assistantMessages);
  const assistantStorageKey = `patient-dashboard-assistant:v${assistantHistoryVersion}:${overview?.user.id || user?.id || user?.email || "guest"}`;
  const qrCodeUrl = overview?.patient.dhid
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
        overview.patient.dhid,
      )}`
    : "";

  const organisationOptions = useMemo(() => {
    const uniqueOrganisations = new Map<number, string>();

    bookingOptions.forEach((item) => {
      uniqueOrganisations.set(item.organisation_id, item.organisation_name);
    });

    return Array.from(uniqueOrganisations, ([id, name]) => ({ id, name })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [bookingOptions]);

  const doctorOptions = useMemo(() => {
    if (!appointmentForm.organisationId) {
      return [];
    }

    const selectedOrganisationId = Number(appointmentForm.organisationId);
    const uniqueDoctors = new Map<number, { id: number; name: string; specialization: string | null }>();

    bookingOptions
      .filter((item) => item.organisation_id === selectedOrganisationId)
      .forEach((item) => {
        uniqueDoctors.set(item.doctor_id, {
          id: item.doctor_id,
          name: item.doctor_name,
          specialization: item.specialization,
        });
      });

    return Array.from(uniqueDoctors.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [appointmentForm.organisationId, bookingOptions]);

  const selectedOption = useMemo(() => {
    if (!appointmentForm.organisationId || !appointmentForm.doctorId) {
      return null;
    }

    return (
      bookingOptions.find(
        (item) =>
          item.organisation_id === Number(appointmentForm.organisationId)
          && item.doctor_id === Number(appointmentForm.doctorId),
      ) ?? null
    );
  }, [appointmentForm.doctorId, appointmentForm.organisationId, bookingOptions]);

  const visibleSlots = useMemo(() => {
    if (!appointmentForm.organisationId) {
      return [];
    }

    return availableSlots.filter((slot) => {
      const matchesOrganisation =
        slot.organisation_id == null
        || slot.organisation_id === Number(appointmentForm.organisationId);
      const matchesDate =
        !appointmentForm.appointmentDate
        || toDateInputValue(slot.start_time) === appointmentForm.appointmentDate;

      return matchesOrganisation && matchesDate;
    });
  }, [appointmentForm.appointmentDate, appointmentForm.organisationId, availableSlots]);

  const selectedSlot = useMemo(
    () => visibleSlots.find((slot) => String(slot.id) === appointmentForm.slotId) ?? null,
    [appointmentForm.slotId, visibleSlots],
  );

  const prescriptionOptions = useMemo(
    () =>
      records.flatMap((record) =>
        record.prescriptions.map((prescription) => ({
          id: prescription.id,
          label: `Prescription #${prescription.id} • ${record.doctor.name} • ${formatDateTime(
            prescription.created_at || record.created_at,
          )}`,
          doctorName: record.doctor.name,
          organisationName: record.organisation.name,
          createdAt: prescription.created_at || record.created_at,
          itemCount: prescription.items.length,
          status: prescription.status,
        })),
      ),
    [records],
  );

  const pharmacyOptions = useMemo(() => {
    return [...pharmacyOptionsList].sort((left, right) => left.name.localeCompare(right.name));
  }, [pharmacyOptionsList]);

  const selectedPrescriptionMeta = useMemo(
    () =>
      prescriptionOptions.find((item) => String(item.id) === selectedPrescriptionId) ?? null,
    [prescriptionOptions, selectedPrescriptionId],
  );

  const selectedPharmacyMeta = useMemo(
    () => pharmacyOptions.find((item) => String(item.id) === selectedPharmacyId) ?? null,
    [pharmacyOptions, selectedPharmacyId],
  );

  const showToast = (
    message: string,
    tone: "success" | "error" | "info" = "success",
  ) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message, tone });
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 2800);
  };

  const loadDashboard = async () => {
    setIsLoading(true);
    setDashboardError(null);

    try {
      const [
        pharmacyOptionsData,
        overviewData,
        appointmentData,
        optionData,
        recordData,
        dispensingData,
      ] = await Promise.all([
        getPatientPharmacies(),
        getDashboardOverview(),
        getAppointments(),
        getBookingOptions(),
        getMedicalRecords(),
        getDispensingSummary(),
      ]);

      setPharmacyOptionsList(pharmacyOptionsData);
      setOverview(overviewData);
      setAppointments(appointmentData);
      setBookingOptions(optionData);
      setRecords(recordData);
      setDispensingSummary(dispensingData);
    } catch (error) {
      if (error instanceof Error && isSessionProfileError(error.message)) {
        setDashboardError(
          "Your patient session needs a refresh. Sign out and log in again if this keeps happening.",
        );
      } else {
        setDashboardError(error instanceof Error ? error.message : "Dashboard data could not be loaded. Refresh the page to try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem("patient-dashboard-theme");
    setTheme(savedTheme === "dark" ? "dark" : "light");
    void loadDashboard();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("patient-dashboard-theme", theme);
  }, [theme]);

  useEffect(() => {
    setProfileName(displayName);
  }, [displayName]);

  useEffect(() => {
    const fallbackMessages = [createWelcomeMessage(displayName)];
    const stored = localStorage.getItem(assistantStorageKey);

    if (!stored) {
      setAssistantMessages(fallbackMessages);
      setAssistantHistoryLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as {
        version?: number;
        messages?: AssistantChatMessage[];
      };
      const storedMessages = Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (item) =>
              (item.role === "assistant" || item.role === "user") &&
              typeof item.text === "string" &&
              item.text.trim().length > 0,
          )
        : [];

      setAssistantMessages(storedMessages.length > 0 ? storedMessages : fallbackMessages);
    } catch {
      setAssistantMessages(fallbackMessages);
    }

    setAssistantHistoryLoaded(true);
  }, [assistantStorageKey, displayName]);

  useEffect(() => {
    if (!assistantHistoryLoaded) {
      return;
    }

    localStorage.setItem(
      assistantStorageKey,
      JSON.stringify({
        version: assistantHistoryVersion,
        messages: assistantMessages,
      }),
    );
  }, [assistantHistoryLoaded, assistantMessages, assistantStorageKey]);

  useEffect(() => {
    assistantScrollRef.current?.scrollTo({
      top: assistantScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [deferredAssistantMessages, isAssistantLoading]);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (editingAppointment || !appointmentForm.doctorId) {
      setAvailableSlots([]);
      setSlotError(null);
      return;
    }

    const loadSlots = async () => {
      setIsSlotsLoading(true);
      setSlotError(null);

      try {
        const slots = await getAvailableSlots(Number(appointmentForm.doctorId));
        setAvailableSlots(slots);
      } catch (error) {
        setAvailableSlots([]);
        setSlotError(
          error instanceof Error
            ? error.message
            : "Available slots could not be loaded right now.",
        );
      } finally {
        setIsSlotsLoading(false);
      }
    };

    void loadSlots();
  }, [appointmentForm.doctorId, editingAppointment]);

  useEffect(() => {
    if (!editingAppointment && selectedSlot) {
      setAppointmentForm((current) => ({
        ...current,
        startTime: toDateTimeInputValue(selectedSlot.start_time),
        endTime: toDateTimeInputValue(selectedSlot.end_time),
      }));
    }
  }, [editingAppointment, selectedSlot]);

  useEffect(() => {
    if (!selectedRecord && records.length > 0) {
      setSelectedRecord(records[0]);
    }

    if (selectedRecord && !records.some((record) => record.id === selectedRecord.id)) {
      setSelectedRecord(records[0] ?? null);
    }
  }, [records, selectedRecord]);

  useEffect(() => {
    setPharmacyEstimate(null);
    setPharmacyEstimateError(null);
  }, [selectedPharmacyId, selectedPrescriptionId]);

  const sendAssistantMessage = async (preset?: string) => {
    const text = (preset ?? assistantInput).trim();
    if (!text || isAssistantLoading) {
      return;
    }

    const nextUserMessage = createChatMessage("user", text);
    const historyForRequest = [...assistantMessages, nextUserMessage]
      .slice(-12)
      .map(({ role, text: messageText }) => ({
        role,
        text: messageText,
      }));

    startTransition(() => {
      setAssistantMessages((current) => [...current, nextUserMessage]);
      setAssistantInput("");
      setIsAssistantLoading(true);
    });

    try {
      const reply = await askHealthAssistant({
        message: text,
        history: historyForRequest,
      });

      setAssistantMessages((current) => [
        ...current,
        createChatMessage("assistant", reply.answer),
      ]);
    } catch (error) {
      const fallbackText =
        error instanceof Error
          ? error.message
          : "Assistant request failed";

      setAssistantMessages((current) => [
        ...current,
        createChatMessage(
          "assistant",
          "I hit a snag reaching the assistant right now. Check the Gemini edge function config or try again in a moment.",
        ),
      ]);
      showToast(fallbackText, "error");
    } finally {
      setIsAssistantLoading(false);
    }
  };

  const onAssistantKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      void sendAssistantMessage();
    }
  };

  const logoutNow = () => {
    logout();
    navigate("/login");
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  const openCreateModal = () => {
    setEditingAppointment(null);
    setAppointmentForm(initialForm);
    setAvailableSlots([]);
    setSlotError(null);
    setModal("appointment");
  };

  const openRescheduleModal = (appointment: DashboardAppointment) => {
    setEditingAppointment(appointment);
    setAppointmentForm({
      organisationId: String(appointment.organisation.id),
      doctorId: String(appointment.doctor.id),
      appointmentDate: toDateInputValue(appointment.start_time),
      slotId: "",
      startTime: toDateTimeInputValue(appointment.start_time),
      endTime: toDateTimeInputValue(appointment.end_time),
    });
    setAvailableSlots([]);
    setSlotError(null);
    setModal("appointment");
  };

  const submitAppointment = async () => {
    if (!editingAppointment && !appointmentForm.organisationId) {
      showToast("Select an organisation first.", "error");
      return;
    }

    if (!editingAppointment && !appointmentForm.doctorId) {
      showToast("Select a doctor first.", "error");
      return;
    }

    if (!editingAppointment && !appointmentForm.appointmentDate) {
      showToast("Pick a date to view available slots.", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingAppointment) {
        if (!appointmentForm.startTime || !appointmentForm.endTime) {
          showToast("Start and end times are required for rescheduling.", "error");
          return;
        }

        const startTime = new Date(appointmentForm.startTime);
        const endTime = new Date(appointmentForm.endTime);

        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          showToast("Enter valid reschedule timestamps.", "error");
          return;
        }

        if (endTime <= startTime) {
          showToast("End time must be later than start time.", "error");
          return;
        }

        await updateAppointment(editingAppointment.id, {
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
        });
        showToast("Appointment update request saved.");
      } else {
        if (!appointmentForm.slotId) {
          showToast("Pick a live slot before booking.", "error");
          return;
        }

        await createAppointment({
          slot_id: Number(appointmentForm.slotId),
        });
        showToast("Appointment booked.");
      }

      setModal(null);
      setAppointmentForm(initialForm);
      await loadDashboard();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Appointment request failed",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelAppointment = async (appointmentId: number) => {
    try {
      await updateAppointment(appointmentId, { status: "cancelled" });
      showToast("Appointment cancelled.");
      await loadDashboard();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to cancel appointment",
        "error",
      );
    }
  };

  const toggleConsent = async (
    appointmentId: number,
    nextGranted: boolean,
  ) => {
    try {
      await updateAppointmentConsent(appointmentId, nextGranted);
      showToast(nextGranted ? "Consent granted." : "Consent revoked.");
      await loadDashboard();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Consent update failed",
        "error",
      );
    }
  };

  const copyDhid = async () => {
    if (!overview?.patient.dhid) return;
    await navigator.clipboard.writeText(overview.patient.dhid);
    showToast("DHID copied.");
  };

  const saveProfile = async () => {
    const cleaned = profileName.trim();
    if (cleaned.length < 3) {
      showToast("Name must be at least 3 characters.", "error");
      return;
    }

    setIsSavingProfile(true);
    try {
      await updatePatientProfile({ name: cleaned });
      showToast("Profile updated.");
      await loadDashboard();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Profile update failed",
        "error",
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const loadPharmacyEstimate = async () => {
    if (!selectedPrescriptionId) {
      showToast("Pick an ePrescription first.", "error");
      return;
    }

    if (!selectedPharmacyId) {
      showToast("Pick a pharmacy first.", "error");
      return;
    }

    setIsEstimateLoading(true);
    setPharmacyEstimateError(null);

    try {
      const estimate = await getPharmacyEstimate(
        Number(selectedPrescriptionId),
        Number(selectedPharmacyId),
      );
      setPharmacyEstimate(estimate);
    } catch (error) {
      setPharmacyEstimate(null);
      setPharmacyEstimateError(
        error instanceof Error ? error.message : "Estimate could not be loaded right now.",
      );
    } finally {
      setIsEstimateLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-slate-50 px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg">
            <ShieldPlus size={20} />
          </div>
          <div>
            <p className="font-headline text-lg font-bold leading-none text-blue-900 dark:text-blue-400">Health Identity</p>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Patient Console</p>
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
                className={`flex w-full items-center gap-4 rounded-lg px-4 py-3 text-sm font-medium transition-all ${active ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100" : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"}`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 px-2">
          <button type="button" onClick={() => void loadDashboard()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-bold text-white shadow-md">
            <RefreshCw size={16} />
            Refresh Data
          </button>
          <button type="button" onClick={logoutNow} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 py-3 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex min-h-screen flex-col md:ml-64">
        <header className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white/85 px-4 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 md:left-64 md:px-8">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileNavOpen((value) => !value)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden">
              <Menu size={20} />
            </button>
            <div>
              <h2 className="font-headline text-lg font-extrabold text-blue-900 dark:text-blue-400 sm:text-xl">National Health Portal</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Logged in as {displayName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-700">
            <button type="button" onClick={toggleTheme} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" title="Toggle theme">
              {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
            </button>
            <button type="button" onClick={() => void loadDashboard()} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <RefreshCw size={18} />
            </button>
            <button type="button" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <Bell size={18} />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-red-500 dark:border-slate-900" />
            </button>
            <button type="button" onClick={() => setPage("settings")} className="flex h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-700">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`} alt={`${displayName} avatar`} className="h-full w-full" />
            </button>
          </div>
        </header>

        {mobileNavOpen ? (
          <>
            <div className="fixed inset-0 z-20 bg-slate-900/10 md:hidden" onClick={() => setMobileNavOpen(false)} />
            <div className="fixed inset-x-4 top-20 z-30 rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-800 dark:bg-slate-900 md:hidden">
              <div className="grid gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={`menu-${item.id}`}
                      type="button"
                      onClick={() => {
                        setPage(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ${page === item.id ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100" : "text-slate-600 dark:text-slate-300"}`}
                    >
                      <Icon size={18} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <div className="mx-auto flex-1 max-w-7xl px-4 pb-28 pt-24 md:px-8 md:pb-12">
          {isLoading ? <LoadingState message="Loading your patient dashboard..." /> : null}
          {!isLoading && dashboardError ? (
            <ErrorState
              title="Patient dashboard unavailable"
              message={dashboardError}
            />
          ) : null}
          {!isLoading && !dashboardError && page === "overview" && overview ? (
            <section className="space-y-6">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Welcome Back, {displayName}</p>
                  <h1 className="mt-2 font-headline text-4xl font-extrabold text-primary dark:text-blue-400 sm:text-5xl">Health Dashboard</h1>
                </div>
                <button type="button" onClick={() => setModal("digital-id")} className="flex items-center justify-between gap-5 rounded-[1.7rem] border border-slate-100 bg-white p-5 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Your Digital Health ID</span>
                    <span className="mt-1 block font-headline text-xl font-extrabold tracking-[0.18em] text-secondary dark:text-blue-300">{overview.patient.dhid}</span>
                  </div>
                  <ShieldPlus className="text-secondary dark:text-blue-300" size={28} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Upcoming Appointments", overview.stats.upcoming_appointments],
                  ["Total Appointments", overview.stats.total_appointments],
                  ["Medical Records", overview.stats.medical_records],
                  ["Active Prescriptions", overview.stats.active_prescriptions],
                ].map(([label, value]) => (
                  <article key={label} className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">{label}</p>
                    <p className="mt-3 font-headline text-4xl font-extrabold">{value}</p>
                  </article>
                ))}
              </div>

              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="font-headline text-xl font-bold">Upcoming Appointments</h2>
                    <button type="button" onClick={() => setPage("appointments")} className="text-sm font-bold text-primary dark:text-blue-400">Open full list</button>
                  </div>
                  <div className="space-y-4">
                    {upcomingAppointments.length === 0 ? (
                      <EmptyState
                        title="No upcoming appointments"
                        description="Once you confirm a live booking, your next appointment will show up here with consent and status details."
                        className="rounded-xl border-0 bg-slate-50 p-5 text-left shadow-none dark:bg-slate-800/50"
                      />
                    ) : (
                      upcomingAppointments.slice(0, 4).map((item) => (
                        <article key={item.id} className="rounded-[1.4rem] bg-slate-50 p-4 dark:bg-slate-800/50">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="font-bold">{item.doctor.name}</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">{item.doctor.specialization || "Specialization not set"} at {item.organisation.name}</p>
                              <p className="mt-1 text-sm font-semibold text-primary dark:text-blue-400">{formatDateTime(item.start_time)}</p>
                              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                Consent: {item.consent.status}
                              </p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}>{item.status}</span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="col-span-12 rounded-[1.7rem] border border-slate-100 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-800/50">
                  <h2 className="mb-4 font-headline text-xl font-bold">Latest Medical Record</h2>
                  {overview.recent_record ? (
                    <div className="rounded-xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-sm text-slate-500 dark:text-slate-400">{formatDateTime(overview.recent_record.created_at)}</p>
                      <p className="mt-2 text-base font-medium">{overview.recent_record.notes || "No consultation notes were saved for this record."}</p>
                    </div>
                  ) : (
                    <EmptyState
                      title="No encounter records yet"
                      description="Your consultation history will appear here once a doctor saves your first encounter."
                      className="rounded-xl p-5"
                    />
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "assistant" ? (
            <section className="min-h-[calc(100svh-8rem)]">
              <div className="mx-auto flex min-h-[calc(100svh-10rem)] max-w-5xl flex-col overflow-hidden rounded-[2.25rem] border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50 px-6 py-6 dark:border-slate-800 dark:bg-slate-800/60 md:px-8">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-md shadow-blue-950/10 dark:bg-blue-600">
                      <ShieldPlus size={24} />
                    </div>
                    <div>
                      <h1 className="font-headline text-3xl font-extrabold text-primary dark:text-blue-400 md:text-4xl">Health Assistant</h1>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Always available</p>
                    </div>
                  </div>
                  <div className="hidden rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 md:block">
                    History saved
                  </div>
                </div>

                <div
                  ref={assistantScrollRef}
                  className="flex-1 overflow-y-auto bg-white px-4 py-6 dark:bg-slate-900 md:px-8 md:py-8"
                >
                  <div className="mx-auto flex max-w-4xl flex-col gap-4">
                    {deferredAssistantMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`max-w-[92%] rounded-[1.6rem] px-6 py-5 text-base leading-8 shadow-sm md:max-w-[78%] ${
                          message.role === "assistant"
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            : "ml-auto border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {message.text}
                      </div>
                    ))}

                    {deferredAssistantMessages.length <= 2 ? (
                      <div className="mt-2 flex flex-col gap-3">
                        {assistantPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => void sendAssistantMessage(prompt)}
                            disabled={isAssistantLoading}
                            className="mx-auto w-full max-w-[92%] rounded-[1.45rem] border border-slate-200 bg-white px-6 py-4 text-left text-[1.05rem] text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800 md:max-w-[84%]"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {isAssistantLoading ? (
                      <div className="max-w-[92%] rounded-[1.6rem] bg-slate-100 px-6 py-5 text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-100 md:max-w-[78%]">
                        Assistant is thinking...
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-slate-50 px-4 py-6 dark:border-slate-800 dark:bg-slate-800/40 md:px-6">
                  <div className="mx-auto max-w-4xl">
                    <div className="flex items-center gap-3 rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                      <input
                        type="text"
                        value={assistantInput}
                        onChange={(event) => setAssistantInput(event.target.value)}
                        onKeyDown={onAssistantKeyDown}
                        placeholder="Ask a health question..."
                        className="flex-1 border-0 bg-transparent text-lg text-slate-700 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => void sendAssistantMessage()}
                        disabled={isAssistantLoading}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600"
                      >
                        <SendHorizontal size={20} />
                      </button>
                    </div>
                    <p className="mt-4 text-center text-sm font-semibold italic text-slate-400 dark:text-slate-500">
                      Decision-support only. Not a medical diagnosis.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "records" ? (
            <section className="space-y-6">
              <div>
                <h1 className="font-headline text-3xl font-extrabold text-primary dark:text-blue-400">Medical Records</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Encounter records and prescription items linked to your account.</p>
              </div>
              {selectedRecord ? (
                <article className="rounded-[1.9rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Open Record</p>
                      <h2 className="mt-2 font-headline text-2xl font-extrabold text-primary dark:text-blue-400">
                        {selectedRecord.doctor.name}
                      </h2>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        {selectedRecord.doctor.specialization || "Specialization not set"}
                        {selectedRecord.organisation.name ? ` • ${selectedRecord.organisation.name}` : ""}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-primary dark:text-blue-400">
                        {formatDateTime(selectedRecord.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRecord.appointment.status ? (
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(selectedRecord.appointment.status)}`}>
                          {formatStatusLabel(selectedRecord.appointment.status)}
                        </span>
                      ) : null}
                      {selectedRecord.prescriptions.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPrescriptionId(String(selectedRecord.prescriptions[0].id));
                            setPage("pharmacy");
                          }}
                          className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white dark:bg-blue-600"
                        >
                          Check First Prescription Cost
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
                    <div className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Doctor Notes</p>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">
                        {selectedRecord.notes || "No notes stored for this encounter."}
                      </p>
                    </div>

                    <div className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Prescription Summary</p>
                      {selectedRecord.prescriptions.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                          No prescriptions linked to this encounter.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-4">
                          {selectedRecord.prescriptions.map((prescription) => (
                            <div key={prescription.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <p className="text-sm font-bold">
                                    Prescription #{prescription.id} • {formatStatusLabel(prescription.status)}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {formatDateTime(prescription.created_at)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedPrescriptionId(String(prescription.id));
                                    setPage("pharmacy");
                                  }}
                                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                >
                                  Price This
                                </button>
                              </div>
                              <div className="mt-3 space-y-3">
                                {prescription.items.length === 0 ? (
                                  <p className="text-sm text-slate-500 dark:text-slate-400">
                                    No medicine lines saved for this prescription.
                                  </p>
                                ) : (
                                  prescription.items.map((item) => (
                                    <div key={item.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/70">
                                      <p className="font-semibold text-slate-900 dark:text-slate-100">{item.medicine_name}</p>
                                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                                        {item.dosage || "Dosage not set"} • Qty {item.quantity || "Not set"}
                                      </p>
                                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                                        {item.instructions || "No instructions saved"}
                                      </p>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ) : null}
              <div className="grid gap-4">
                {records.length === 0 ? (
                  <EmptyState
                    title="No medical records yet"
                    description="Encounter notes and linked prescriptions will appear here after your first completed consultation."
                    className="rounded-[1.7rem]"
                  />
                ) : (
                  records.map((record) => (
                    <article key={record.id} className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-bold">{record.doctor.name}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{record.doctor.specialization || "Specialization not set"}{record.organisation.name ? ` • ${record.organisation.name}` : ""}</p>
                          <p className="mt-1 text-sm font-semibold text-primary dark:text-blue-400">{formatDateTime(record.created_at)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {record.appointment.status ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(record.appointment.status)}`}>{formatStatusLabel(record.appointment.status)}</span> : null}
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className={`rounded-full px-4 py-2 text-xs font-bold ${
                              selectedRecord?.id === record.id
                                ? "bg-primary text-white dark:bg-blue-600"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {selectedRecord?.id === record.id ? "Opened" : "Open Record"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Snapshot</p>
                          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{recordPreview(record)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Prescriptions</p>
                          {record.prescriptions.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No prescriptions linked to this encounter.</p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {record.prescriptions.map((prescription) => (
                                <div key={prescription.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <p className="text-sm font-bold">Prescription #{prescription.id} • {formatStatusLabel(prescription.status)}</p>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedPrescriptionId(String(prescription.id));
                                        setPage("pharmacy");
                                      }}
                                      className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      Check Cost
                                    </button>
                                  </div>
                                  <div className="mt-2 space-y-2">
                                    {prescription.items.map((item) => (
                                      <div key={item.id} className="text-sm text-slate-600 dark:text-slate-300">{item.medicine_name} • {item.dosage} • Qty {item.quantity}</div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "appointments" ? (
            <section className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold text-primary dark:text-blue-400">Appointments</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Manage your patient appointments here.</p>
                </div>
                <button type="button" onClick={openCreateModal} className="rounded-xl bg-primary px-6 py-3 font-bold text-white disabled:opacity-50 dark:bg-blue-600" disabled={bookingOptions.length === 0}>
                  Book Appointment
                </button>
              </div>

              {bookingOptions.length === 0 ? (
                <AlertBanner
                  tone="info"
                  title="Booking availability is limited"
                  message="No bookable doctor affiliations are available right now. Appointment booking will open as soon as live availability slots are published from the backend."
                  className="rounded-[1.7rem]"
                />
              ) : null}

              <div className="grid gap-4">
                {appointments.length === 0 ? (
                  <EmptyState
                    title="No appointments yet"
                    description="When you reserve a live slot, it will appear here with confirmation status, consent details, and follow-up actions."
                    className="rounded-[1.7rem]"
                  />
                ) : (
                  appointments.map((item) => (
                    <article key={item.id} className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-xl font-bold">{item.doctor.name}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{item.doctor.specialization || "Specialization not set"} at {item.organisation.name}</p>
                          <p className="mt-2 text-sm font-semibold text-primary dark:text-blue-400">{formatDateTime(item.start_time)} to {formatDateTime(item.end_time)}</p>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            Full-history consent: {item.consent.status}
                          </p>
                          {item.consent.last_updated ? (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Last changed {formatDateTime(item.consent.last_updated)}
                            </p>
                          ) : null}
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}>{formatStatusLabel(item.status)}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {["cancelled", "completed"].includes(item.status.toLowerCase()) ? null : (
                          <button
                            type="button"
                            onClick={() => void toggleConsent(item.id, !item.consent.granted)}
                            className={`rounded-xl px-4 py-2 text-xs font-bold ${
                              item.consent.granted
                                ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                            }`}
                          >
                            {item.consent.granted ? "Revoke Consent" : "Grant Consent"}
                          </button>
                        )}
                        {["cancelled", "completed"].includes(item.status.toLowerCase()) ? null : (
                          <button type="button" onClick={() => openRescheduleModal(item)} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white dark:bg-blue-600">Reschedule</button>
                        )}
                        <button type="button" onClick={() => void cancelAppointment(item.id)} disabled={item.status.toLowerCase() === "cancelled"} className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400">Cancel</button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "pharmacy" ? (
            <section className="space-y-6">
              <div className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="font-headline text-2xl font-extrabold text-primary dark:text-blue-400">ePrescription Cost Check</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Pick a prescription and a pharmacy to see the likely bill before you go there.
                    </p>
                  </div>
                  {selectedPrescriptionMeta || selectedPharmacyMeta ? (
                    <div className="rounded-[1.2rem] bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      <p>{selectedPrescriptionMeta ? selectedPrescriptionMeta.label : "No prescription selected yet."}</p>
                      <p className="mt-1">{selectedPharmacyMeta ? `${selectedPharmacyMeta.name} • ${selectedPharmacyMeta.indexed_items} indexed item(s)` : "No pharmacy selected yet."}</p>
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_1.1fr_auto]">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">ePrescription</span>
                    <select
                      value={selectedPrescriptionId}
                      onChange={(event) => setSelectedPrescriptionId(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="">Select a prescription</option>
                      {prescriptionOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Pharmacy</span>
                    <select
                      value={selectedPharmacyId}
                      onChange={(event) => setSelectedPharmacyId(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="">Select a pharmacy</option>
                      {pharmacyOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => void loadPharmacyEstimate()}
                    disabled={isEstimateLoading || !selectedPrescriptionId || !selectedPharmacyId}
                    className="h-fit rounded-xl bg-primary px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 xl:self-end"
                  >
                    {isEstimateLoading ? "Checking..." : "Calculate Bill"}
                  </button>
                </div>

                {pharmacyEstimateError ? (
                  <AlertBanner
                    tone="error"
                    title="Estimate unavailable"
                    message={pharmacyEstimateError}
                    className="mt-5"
                  />
                ) : null}

                {pharmacyEstimate ? (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-4 md:grid-cols-4">
                      <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Estimated Total</p>
                        <p className="mt-3 font-headline text-3xl font-extrabold text-primary dark:text-blue-400">
                          {formatLkr(pharmacyEstimate.summary.estimated_total)}
                        </p>
                      </article>
                      <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Included Items</p>
                        <p className="mt-3 font-headline text-3xl font-extrabold">
                          {pharmacyEstimate.summary.included_items}
                        </p>
                      </article>
                      <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Excluded Items</p>
                        <p className="mt-3 font-headline text-3xl font-extrabold">
                          {pharmacyEstimate.summary.excluded_items}
                        </p>
                      </article>
                      <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Pharmacy</p>
                        <p className="mt-3 text-lg font-bold">{pharmacyEstimate.pharmacy.name}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Prescription #{pharmacyEstimate.prescription.id} • {pharmacyEstimate.prescription.doctor_name || "Doctor not found"}
                        </p>
                      </article>
                    </div>

                    {pharmacyEstimate.summary.unavailable_items > 0 ? (
                      <AlertBanner
                        tone="info"
                        title="Some items are missing from this pharmacy"
                        message="Anything marked unavailable is excluded from the bill total, so the final amount only covers what this pharmacy can actually issue."
                      />
                    ) : null}

                    <div className="grid gap-4">
                      {pharmacyEstimate.items.map((item) => (
                        <article key={item.id} className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-lg font-bold">{item.medicine_name}</p>
                                <span className={`rounded-full px-3 py-1 text-xs font-bold ${estimateTone(item.availability_status)}`}>
                                  {item.availability_label}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                {item.dosage || "Dosage not set"} • Qty {item.quantity}
                              </p>
                              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                {item.instructions || "No instructions saved"}
                              </p>
                            </div>

                            <div className="min-w-[12rem] rounded-[1.2rem] bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/60">
                              <p>Stock here: <span className="font-semibold">{item.stock_quantity}</span></p>
                              <p className="mt-1">
                                Unit price: <span className="font-semibold">{item.unit_price == null ? "Not priced" : formatLkr(item.unit_price)}</span>
                              </p>
                              <p className="mt-1">
                                Bill line total: <span className="font-semibold">{item.estimated_total == null ? "Not included" : formatLkr(item.estimated_total)}</span>
                              </p>
                            </div>
                          </div>

                          {item.note ? (
                            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                              {item.note}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                    Select both fields and hit <span className="font-semibold text-slate-700 dark:text-slate-200">Calculate Bill</span>. If a drug is missing from that pharmacy, it will be clearly marked and excluded from the estimate.
                  </div>
                )}
                <div className="mt-6 space-y-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Dispensing Events</p>
                      <p className="mt-3 font-headline text-4xl font-extrabold">{dispensingSummary.stats.dispensing_events}</p>
                    </article>
                    <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Prescriptions Dispensed</p>
                      <p className="mt-3 font-headline text-4xl font-extrabold">{dispensingSummary.stats.prescriptions_dispensed}</p>
                    </article>
                    <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Total Billed</p>
                      <p className="mt-3 font-headline text-3xl font-extrabold">{formatLkr(dispensingSummary.stats.total_billed)}</p>
                    </article>
                  </div>

                  <div>
                    <h3 className="font-headline text-2xl font-extrabold text-primary dark:text-blue-400">Dispensing & Billing</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Track what has been dispensed and what has been billed against your prescriptions.</p>
                  </div>

                  <div className="grid gap-4">
                    {dispensingSummary.items.length === 0 ? (
                      <EmptyState
                        title="No dispensing records yet"
                        description="Completed pharmacy issues and billing line items will show here once a prescription has been processed."
                        className="rounded-[1.4rem] p-6"
                      />
                    ) : (
                      dispensingSummary.items.map((item) => (
                        <article key={item.id} className="rounded-[1.45rem] bg-slate-50 p-5 dark:bg-slate-800/50">
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-lg font-bold">{item.pharmacy.name}</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">Prescription #{item.prescription_id}</p>
                              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(item.created_at)}</p>
                            </div>
                            <div className="text-left md:text-right">
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}>{formatStatusLabel(item.status)}</span>
                              <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">Dispensed: {formatLkr(item.total_price)}</p>
                              <p className="mt-1 text-base font-bold text-primary dark:text-blue-400">Billed: {formatLkr(item.billed_total)}</p>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-2">
                            {item.line_items.length === 0 ? (
                              <p className="text-sm text-slate-500 dark:text-slate-400">No dispensing line items saved yet.</p>
                            ) : (
                              item.line_items.map((lineItem) => (
                                <div key={lineItem.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                                  <p className="font-semibold">{lineItem.medicine_name || "Unnamed item"}</p>
                                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                                    {lineItem.dosage || "Dosage not set"} • Qty {lineItem.quantity_dispensed}
                                  </p>
                                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                                    {lineItem.instructions || "No instructions saved"}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "settings" && overview ? (
            <section className="space-y-6">
              <div>
                <h1 className="font-headline text-3xl font-extrabold text-primary dark:text-blue-400">Account Settings</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Update your patient display profile and review your account identifiers.</p>
              </div>
              <div className="max-w-2xl rounded-[1.7rem] border border-slate-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="space-y-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Name</p>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Email</p>
                    <p className="mt-1 font-medium">{overview.user.email}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">DHID</p>
                    <p className="mt-1 font-medium">{overview.patient.dhid}</p>
                  </div>
                  <button type="button" onClick={() => void saveProfile()} disabled={isSavingProfile} className="rounded-xl bg-primary px-6 py-3 font-bold text-white disabled:opacity-60 dark:bg-blue-600">
                    {isSavingProfile ? "Saving..." : "Save Profile"}
                  </button>
                  <button type="button" onClick={logoutNow} className="rounded-xl bg-primary px-6 py-3 font-bold text-white dark:bg-blue-600">Sign Out</button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
        <footer className="border-t border-slate-100 bg-slate-50 px-8 py-12 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <p className="text-sm font-bold dark:text-slate-300">National Health Identity System</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">© 2026 Digital Health Ministry SL • Patient Portal v3.1</p>
            </div>
            <div className="flex gap-8">
              {["Privacy", "Terms", "Security"].map((item) => (
                <a key={item} href="#" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:underline">
                  {item}
                </a>
              ))}
            </div>
          </div>
        </footer>
      </main>
      {modal === "digital-id" && overview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={(event) => event.target === event.currentTarget && setModal(null)}>
          <div className="w-full max-w-sm rounded-[2rem] bg-white p-8 text-center shadow-2xl dark:bg-slate-900">
            <h3 className="mb-4 text-2xl font-bold">Digital Health ID</h3>
            <div className="rounded-2xl bg-slate-100 p-6 dark:bg-slate-800">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">DHID</p>
              <p className="mt-3 font-headline text-2xl font-extrabold tracking-[0.18em] text-primary dark:text-blue-300">{overview.patient.dhid}</p>
              <div className="mt-4 flex justify-center rounded-2xl bg-white p-4 shadow-inner dark:bg-slate-900">
                <img src={qrCodeUrl} alt={`QR code for ${overview.patient.dhid}`} className="h-52 w-52 rounded-xl bg-white p-2" />
              </div>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Created {formatDateTime(overview.patient.created_at)}</p>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => void copyDhid()} className="flex-1 rounded-xl bg-primary py-3 font-bold text-white dark:bg-blue-600">
                <span className="inline-flex items-center gap-2">
                  <Copy size={16} />
                  Copy ID
                </span>
              </button>
              <button type="button" onClick={() => setModal(null)} className="flex-1 rounded-xl bg-slate-100 py-3 font-bold dark:bg-slate-800">Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === "appointment" ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={(event) => event.target === event.currentTarget && setModal(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-8 pb-6 pt-8 dark:border-slate-800">
              <div>
                <h3 className="text-2xl font-bold">{editingAppointment ? "Reschedule Appointment" : "Book Appointment"}</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {editingAppointment
                    ? "Rescheduling currently updates the appointment window directly. Use this only after the clinic has already confirmed the new time."
                    : "Pick the organisation first, then the doctor, then the date. Matching live slots will appear below in a scrollable lane."}
                </p>
              </div>
              <button type="button" onClick={() => setModal(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="space-y-5">
                {editingAppointment ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Organisation</label>
                        <input type="text" value={selectedOption?.organisation_name || editingAppointment.organisation.name} readOnly className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Doctor</label>
                        <input type="text" value={selectedOption?.doctor_name || editingAppointment.doctor.name} readOnly className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Date</label>
                        <input type="date" value={appointmentForm.appointmentDate} readOnly className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                    </div>

                    <AlertBanner
                      tone="info"
                      message="Slot reassignment is not available from the current backend contract, so this form only updates the requested appointment window."
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Start Time</label>
                        <input type="datetime-local" value={appointmentForm.startTime} onChange={(event) => setAppointmentForm((current) => ({ ...current, startTime: event.target.value }))} className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">End Time</label>
                        <input type="datetime-local" value={appointmentForm.endTime} onChange={(event) => setAppointmentForm((current) => ({ ...current, endTime: event.target.value }))} className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Organisation</label>
                        <select
                          value={appointmentForm.organisationId}
                          onChange={(event) =>
                            setAppointmentForm({
                              organisationId: event.target.value,
                              doctorId: "",
                              appointmentDate: "",
                              slotId: "",
                              startTime: "",
                              endTime: "",
                            })
                          }
                          className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select organisation</option>
                          {organisationOptions.map((item) => (
                            <option key={item.id} value={String(item.id)}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Doctor</label>
                        <select
                          value={appointmentForm.doctorId}
                          onChange={(event) =>
                            setAppointmentForm((current) => ({
                              ...current,
                              doctorId: event.target.value,
                              appointmentDate: "",
                              slotId: "",
                              startTime: "",
                              endTime: "",
                            }))
                          }
                          disabled={!appointmentForm.organisationId}
                          className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select doctor</option>
                          {doctorOptions.map((item) => (
                            <option key={item.id} value={String(item.id)}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Date</label>
                        <input
                          type="date"
                          value={appointmentForm.appointmentDate}
                          onChange={(event) =>
                            setAppointmentForm((current) => ({
                              ...current,
                              appointmentDate: event.target.value,
                              slotId: "",
                              startTime: "",
                              endTime: "",
                            }))
                          }
                          disabled={!appointmentForm.doctorId}
                          className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {selectedOption ? (
                      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                        {selectedOption.doctor_name} • {selectedOption.specialization || "Specialization not set"} • {selectedOption.organisation_name}
                      </div>
                    ) : null}

                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Available Slots</label>
                      {!appointmentForm.organisationId ? (
                        <AlertBanner tone="info" message="Select an organisation to narrow down the doctors." />
                      ) : !appointmentForm.doctorId ? (
                        <AlertBanner tone="info" message="Select a doctor to load that doctor's live availability." />
                      ) : !appointmentForm.appointmentDate ? (
                        <AlertBanner tone="info" message="Pick a date and the matching slots will appear here." />
                      ) : isSlotsLoading ? (
                        <LoadingState message="Loading live slots..." />
                      ) : slotError ? (
                        <AlertBanner tone="error" message={slotError} />
                      ) : visibleSlots.length === 0 ? (
                        <AlertBanner
                          tone="info"
                          message="No open slots are published for this doctor on the selected date. Try another date or doctor."
                        />
                      ) : (
                        <div className="max-h-72 overflow-y-auto pr-2">
                          <div className="grid gap-3">
                            {visibleSlots.map((slot) => {
                              const active = appointmentForm.slotId === String(slot.id);
                              return (
                                <button
                                  key={slot.id}
                                  type="button"
                                  onClick={() =>
                                    setAppointmentForm((current) => ({
                                      ...current,
                                      slotId: String(slot.id),
                                      startTime: toDateTimeInputValue(slot.start_time),
                                      endTime: toDateTimeInputValue(slot.end_time),
                                    }))
                                  }
                                  className={`rounded-xl border px-4 py-4 text-left transition ${
                                    active
                                      ? "border-primary bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-100"
                                      : "border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                                  }`}
                                >
                                  <p className="text-sm font-bold">{formatDateTime(slot.start_time)}</p>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ends {formatDateTime(slot.end_time)}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Selected Start Time</label>
                        <input type="datetime-local" value={appointmentForm.startTime} readOnly className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">Selected End Time</label>
                        <input type="datetime-local" value={appointmentForm.endTime} readOnly className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-100 px-8 py-6 dark:border-slate-800">
              <button type="button" onClick={() => setModal(null)} className="flex-1 rounded-xl bg-slate-100 py-3 font-bold dark:bg-slate-800">Close</button>
              <button type="button" onClick={() => void submitAppointment()} disabled={isSubmitting || (!editingAppointment && (!selectedOption || !appointmentForm.appointmentDate || !appointmentForm.slotId || isSlotsLoading))} className="flex-1 rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60 dark:bg-blue-600">
                {isSubmitting ? "Saving..." : editingAppointment ? "Save Changes" : "Book Now"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <ToastMessage message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
