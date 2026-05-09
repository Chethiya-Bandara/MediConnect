import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Home,
  Activity,
  BadgeCheck,
  CalendarDays,
  Camera,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  Fingerprint,
  LogOut,
  Menu,
  MessageCircle,
  MoonStar,
  Mail,
  Pill,
  SendHorizontal,
  ShieldCheck,
  Settings,
  Sparkles,
  ShieldPlus,
  SunMedium,
  UserRound,
  X,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "../../../components/feedback/AlertBanner";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { ToastMessage } from "../../../components/feedback/ToastMessage";
import { AppBrandMark } from "../../../components/ui";
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
  | "home"
  | "overview"
  | "assistant"
  | "records"
  | "appointments"
  | "pharmacy"
  | "settings";
type Modal = "digital-id" | "appointment" | "record" | null;
type Theme = "light" | "dark";

const QR_CODE_API_BASE = "https://api.qrserver.com/v1/create-qr-code";

import MRI from "../../../assets/welcome/MRI.jpg";
import Tools from "../../../assets/welcome/Tools.jpg";
import HealthCamp from "../../../assets/welcome/HealthCamp.jpg";

const WELCOME_IMAGES = [MRI, Tools, HealthCamp];

const navItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "overview", label: "Overview", icon: Activity },
  { id: "assistant", label: "Health Assistant", icon: MessageCircle },
  { id: "records", label: "Medical Records", icon: ClipboardList },
  { id: "appointments", label: "Appointments", icon: CalendarDays },
  { id: "pharmacy", label: "Pharmacy", icon: Pill },
  { id: "settings", label: "Settings", icon: Settings },
] as const satisfies Array<{ id: Page; label: string; icon: typeof Activity }>;

const pageHeaderTitle: Record<Page, string> = {
  home: "Welcome",
  overview: "Overview",
  assistant: "Health Assistant",
  records: "Medical Records",
  appointments: "Appointments",
  pharmacy: "Pharmacy",
  settings: "Account Settings",
};

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

function createChatMessage(role: "assistant" | "user", text: string): AssistantChatMessage {
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
  if (normalized.includes("cancel"))
    return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  if (normalized.includes("pending"))
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (normalized.includes("complete"))
    return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
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

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) return "PT";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

type DashboardSelectOption = {
  value: string;
  label: string;
  description?: string;
};

function DashboardCustomSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DashboardSelectOption[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find((option) => option.value === value);

  return (
    <div
      ref={rootRef}
      className={`custom-select ${open ? "custom-select--open" : ""} ${disabled ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        className="custom-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={18}
          className={`custom-select__chevron ${open ? "custom-select__chevron--open" : ""}`}
        />
      </button>

      {open && !disabled ? (
        <div className="custom-select__menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={`custom-select__option custom-select__option--compact ${
                value === option.value ? "custom-select__option--selected" : ""
              }`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="custom-select__option-label">{option.label}</span>
              {option.description ? (
                <span className="custom-select__option-copy">{option.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
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
  const [medicalRecordConsentDefault, setMedicalRecordConsentDefault] = useState(true);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);
  const assistantScrollRef = useRef<HTMLDivElement | null>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const displayName = overview?.user.name || user?.name || user?.email?.split("@")[0] || "Patient";
  const legalName = overview?.user.legal_name || user?.legalName || "Not available";
  const upcomingAppointments = appointments.filter(
    (item) => item.status.toLowerCase() !== "cancelled",
  );
  const deferredAssistantMessages = useDeferredValue(assistantMessages);
  const assistantStorageKey = `patient-dashboard-assistant:v${assistantHistoryVersion}:${overview?.user.id || user?.id || user?.email || "guest"}`;
  const profilePhotoStorageKey = `patient-dashboard-profile-photo:${overview?.user.id || user?.id || user?.email || "guest"}`;
  const currentHeaderTitle = pageHeaderTitle[page];
  const qrCodeUrl = overview?.patient.dhid
    ? `${QR_CODE_API_BASE}/?size=220x220&data=${encodeURIComponent(overview.patient.dhid)}`
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
    const uniqueDoctors = new Map<
      number,
      { id: number; name: string; specialization: string | null }
    >();

    bookingOptions
      .filter((item) => item.organisation_id === selectedOrganisationId)
      .forEach((item) => {
        uniqueDoctors.set(item.doctor_id, {
          id: item.doctor_id,
          name: item.doctor_name,
          specialization: item.specialization,
        });
      });

    return Array.from(uniqueDoctors.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [appointmentForm.organisationId, bookingOptions]);

  const selectedOption = useMemo(() => {
    if (!appointmentForm.organisationId || !appointmentForm.doctorId) {
      return null;
    }

    return (
      bookingOptions.find(
        (item) =>
          item.organisation_id === Number(appointmentForm.organisationId) &&
          item.doctor_id === Number(appointmentForm.doctorId),
      ) ?? null
    );
  }, [appointmentForm.doctorId, appointmentForm.organisationId, bookingOptions]);

  const visibleSlots = useMemo(() => {
    if (!appointmentForm.organisationId) {
      return [];
    }

    return availableSlots.filter((slot) => {
      const matchesOrganisation =
        slot.organisation_id == null ||
        slot.organisation_id === Number(appointmentForm.organisationId);
      const matchesDate =
        !appointmentForm.appointmentDate ||
        toDateInputValue(slot.start_time) === appointmentForm.appointmentDate;

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
    () => prescriptionOptions.find((item) => String(item.id) === selectedPrescriptionId) ?? null,
    [prescriptionOptions, selectedPrescriptionId],
  );

  const selectedPharmacyMeta = useMemo(
    () => pharmacyOptions.find((item) => String(item.id) === selectedPharmacyId) ?? null,
    [pharmacyOptions, selectedPharmacyId],
  );

  const showToast = (message: string, tone: "success" | "error" | "info" = "success") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message, tone });
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 2800);
  };

  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    // Only run the timer if the user is actually on the home page
    if (page !== "home") return;

    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % WELCOME_IMAGES.length);
    }, 5000); // Change image every 5 seconds

    return () => clearInterval(interval);
  }, [page]);

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
        setDashboardError(
          error instanceof Error
            ? error.message
            : "Dashboard data could not be loaded. Refresh the page to try again.",
        );
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
    setMedicalRecordConsentDefault(overview?.patient.medical_record_consent_default ?? true);
  }, [overview?.patient.medical_record_consent_default]);

  useEffect(() => {
    const storedPhoto = localStorage.getItem(profilePhotoStorageKey);
    setProfilePhoto(storedPhoto || null);
  }, [profilePhotoStorageKey]);

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

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

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
          error instanceof Error ? error.message : "Available slots could not be loaded right now.",
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

      setAssistantMessages((current) => [...current, createChatMessage("assistant", reply.answer)]);
    } catch (error) {
      const fallbackText = error instanceof Error ? error.message : "Assistant request failed";

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
      showToast(error instanceof Error ? error.message : "Appointment request failed", "error");
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
      showToast(error instanceof Error ? error.message : "Failed to cancel appointment", "error");
    }
  };

  const toggleConsent = async (appointmentId: number, nextGranted: boolean) => {
    try {
      await updateAppointmentConsent(appointmentId, nextGranted);
      showToast(nextGranted ? "Consent granted." : "Consent revoked.");
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Consent update failed", "error");
    }
  };

  const copyDhid = async () => {
    if (!overview?.patient.dhid) return;
    await navigator.clipboard.writeText(overview.patient.dhid);
    showToast("DHID copied.");
  };

  const onProfilePhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Pick an image file.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        showToast("Could not read that image.", "error");
        return;
      }

      localStorage.setItem(profilePhotoStorageKey, result);
      setProfilePhoto(result);
      showToast("Profile photo updated.");
    };
    reader.onerror = () => showToast("Could not read that image.", "error");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const removeProfilePhoto = () => {
    localStorage.removeItem(profilePhotoStorageKey);
    setProfilePhoto(null);
    showToast("Profile photo removed.");
  };

  const downloadQrCode = async () => {
    if (!overview?.patient.dhid || !qrCodeUrl) return;

    try {
      const response = await fetch(qrCodeUrl);
      if (!response.ok) {
        throw new Error("QR download failed");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${overview.patient.dhid}-qr.png`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showToast("QR code downloaded.");
    } catch {
      showToast("Could not download QR code.", "error");
    }
  };

  const saveProfile = async () => {
    const cleaned = profileName.trim();
    if (!cleaned || cleaned.length < 2) {
      showToast("Preferred name must be at least 2 characters.", "error");
      return;
    }

    setIsSavingProfile(true);
    try {
      await updatePatientProfile({
        preferred_name: cleaned,
        medical_record_consent_default: medicalRecordConsentDefault,
      });
      showToast("Profile updated.");
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Profile update failed", "error");
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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-62 flex-col border-r border-sky-200/60 bg-sky-100 px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 px-2">
          <AppBrandMark subtitle="Patient Console" />
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
          <button
            type="button"
            onClick={logoutNow}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 py-3 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex min-h-screen flex-col md:ml-64">
        <header className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white/85 px-4 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 md:left-64 md:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen((value) => !value)}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
            >
              <Menu size={20} />
            </button>
            <div>
              <h2 className="font-headline text-[1.45rem] font-extrabold uppercase tracking-[0.08em] text-blue-900 dark:text-blue-400 sm:text-[1.75rem]">
                {currentHeaderTitle}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-700">
            {page === "appointments" ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 dark:bg-blue-600"
                disabled={bookingOptions.length === 0}
              >
                Book Appointment
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Toggle theme"
            >
              {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setPage("settings")}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-slate-200 text-sm font-black tracking-[0.08em] text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-700 dark:text-slate-100"
            >
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt={`${displayName} avatar`}
                  className="h-full w-full object-cover"
                />
              ) : (
                getInitials(displayName)
              )}
            </button>
          </div>
        </header>

        {mobileNavOpen ? (
          <>
            <div
              className="fixed inset-0 z-20 bg-slate-900/10 md:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
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

        <div className="w-full flex-1 px-4 pb-28 pt-24 md:px-8 md:pb-12">
          {!isLoading && !dashboardError && page === "home" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 flex flex-col gap-12 pb-16">
              {/* 1. HERO SECTION (Slideshow) */}
              <section className="relative -mx-4 md:-mx-8 -mt-4 md:-mt-8 flex min-h-[70vh] items-center justify-center overflow-hidden shadow-2xl shadow-blue-900/10">
                {/* Background Slideshow Layer */}
                <div className="absolute inset-0 z-0">
                  {WELCOME_IMAGES.map((src, index) => (
                    <div
                      key={src}
                      className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out ${
                        index === bgIndex ? "opacity-100" : "opacity-0"
                      }`}
                      style={{ backgroundImage: `url(${src})` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/20 to-white/10 backdrop-blur-[1px]" />
                    </div>
                  ))}
                </div>

                {/* Content Layer */}
                <div className="relative z-10 max-w-4xl px-6 text-center text-white">
                  <span className="mb-4 inline-block rounded-full bg-blue-500/20 px-4 py-1.5 text-sm font-bold tracking-wide text-Blue-300 backdrop-blur-md border border-emerald-400/30">
                    State Healthcare Portal
                  </span>
                  <h1 className="font-headline text-5xl font-extrabold tracking-tight sm:text-7xl drop-shadow-xl">
                    Welcome, <span className="text-blue-600">{displayName}</span>
                  </h1>
                  <p className="mx-auto mt-6 max-w-xl text-lg text-slate-100/90 drop-shadow-md sm:text-xl">
                    Your unified health ecosystem. Access medical records, manage clinical
                    appointments, and connect with providers nationwide.
                  </p>

                  <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
                    <button
                      onClick={() => setPage("overview")}
                      className="group flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 font-bold text-white shadow-xl transition-all hover:bg-blue-700 hover:scale-105 active:scale-95"
                    >
                      <Activity className="h-5 w-5" />
                      Launch Dashboard
                    </button>
                    <button
                      onClick={() => setPage("appointments")}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-8 py-4 font-bold text-white backdrop-blur-md transition-all hover:bg-white/20 hover:scale-105 active:scale-95"
                    >
                      <CalendarDays className="h-5 w-5" />
                      Book Appointment
                    </button>
                  </div>
                </div>
              </section>

              {/* SECTION: WHAT IS MEDICONNECT */}
              <section className="mt-6 border-t border-slate-100 pt-6 dark:border-white/5">
                <div className="mb-6 flex flex-col items-start gap-4">
                  <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
                    <Sparkles size={14} />
                    The MediConnect Advantage
                  </span>
                  <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Your Health, <span className="text-blue-600 dark:text-blue-400">Unified.</span>
                  </h2>
                  <p className="max-w-2xl text-slate-500 dark:text-slate-400">
                    MediConnect is a national healthcare integration network that bridges the gap
                    between state hospitals, pharmacies, and patients. We turn fragmented medical
                    data into a single, secure, and accessible ecosystem.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {[
                    {
                      title: "Unified Health ID",
                      desc: "One Digital Health ID (DHID) that works across every state hospital in Sri Lanka. No more carrying paper files.",
                      icon: Fingerprint,
                      color: "blue",
                    },
                    {
                      title: "Smart Prescriptions",
                      desc: "Instant digital prescriptions sent from your doctor directly to the pharmacy lane. Track dispensing in real-time.",
                      icon: Pill,
                      color: "emerald",
                    },
                    {
                      title: "Secure Backbone",
                      desc: "Advanced encryption ensures your clinical history is only accessible by authorized medical practitioners.",
                      icon: ShieldCheck,
                      color: "indigo",
                    },
                  ].map((feature, i) => (
                    <div
                      key={i}
                      className="group relative overflow-hidden rounded-[2rem] border border-slate-100 bg-white p-8 transition-all hover:border-blue-500/30 dark:border-white/5 dark:bg-[#0a0a0a]"
                    >
                      <div
                        className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-${feature.color}-50 text-${feature.color}-600 transition-transform group-hover:scale-110 dark:bg-${feature.color}-500/10 dark:text-${feature.color}-400`}
                      >
                        <feature.icon size={28} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {feature.desc}
                      </p>

                      {/* Decorative Background Element */}
                      <div
                        className={`absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-${feature.color}-500/5 blur-2xl transition-opacity group-hover:opacity-100`}
                      />
                    </div>
                  ))}
                </div>

                {/* Network Connectivity Banner */}
                <div className="mt-12 rounded-[2.5rem] bg-slate-900 p-1 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] dark:bg-blue-600/5">
                  <div className="flex flex-col items-center justify-between gap-6 rounded-[2.3rem] bg-white px-10 py-8 dark:bg-[#050505] md:flex-row">
                    <div className="flex items-center gap-6">
                      <div className="hidden h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 md:flex">
                        <Activity size={24} />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold">100+ Hospitals Connected</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Join the nationwide network optimizing public healthcare delivery.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. AT-A-GLANCE STATS (Blue & Green Theme) */}
              <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="group relative overflow-hidden rounded-3xl border border-blue-100 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-900/30">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Identity Verified</p>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        National Health ID
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-blue-600">
                    <BadgeCheck className="h-4 w-4" /> SECURE ACCESS ACTIVE
                  </div>
                </div>

                <div className="group relative overflow-hidden rounded-3xl border border-emerald-100 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-900/30">
                      <ClipboardList className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Current Status</p>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Healthy & Active
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-600">
                    <Activity className="h-4 w-4" /> 0 PENDING ACTIONS
                  </div>
                </div>

                <div className="group relative overflow-hidden rounded-3xl border border-blue-100 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-900/30">
                      <Pill className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Prescriptions</p>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Unified Pharmacy
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-blue-600">
                    <ShieldPlus className="h-4 w-4" /> SYNCED NATIONWIDE
                  </div>
                </div>
              </section>

              {/* 3. QUICK ACTIONS GRID */}
              <section>
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    How can we help today?
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {[
                    { label: "Health AI", icon: MessageCircle, color: "blue", target: "assistant" },
                    { label: "Records", icon: ClipboardList, color: "emerald", target: "records" },
                    { label: "Pharmacy", icon: Pill, color: "blue", target: "pharmacy" },
                    { label: "Settings", icon: Settings, color: "emerald", target: "settings" },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => setPage(action.target as Page)}
                      className={`flex flex-col items-center gap-4 rounded-3xl border border-slate-100 bg-white p-6 transition-all hover:-translate-y-1 hover:border-${action.color}-200 hover:shadow-lg dark:border-slate-800 dark:bg-slate-800`}
                    >
                      <div
                        className={`rounded-2xl bg-${action.color}-50 p-4 text-${action.color}-600 dark:bg-${action.color}-900/20`}
                      >
                        <action.icon className="h-6 w-6" />
                      </div>
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* 4. CLINICAL CARE BANNER */}
              <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-blue-600 to-emerald-600 p-10 text-white">
                <div className="relative z-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                  <div className="max-w-md">
                    <h2 className="text-3xl font-bold">Smart Care Assistant</h2>
                    <p className="mt-2 text-blue-50/90">
                      Have questions about your lab results or medication? Our AI Clinical Assistant
                      is available 24/7 to provide immediate guidance.
                    </p>
                  </div>
                  <button
                    onClick={() => setPage("assistant")}
                    className="rounded-2xl bg-white px-8 py-4 font-bold text-blue-600 shadow-xl transition-transform hover:scale-105 active:scale-95"
                  >
                    Consult Assistant
                  </button>
                </div>
                {/* Decorative patterns */}
                <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -bottom-10 left-10 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
              </section>
            </div>
          )}
          {isLoading ? <LoadingState message="Loading your patient dashboard..." /> : null}
          {!isLoading && dashboardError ? (
            <ErrorState title="Patient dashboard unavailable" message={dashboardError} />
          ) : null}
          {!isLoading && !dashboardError && page === "overview" && overview ? (
            <section className="space-y-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_420px]">
                <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200/90 bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.22),_transparent_34%),linear-gradient(135deg,_rgba(30,64,175,0.10),_rgba(255,255,255,0.95)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-5 shadow-sm dark:border-slate-700/70 dark:bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.18),_transparent_38%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.9)_58%,_rgba(30,41,59,0.94))]">
                  <div className="absolute inset-y-0 right-0 w-32 bg-[radial-gradient(circle_at_center,_rgba(148,163,184,0.12),_transparent_65%)] dark:bg-[radial-gradient(circle_at_center,_rgba(96,165,250,0.12),_transparent_65%)]" />
                  <div className="relative">
                    <p className="text-xs font-extrabold uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">
                      Welcome back
                    </p>
                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="font-headline text-3xl font-extrabold text-slate-900 dark:text-white">
                          {displayName}
                        </h2>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                          Your latest appointments, records, and prescription activity are lined up
                          here.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPage("settings")}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/16"
                      >
                        Open profile
                      </button>
                    </div>
                  </div>
                </div>

                {/* UPDATE: DIGITAL ID CARD (Slightly adjusted for visual consistency) */}
                <button
                  type="button"
                  onClick={() => setModal("digital-id")}
                  className="flex items-center justify-between gap-5 rounded-[1.75rem] border border-slate-200/90 bg-white/80 p-5 text-left shadow-sm backdrop-blur-sm transition hover:bg-white dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
                      Your Digital Health ID
                    </span>
                    <span className="mt-1 block font-headline text-xl font-extrabold tracking-[0.18em] text-secondary dark:text-blue-300">
                      {overview.patient.dhid}
                    </span>
                  </div>
                  <ShieldPlus className="text-secondary dark:text-blue-300" size={28} />
                </button>
              </div>

              {/* STATS GRID - Remains Standard for readability */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Upcoming Appointments", overview.stats.upcoming_appointments],
                  ["Total Appointments", overview.stats.total_appointments],
                  ["Medical Records", overview.stats.medical_records],
                  ["Active Prescriptions", overview.stats.active_prescriptions],
                ].map(([label, value]) => (
                  <article
                    key={label}
                    className="relative overflow-hidden rounded-[1.5rem] border border-slate-200/90 bg-[linear-gradient(135deg,_rgba(255,255,255,0.9)_0%,_rgba(241,245,249,0.8)_100%)] p-6 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-[linear-gradient(135deg,_rgba(15,23,42,0.9)_0%,_rgba(30,41,59,0.8)_100%)]"
                  >
                    <div className="absolute -left-8 -top-8 h-24 w-24 bg-blue-400/10 blur-2xl dark:bg-blue-500/5" />

                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                        {label}
                      </p>
                      <p className="mt-3 font-headline text-4xl font-extrabold text-slate-900 dark:text-white">
                        {value}
                      </p>
                    </div>
                  </article>
                ))}
              </div>

              {/* LOWER CONTENT SECTION */}
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="font-headline text-xl font-bold">Upcoming Appointments</h2>
                    <button
                      type="button"
                      onClick={() => setPage("appointments")}
                      className="text-sm font-bold text-primary dark:text-blue-400"
                    >
                      Open full list
                    </button>
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
                        <article
                          key={item.id}
                          className="rounded-[1.4rem] bg-slate-50 p-4 dark:bg-slate-800/50"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="font-bold">{item.doctor.name}</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                {item.doctor.specialization || "Specialization not set"} at{" "}
                                {item.organisation.name}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-primary dark:text-blue-400">
                                {formatDateTime(item.start_time)}
                              </p>
                              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                Consent: {item.consent.status}
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}
                            >
                              {item.status}
                            </span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="col-span-12 rounded-[1.7rem] border border-slate-100 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-800/50 lg:col-span-4">
                  <h2 className="mb-4 font-headline text-xl font-bold">Latest Medical Record</h2>
                  {overview.recent_record ? (
                    <div className="rounded-xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {formatDateTime(overview.recent_record.created_at)}
                      </p>
                      <p className="mt-2 text-base font-medium">
                        {overview.recent_record.notes ||
                          "No consultation notes were saved for this record."}
                      </p>
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
            <section className="min-h-[calc(100svh-8rem)] space-y-5">
              <div
                ref={assistantScrollRef}
                className="min-h-[calc(100svh-20rem)] overflow-y-auto rounded-[1.9rem] border border-slate-100 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:px-8 md:py-8"
              >
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_340px]">
                  <div className="flex flex-col gap-4">
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
                      <div className="mt-2 grid gap-3">
                        {assistantPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => void sendAssistantMessage(prompt)}
                            disabled={isAssistantLoading}
                            className="w-full rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-left text-[1rem] text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
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

                  <aside className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                      Quick help
                    </p>
                    <div className="mt-4 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                        Ask about appointments, prescriptions, diagnoses, or past records.
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                        Use the prompt buttons or type your own question below.
                      </div>
                    </div>
                  </aside>
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 px-4 py-5 dark:border-slate-800 dark:bg-slate-800/40 md:px-6">
                <div className="flex items-center gap-3 rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <input
                    type="text"
                    value={assistantInput}
                    onChange={(event) => setAssistantInput(event.target.value)}
                    onKeyDown={onAssistantKeyDown}
                    placeholder="Ask a health question..."
                    className="flex-1 border-0 bg-transparent text-base text-slate-700 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
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
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "records" ? (
            <section className="space-y-6">
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3 xl:grid-cols-2">
                {records.length === 0 ? (
                  <EmptyState
                    title="No medical records yet"
                    description="Encounter notes and linked prescriptions will appear here after your first completed consultation."
                    className="rounded-[1.7rem] xl:col-span-2 2xl:col-span-3"
                  />
                ) : (
                  records.map((record) => (
                    <article
                      key={record.id}
                      className="flex h-full flex-col rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-bold">{record.doctor.name}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {record.doctor.specialization || "Specialization not set"}
                            {record.organisation.name ? ` • ${record.organisation.name}` : ""}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-primary dark:text-blue-400">
                            {formatDateTime(record.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {record.appointment.status ? (
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(record.appointment.status)}`}
                            >
                              {formatStatusLabel(record.appointment.status)}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(record);
                              setModal("record");
                            }}
                            className={`rounded-full px-4 py-2 text-xs font-bold ${
                              selectedRecord?.id === record.id && modal === "record"
                                ? "bg-primary text-white dark:bg-blue-600"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {selectedRecord?.id === record.id && modal === "record"
                              ? "Opened"
                              : "Open Record"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                            Snapshot
                          </p>
                          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                            {recordPreview(record)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                            Prescriptions
                          </p>
                          {record.prescriptions.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              No prescriptions linked to this encounter.
                            </p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {record.prescriptions.map((prescription) => (
                                <div
                                  key={prescription.id}
                                  className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50"
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <p className="text-sm font-bold">
                                      Prescription #{prescription.id} •{" "}
                                      {formatStatusLabel(prescription.status)}
                                    </p>
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
                                      <div
                                        key={item.id}
                                        className="text-sm text-slate-600 dark:text-slate-300"
                                      >
                                        {item.medicine_name} • {item.dosage} • Qty {item.quantity}
                                      </div>
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
              {bookingOptions.length === 0 ? (
                <AlertBanner
                  tone="info"
                  title="Booking availability is limited"
                  message="No bookable doctor affiliations are available right now. Appointment booking will open as soon as live availability slots are published from the backend."
                  className="rounded-[1.7rem]"
                />
              ) : null}

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3 xl:grid-cols-2">
                {appointments.length === 0 ? (
                  <EmptyState
                    title="No appointments yet"
                    description="When you reserve a live slot, it will appear here with confirmation status, consent details, and follow-up actions."
                    className="rounded-[1.7rem] xl:col-span-2 2xl:col-span-3"
                  />
                ) : (
                  appointments.map((item) => (
                    <article
                      key={item.id}
                      className="flex h-full flex-col rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xl font-bold">{item.doctor.name}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {item.doctor.specialization || "Specialization not set"} at{" "}
                            {item.organisation.name}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-primary dark:text-blue-400">
                            {formatDateTime(item.start_time)} to {formatDateTime(item.end_time)}
                          </p>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            Full-history consent: {item.consent.status}
                          </p>
                          {item.consent.last_updated ? (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Last changed {formatDateTime(item.consent.last_updated)}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}
                        >
                          {formatStatusLabel(item.status)}
                        </span>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
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
                          <button
                            type="button"
                            onClick={() => openRescheduleModal(item)}
                            className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white dark:bg-blue-600"
                          >
                            Reschedule
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void cancelAppointment(item.id)}
                          disabled={item.status.toLowerCase() === "cancelled"}
                          className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "pharmacy" ? (
            <section className="space-y-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="font-headline text-2xl font-extrabold text-primary dark:text-blue-400">
                    ePrescription Cost Check
                  </h2>
                </div>
                {selectedPrescriptionMeta || selectedPharmacyMeta ? (
                  <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    <p>
                      {selectedPrescriptionMeta
                        ? selectedPrescriptionMeta.label
                        : "No prescription selected yet."}
                    </p>
                    <p className="mt-1">
                      {selectedPharmacyMeta
                        ? `${selectedPharmacyMeta.name} • ${selectedPharmacyMeta.indexed_items} indexed item(s)`
                        : "No pharmacy selected yet."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.1fr_1.1fr_auto]">
                <label className="block rounded-[1.4rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    ePrescription
                  </span>
                  <div className="mt-3">
                    <DashboardCustomSelect
                      value={selectedPrescriptionId}
                      onChange={setSelectedPrescriptionId}
                      placeholder="Select a prescription"
                      options={prescriptionOptions.map((option) => ({
                        value: String(option.id),
                        label: option.label,
                      }))}
                    />
                  </div>
                </label>

                <label className="block rounded-[1.4rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    Pharmacy
                  </span>
                  <div className="mt-3">
                    <DashboardCustomSelect
                      value={selectedPharmacyId}
                      onChange={setSelectedPharmacyId}
                      placeholder="Select a pharmacy"
                      options={pharmacyOptions.map((option) => ({
                        value: String(option.id),
                        label: option.name,
                      }))}
                    />
                  </div>
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
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-4">
                    <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        Estimated Total
                      </p>
                      <p className="mt-3 font-headline text-3xl font-extrabold text-primary dark:text-blue-400">
                        {formatLkr(pharmacyEstimate.summary.estimated_total)}
                      </p>
                    </article>
                    <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        Included Items
                      </p>
                      <p className="mt-3 font-headline text-3xl font-extrabold">
                        {pharmacyEstimate.summary.included_items}
                      </p>
                    </article>
                    <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        Excluded Items
                      </p>
                      <p className="mt-3 font-headline text-3xl font-extrabold">
                        {pharmacyEstimate.summary.excluded_items}
                      </p>
                    </article>
                    <article className="rounded-[1.4rem] bg-slate-50 p-5 dark:bg-slate-800/60">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        Pharmacy
                      </p>
                      <p className="mt-3 text-lg font-bold">{pharmacyEstimate.pharmacy.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Prescription #{pharmacyEstimate.prescription.id} •{" "}
                        {pharmacyEstimate.prescription.doctor_name || "Doctor not found"}
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
                      <article
                        key={item.id}
                        className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-lg font-bold">{item.medicine_name}</p>
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ${estimateTone(item.availability_status)}`}
                              >
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
                            <p>
                              Stock here:{" "}
                              <span className="font-semibold">{item.stock_quantity}</span>
                            </p>
                            <p className="mt-1">
                              Unit price:{" "}
                              <span className="font-semibold">
                                {item.unit_price == null
                                  ? "Not priced"
                                  : formatLkr(item.unit_price)}
                              </span>
                            </p>
                            <p className="mt-1">
                              Bill line total:{" "}
                              <span className="font-semibold">
                                {item.estimated_total == null
                                  ? "Not included"
                                  : formatLkr(item.estimated_total)}
                              </span>
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
                <div className="rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                  Select both fields and hit{" "}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    Calculate Bill
                  </span>
                  . If a drug is missing from that pharmacy, it will be clearly marked and excluded
                  from the estimate.
                </div>
              )}
              <div className="space-y-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
                      Dispensing Events
                    </p>
                    <p className="mt-3 font-headline text-4xl font-extrabold">
                      {dispensingSummary.stats.dispensing_events}
                    </p>
                  </article>
                  <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
                      Prescriptions Dispensed
                    </p>
                    <p className="mt-3 font-headline text-4xl font-extrabold">
                      {dispensingSummary.stats.prescriptions_dispensed}
                    </p>
                  </article>
                  <article className="rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
                      Total Billed
                    </p>
                    <p className="mt-3 font-headline text-3xl font-extrabold">
                      {formatLkr(dispensingSummary.stats.total_billed)}
                    </p>
                  </article>
                </div>

                <div>
                  <h3 className="font-headline text-2xl font-extrabold text-primary dark:text-blue-400">
                    Dispensing & Billing
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Track what has been dispensed and what has been billed against your
                    prescriptions.
                  </p>
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
                      <article
                        key={item.id}
                        className="rounded-[1.45rem] bg-slate-50 p-5 dark:bg-slate-800/50"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-lg font-bold">{item.pharmacy.name}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              Prescription #{item.prescription_id}
                            </p>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              {formatDateTime(item.created_at)}
                            </p>
                          </div>
                          <div className="text-left md:text-right">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}
                            >
                              {formatStatusLabel(item.status)}
                            </span>
                            <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
                              Dispensed: {formatLkr(item.total_price)}
                            </p>
                            <p className="mt-1 text-base font-bold text-primary dark:text-blue-400">
                              Billed: {formatLkr(item.billed_total)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {item.line_items.length === 0 ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              No dispensing line items saved yet.
                            </p>
                          ) : (
                            item.line_items.map((lineItem) => (
                              <div
                                key={lineItem.id}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                              >
                                <p className="font-semibold">
                                  {lineItem.medicine_name || "Unnamed item"}
                                </p>
                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                  {lineItem.dosage || "Dosage not set"} • Qty{" "}
                                  {lineItem.quantity_dispensed}
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
            </section>
          ) : null}

          {!isLoading && !dashboardError && page === "settings" && overview ? (
            <section className="space-y-6">
              <div className="space-y-6">
                <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200/90 bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.22),_transparent_34%),linear-gradient(135deg,_rgba(30,64,175,0.10),_rgba(255,255,255,0.95)_36%,_rgba(241,245,249,0.92)_100%)] px-6 py-5 shadow-sm dark:border-slate-700/70 dark:bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.18),_transparent_38%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.9)_58%,_rgba(30,41,59,0.94))] sm:px-8">
                  <div className="absolute inset-y-0 right-0 w-48 bg-[radial-gradient(circle_at_right,_rgba(148,163,184,0.25),_transparent_100%)] dark:bg-[radial-gradient(circle_at_right,_rgba(96,165,250,0.25),_transparent_100%)]" />
                  <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white/90 text-lg font-black tracking-[0.08em] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md dark:border-white/15 dark:bg-white/10 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
                        {profilePhoto ? (
                          <img
                            src={profilePhoto}
                            alt={`${displayName} avatar`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          getInitials(displayName)
                        )}
                      </div>
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-100">
                          <ShieldCheck size={13} />
                          Patient profile
                        </div>
                        <h2 className="mt-3 font-headline text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
                          {displayName}
                        </h2>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={logoutNow}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/16"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                </div>

                {/* 1. Added the linear sky blue gradient to the main container */}
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.95fr)]">
                  <div className="rounded-[1.55rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(224,242,254,0.7),rgba(186,230,253,0.4))] p-5 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.6),rgba(8,10,15,0.8))]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-blue-400/60">
                          Editable profile
                        </p>
                        <h3 className="mt-2 font-headline text-lg font-extrabold text-slate-900 dark:text-white sm:text-xl">
                          Preferred name
                        </h3>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-blue-600 shadow-sm dark:border-blue-500/30 dark:bg-slate-900 dark:text-blue-400">
                        <UserRound size={18} />
                      </div>
                    </div>

                    <label className="mt-6 block">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                        Preferred name
                      </span>
                      <input
                        type="text"
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium shadow-sm transition focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                        Legal name on NIC
                      </p>
                      <p className="mt-2 font-medium">{legalName}</p>
                    </div>

                    <div className="mt-6 rounded-[1.35rem] border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-lg font-black tracking-[0.08em] text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                            {profilePhoto ? (
                              <img
                                src={profilePhoto}
                                alt={`${displayName} avatar`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              getInitials(displayName)
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                              Profile photo
                            </p>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                              Upload a photo or keep the initials badge.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <input
                            ref={profilePhotoInputRef}
                            type="file"
                            accept="image/*"
                            onChange={onProfilePhotoSelected}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => profilePhotoInputRef.current?.click()}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Camera size={16} />
                            Upload photo
                          </button>
                          <button
                            type="button"
                            onClick={removeProfilePhoto}
                            className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 rounded-[1.35rem] border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="max-w-xl">
                          <div className="flex items-center gap-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-100 p-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              <ShieldPlus size={16} />
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                                Medical record consent
                              </p>
                              <h4 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
                                Default access for new appointments
                              </h4>
                            </div>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            Keep this enabled to grant doctors default access to your medical
                            history on future bookings. You can still revoke or grant consent per
                            appointment later.
                          </p>
                          {overview.patient.medical_record_consent_last_updated ? (
                            <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                              Last changed{" "}
                              {formatDateTime(overview.patient.medical_record_consent_last_updated)}
                            </p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={medicalRecordConsentDefault}
                          onClick={() => setMedicalRecordConsentDefault((current) => !current)}
                          className={`inline-flex items-center gap-3 rounded-full border px-3 py-2 transition ${
                            medicalRecordConsentDefault
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200"
                              : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          <span
                            className={`relative h-7 w-12 rounded-full transition ${
                              medicalRecordConsentDefault
                                ? "bg-emerald-500/90 dark:bg-emerald-500"
                                : "bg-slate-300 dark:bg-slate-600"
                            }`}
                          >
                            <span
                              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                medicalRecordConsentDefault ? "left-6" : "left-1"
                              }`}
                            />
                          </span>
                          <span className="min-w-[88px] text-left text-sm font-bold">
                            {medicalRecordConsentDefault ? "Default On" : "Default Off"}
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => void saveProfile()}
                        disabled={isSavingProfile}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#0a4f87] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                      >
                        <BadgeCheck size={17} />
                        {isSavingProfile ? "Saving..." : "Save profile"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyDhid()}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Copy size={16} />
                        Copy DHID
                      </button>
                    </div>
                  </div>

                  <article className="rounded-[1.55rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(224,242,254,0.7),rgba(186,230,253,0.4))] p-5 shadow-sm dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.6),rgba(8,10,15,0.8))]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                          Read only
                        </p>
                        <h3 className="mt-2 font-headline text-lg font-extrabold text-slate-900 dark:text-white sm:text-xl">
                          User details
                        </h3>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        <Fingerprint size={18} />
                      </div>
                    </div>

                    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 dark:border-slate-700 dark:bg-slate-900/80">
                      <div className="flex items-start gap-3 border-b border-slate-200/80 px-4 py-4 dark:border-slate-700">
                        <Mail size={16} className="mt-0.5 text-slate-400 dark:text-slate-500" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                            Primary email
                          </p>
                          <p className="mt-2 break-all text-sm font-semibold text-slate-900 dark:text-white">
                            {overview.user.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 border-b border-slate-200/80 px-4 py-4 dark:border-slate-700">
                        <Sparkles size={16} className="mt-0.5 text-slate-400 dark:text-slate-500" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                            Digital health ID
                          </p>
                          <p className="mt-2 font-headline text-xl font-extrabold tracking-[0.08em] text-primary dark:text-blue-300">
                            {overview.patient.dhid}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 px-4 py-4">
                        <ShieldCheck
                          size={16}
                          className="mt-0.5 text-slate-400 dark:text-slate-500"
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                            Issued
                          </p>
                          <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                            {formatDateTime(overview.patient.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </section>
          ) : null}
        </div>
        <footer className="border-t border-slate-100 bg-slate-50 px-8 py-12 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <p className="text-sm font-bold dark:text-slate-300">
                National Health Identity System
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                © 2026 Digital Health Ministry SL • Patient Portal v3.1
              </p>
            </div>
            <div className="flex gap-8">
              {["Privacy", "Terms", "Security"].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:underline"
                >
                  {item}
                </a>
              ))}
            </div>
          </div>
        </footer>
      </main>
      {modal === "digital-id" && overview ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-md"
          onClick={(event) => event.target === event.currentTarget && setModal(null)}
        >
          <div className="w-full max-w-[70rem] rounded-[2.2rem] border border-slate-200/80 bg-white p-6 shadow-[0_32px_90px_rgba(2,6,23,0.45)] dark:border-slate-700/90 dark:bg-slate-900 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Patient identity
                </p>
                <h3 className="mt-2 font-headline text-2xl font-extrabold text-slate-900 dark:text-white">
                  Digital Health ID
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 overflow-hidden rounded-[1.9rem] bg-slate-100 p-4 dark:bg-slate-800 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <div className="rounded-[1.6rem] bg-slate-950 px-6 py-6 text-white shadow-inner shadow-black/20">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100/70">
                    Patient identity
                  </p>
                  <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-white/5 px-5 py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100/60">
                      DHID
                    </p>
                    <div className="mt-3 space-y-2">
                      {overview.patient.dhid.match(/.{1,12}/g)?.map((segment, index) => (
                        <p
                          key={`${segment}-${index}`}
                          className="font-headline text-[2rem] font-extrabold tracking-[0.14em] text-blue-200 sm:text-[2.25rem]"
                        >
                          {segment}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.25rem] bg-white/8 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/65">
                        Issued
                      </p>
                      <p className="mt-2 text-sm text-blue-50/85">
                        {formatDateTime(overview.patient.created_at)}
                      </p>
                    </div>
                    <div className="rounded-[1.25rem] bg-white/8 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/65">
                        Usage
                      </p>
                      <p className="mt-2 text-sm text-blue-50/85">
                        Present this ID or QR code at registration, pharmacy, and verified hospital
                        touchpoints.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col rounded-[1.6rem] bg-white p-5 shadow-inner dark:bg-slate-900">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      QR access card
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Scan this code to retrieve the linked digital patient identity.
                    </p>
                  </div>
                  <div className="flex min-h-[24rem] flex-1 items-center justify-center rounded-[1.5rem] bg-slate-100 p-4 dark:bg-slate-800">
                    <img
                      src={qrCodeUrl}
                      alt={`QR code for ${overview.patient.dhid}`}
                      className="aspect-square w-full max-w-[21rem] rounded-xl bg-white p-3 shadow-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void copyDhid()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-bold text-white dark:bg-blue-600"
              >
                <span className="inline-flex items-center gap-2">
                  <Copy size={16} />
                  Copy ID
                </span>
              </button>
              <button
                type="button"
                onClick={() => void downloadQrCode()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3.5 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <span className="inline-flex items-center gap-2">
                  <Download size={16} />
                  Download QR
                </span>
              </button>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-2xl bg-slate-100 px-4 py-3.5 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === "record" && selectedRecord ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
          onClick={(event) => event.target === event.currentTarget && setModal(null)}
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_32px_90px_rgba(2,6,23,0.48)] dark:border-slate-700/90 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 pb-5 pt-6 dark:border-slate-800 md:px-8">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Open Record
                </p>
                <h3 className="mt-2 font-headline text-2xl font-extrabold text-primary dark:text-blue-400 md:text-3xl">
                  {selectedRecord.doctor.name}
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {selectedRecord.doctor.specialization || "Specialization not set"}
                  {selectedRecord.organisation.name ? ` • ${selectedRecord.organisation.name}` : ""}
                </p>
                <p className="mt-2 text-sm font-semibold text-primary dark:text-blue-400">
                  {formatDateTime(selectedRecord.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/45">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Doctor</p>
                  <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                    {selectedRecord.doctor.name}
                  </p>
                </div>
                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/45">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Organisation
                  </p>
                  <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                    {selectedRecord.organisation.name || "Not linked"}
                  </p>
                </div>
                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/45">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        Prescriptions
                      </p>
                      <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                        {selectedRecord.prescriptions.length}
                      </p>
                    </div>
                    {selectedRecord.appointment.status ? (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(selectedRecord.appointment.status)}`}
                      >
                        {formatStatusLabel(selectedRecord.appointment.status)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.95fr)]">
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/75 p-5 dark:border-slate-700 dark:bg-slate-800/45">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Doctor Notes</p>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">
                    {selectedRecord.notes || "No notes stored for this encounter."}
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/75 p-5 dark:border-slate-700 dark:bg-slate-800/45">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Prescription Summary
                    </p>
                    {selectedRecord.prescriptions.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPrescriptionId(String(selectedRecord.prescriptions[0].id));
                          setModal(null);
                          setPage("pharmacy");
                        }}
                        className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white dark:bg-blue-600"
                      >
                        Check First Prescription Cost
                      </button>
                    ) : null}
                  </div>
                  {selectedRecord.prescriptions.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                      No prescriptions linked to this encounter.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {selectedRecord.prescriptions.map((prescription) => (
                        <div
                          key={prescription.id}
                          className="rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-bold">
                                Prescription #{prescription.id} •{" "}
                                {formatStatusLabel(prescription.status)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {formatDateTime(prescription.created_at)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPrescriptionId(String(prescription.id));
                                setModal(null);
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
                                <div
                                  key={item.id}
                                  className="rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/70"
                                >
                                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                                    {item.medicine_name}
                                  </p>
                                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                                    {item.dosage || "Dosage not set"} • Qty{" "}
                                    {item.quantity || "Not set"}
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
            </div>

            <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-800 md:px-8">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modal === "appointment" ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-md"
          onClick={(event) => event.target === event.currentTarget && setModal(null)}
        >
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_32px_90px_rgba(2,6,23,0.48)] dark:border-slate-700/90 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-8 pb-6 pt-8 dark:border-slate-800">
              <div>
                <h3 className="text-2xl font-bold">
                  {editingAppointment ? "Reschedule Appointment" : "Book Appointment"}
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {editingAppointment
                    ? "Rescheduling currently updates the appointment window directly. Use this only after the clinic has already confirmed the new time."
                    : "Pick the organisation first, then the doctor, then the date. Matching live slots will appear below in a scrollable lane."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="space-y-6">
                {editingAppointment ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                          Organisation
                        </label>
                        <input
                          type="text"
                          value={
                            selectedOption?.organisation_name ||
                            editingAppointment.organisation.name
                          }
                          readOnly
                          className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                          Doctor
                        </label>
                        <input
                          type="text"
                          value={selectedOption?.doctor_name || editingAppointment.doctor.name}
                          readOnly
                          className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                          Date
                        </label>
                        <input
                          type="date"
                          value={appointmentForm.appointmentDate}
                          readOnly
                          className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    <AlertBanner
                      tone="info"
                      message="Slot reassignment is not available from the current backend contract, so this form only updates the requested appointment window."
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                          Start Time
                        </label>
                        <input
                          type="datetime-local"
                          value={appointmentForm.startTime}
                          onChange={(event) =>
                            setAppointmentForm((current) => ({
                              ...current,
                              startTime: event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                          End Time
                        </label>
                        <input
                          type="datetime-local"
                          value={appointmentForm.endTime}
                          onChange={(event) =>
                            setAppointmentForm((current) => ({
                              ...current,
                              endTime: event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-3">
                            <div>
                              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                                Organisation
                              </label>
                              <DashboardCustomSelect
                                value={appointmentForm.organisationId}
                                onChange={(value) =>
                                  setAppointmentForm({
                                    organisationId: value,
                                    doctorId: "",
                                    appointmentDate: "",
                                    slotId: "",
                                    startTime: "",
                                    endTime: "",
                                  })
                                }
                                placeholder="Select organisation"
                                options={organisationOptions.map((item) => ({
                                  value: String(item.id),
                                  label: item.name,
                                  description: "Verified booking organisation",
                                }))}
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                                Doctor
                              </label>
                              <DashboardCustomSelect
                                value={appointmentForm.doctorId}
                                onChange={(value) =>
                                  setAppointmentForm((current) => ({
                                    ...current,
                                    doctorId: value,
                                    appointmentDate: "",
                                    slotId: "",
                                    startTime: "",
                                    endTime: "",
                                  }))
                                }
                                disabled={!appointmentForm.organisationId}
                                placeholder="Select doctor"
                                options={doctorOptions.map((item) => ({
                                  value: String(item.id),
                                  label: item.name,
                                  description: item.specialization || "Specialization not set",
                                }))}
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                                Date
                              </label>
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

                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                                Selected Start Time
                              </label>
                              <input
                                type="datetime-local"
                                value={appointmentForm.startTime}
                                readOnly
                                className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                                Selected End Time
                              </label>
                              <input
                                type="datetime-local"
                                value={appointmentForm.endTime}
                                readOnly
                                className="w-full rounded-xl border-slate-200 bg-white px-4 py-3 shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[1.45rem] bg-white p-5 shadow-sm dark:bg-slate-900">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                            Selected doctor profile
                          </p>
                          {selectedOption ? (
                            <div className="mt-4 space-y-4">
                              <div className="rounded-[1.25rem] bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                                <p className="text-lg font-bold text-slate-900 dark:text-white">
                                  {selectedOption.doctor_name}
                                </p>
                                <p className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                  {selectedOption.specialization || "Specialization not set"}
                                </p>
                                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                  Practising at {selectedOption.organisation_name}
                                </p>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900/70">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    Organisation
                                  </p>
                                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    {selectedOption.organisation_name}
                                  </p>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900/70">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    Booking state
                                  </p>
                                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    {appointmentForm.appointmentDate
                                      ? "Date selected"
                                      : "Awaiting date"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-4 rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                              Pick an organisation and doctor to preview the specialization and
                              booking context here.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-400">
                        Available Slots
                      </label>
                      {!appointmentForm.organisationId ? (
                        <AlertBanner
                          tone="info"
                          message="Select an organisation to narrow down the doctors."
                        />
                      ) : !appointmentForm.doctorId ? (
                        <AlertBanner
                          tone="info"
                          message="Select a doctor to load that doctor's live availability."
                        />
                      ) : !appointmentForm.appointmentDate ? (
                        <AlertBanner
                          tone="info"
                          message="Pick a date and the matching slots will appear here."
                        />
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
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Published slots
                              </p>
                              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Choose the appointment window that best matches your visit.
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {visibleSlots.length} slot{visibleSlots.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="max-h-72 overflow-y-auto pr-2">
                            <div className="grid gap-3 md:grid-cols-2">
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
                                    <p className="text-sm font-bold">
                                      {formatDateTime(slot.start_time)}
                                    </p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                                      Ends
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      {formatDateTime(slot.end_time)}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-100 px-8 py-6 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 rounded-xl bg-slate-100 py-3 font-bold dark:bg-slate-800"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void submitAppointment()}
                disabled={
                  isSubmitting ||
                  (!editingAppointment &&
                    (!selectedOption ||
                      !appointmentForm.appointmentDate ||
                      !appointmentForm.slotId ||
                      isSlotsLoading))
                }
                className="flex-1 rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-60 dark:bg-blue-600"
              >
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
