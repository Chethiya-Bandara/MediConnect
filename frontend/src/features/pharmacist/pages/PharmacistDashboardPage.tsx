import { Html5Qrcode } from "html5-qrcode";
import { useDeferredValue, useEffect, useMemo, useState, useRef } from "react";
import {
  Fingerprint,
  Package,
  Sparkles,
  BarChart3,
  ClipboardCheck,
  History,
  Info,
  LogOut,
  Moon,
  Pill,
  QrCode,
  ImagePlus,
  Camera,
  Zap,
  XCircle,
  RefreshCcw,
  ScanLine,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Home,
  Activity,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBrandMark } from "../../../components/ui";
import { cn } from "../../../lib/utils/cn";
import { formatDate } from "../../../lib/utils/formatDate";
import { useAuth } from "../../auth/context/AuthContext";
import { PrescriptionStatusBadge } from "../components/PrescriptionStatusBadge";
import { usePharmacistDashboard } from "../hooks/usePharmacistDashboard";
import type { PharmacistSection } from "../types";

import Pharmacist1 from "../../../assets/welcome/Pharmacist1.jpg";
import Pharmacist2 from "../../../assets/welcome/Pharmacist2.jpg";
import Pharmacist3 from "../../../assets/welcome/Pharmacist3.jpg";

const WELCOME_IMAGES = [Pharmacist1, Pharmacist2, Pharmacist3];

function formatLkr(value: number | null) {
  if (value === null) return "N/A";
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-LK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(name?: string | null) {
  if (!name) return "PH";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PH";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getAvatarLetters(name?: string | null) {
  if (!name) return "PT";
  const compact = name.replace(/\s+/g, "").trim();
  if (!compact) return "PT";
  return compact.slice(0, 2).toUpperCase();
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  if (value === "ISSUED" || value === "PENDING") return "Not Issued";
  if (value === "PARTIALLY_DISPENSED") return "Partially Issued";
  if (value === "DISPENSED") return "Issued";
  return value.replaceAll("_", " ");
}

function formatStatusActionLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  if (value === "ISSUED" || value === "PENDING") return "Not Dispensing";
  if (value === "PARTIALLY_DISPENSED") return "Partially Dispensing";
  if (value === "DISPENSED") return "Dispensing";
  return value.replaceAll("_", " ");
}

function formatDosagePerDay(dosage: string | null | undefined, unit?: string | null) {
  if (!dosage) {
    return "Dosage not supplied";
  }

  return `Dosage: ${dosage}${unit ? ` ${unit}` : ""} per day`;
}

function formatPrescriptionInstructionSummary(
  instructions: string | null | undefined,
  unit?: string | null,
) {
  const normalized = (instructions ?? "").trim();
  const dosageMatch = normalized.match(/(\d+(?:\.\d+)?)\s*per\s*day/i);
  const durationMatch = normalized.match(/Duration:\s*(\d+)/i);
  const extras = normalized
    .replace(/(\d+(?:\.\d+)?)\s*per\s*day/i, "")
    .replace(/Duration:\s*\d+/i, "")
    .replace(/Encounter type:\s*[^|,]+/i, "")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[|,\s-]+|[|,\s-]+$/g, "");

  const parts: string[] = [];
  if (dosageMatch) {
    parts.push(`Dosage: ${dosageMatch[1]}${unit ? ` ${unit}` : ""} per day`);
  }
  if (durationMatch) {
    parts.push(`Duration: ${durationMatch[1]} Days`);
  }
  if (extras) {
    parts.push(extras);
  }

  return parts.join(", ") || "No extra instructions from backend.";
}

function noticeClassName(tone: "error" | "info" | "success") {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (tone === "info") {
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300";
  }
  return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300";
}

function getActionAlert(message: string) {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("successful") ||
    normalized.includes("Verify / Lookup mode successful") ||
    normalized.includes("loaded exact match") ||
    normalized.includes("added") ||
    normalized.includes("saved")
  ) {
    return {
      tone: "success" as const,
      title: "Success",
      description: message,
    };
  }

  if (
    normalized.includes("closest live queue result") ||
    normalized.includes("pick a prescription first") ||
    normalized.includes("choose at least one") ||
    normalized.includes("enter the pharmacy organisation id")
  ) {
    return {
      tone: "info" as const,
      title: "Heads up",
      description: message,
    };
  }

  return {
    tone: "error" as const,
    title: "Action response",
    description: message,
  };
}

interface QrScannerLaneProps {
  onScanSuccess: (decodedText: string) => void;
}

function extractLookupValueFromScan(decodedText: string) {
  const normalized = decodedText.trim();
  if (!normalized) {
    return "";
  }

  const dhidMatch = normalized.match(/dhid-[a-z0-9-]+/i);
  if (dhidMatch) {
    return dhidMatch[0].toUpperCase();
  }

  const prescriptionMatch = normalized.match(/presc[a-z0-9-]*/i);
  if (prescriptionMatch) {
    return prescriptionMatch[0];
  }

  try {
    const url = new URL(normalized);
    const candidates = [
      url.searchParams.get("dhid"),
      url.searchParams.get("prescription"),
      url.searchParams.get("prescriptionId"),
      url.searchParams.get("id"),
      url.pathname.split("/").filter(Boolean).at(-1) ?? "",
    ];
    const extracted = candidates.find((candidate) => candidate && candidate.trim());
    if (extracted) {
      return extracted.trim();
    }
  } catch {
    // Not a URL, so fall back to the raw scanned text.
  }

  return normalized;
}

export const QrScannerLane = ({ onScanSuccess }: QrScannerLaneProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const qrCodeInstance = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    qrCodeInstance.current = new Html5Qrcode("reader");

    return () => {
      if (qrCodeInstance.current?.isScanning) {
        qrCodeInstance.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleStartCamera = async () => {
    if (!qrCodeInstance.current) return;

    setIsScanning(true);
    try {
      await qrCodeInstance.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onScanSuccess(decodedText);
          handleStopCamera();
        },
        () => {},
      );
    } catch (err) {
      console.error("Camera failed:", err);
      setIsScanning(false);
    }
  };

  const handleStopCamera = async () => {
    if (qrCodeInstance.current?.isScanning) {
      await qrCodeInstance.current.stop();
      setIsScanning(false);
    }
  };

  const handleFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !qrCodeInstance.current) return;

    try {
      const decodedText = await qrCodeInstance.current.scanFile(file, true);
      onScanSuccess(decodedText);
    } catch (err) {
      alert("No valid QR code found in this image.");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="rounded-3xl border border-white/5 bg-[#0a0a0a] p-6 shadow-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/20 text-blue-500">
            <QrCode size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">QR Code Scanner</p>
          </div>
        </div>
        {isScanning && (
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1">
            <Zap size={12} className="text-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-500">LIVE</span>
          </div>
        )}
      </div>

      {/* Camera Viewport (Hidden until scanning starts) */}
      <div
        id="reader"
        className={`w-full overflow-hidden rounded-2xl border-2 transition-all duration-500 ${
          isScanning ? "border-blue-500 opacity-100 mb-6" : "border-transparent h-0 opacity-0"
        }`}
      ></div>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-3">
        {!isScanning ? (
          <button
            onClick={handleStartCamera}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-700 py-3 font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Camera size={18} />
            <span>Start Scanning</span>
          </button>
        ) : (
          <button
            onClick={handleStopCamera}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-900/20 py-3 font-bold text-red-500 border border-red-900/50"
          >
            <XCircle size={18} />
            <span>Cancel Scan</span>
          </button>
        )}

        <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 py-3 transition-all hover:bg-white/10 group">
          <input type="file" accept="image/*" className="hidden" onChange={handleFileScan} />
          <ImagePlus size={18} className="text-slate-400 group-hover:text-white" />
          <span className="text-xs font-bold text-slate-400 group-hover:text-white">
            Scan an Image File
          </span>
        </label>
      </div>
    </div>
  );
};

export function PharmacistDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<PharmacistSection>("home");
  const [isLight, setIsLight] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const [stockSearch, setStockSearch] = useState("");
  const [stockStatusFilter, setStockStatusFilter] = useState("ALL");
  const dashboard = usePharmacistDashboard(user?.id, user?.organisationId ?? null);
  const deferredHistorySearch = useDeferredValue(historySearch.trim().toLowerCase());
  const deferredStockSearch = useDeferredValue(stockSearch.trim().toLowerCase());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("theme");
    const light = storedTheme !== "dark";
    document.documentElement.classList.toggle("light", light);
    setIsLight(light);
  }, []);

  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % WELCOME_IMAGES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const next = !isLight;
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("theme", next ? "dark" : "light");
    setIsLight(next);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const selectedPrescription = dashboard.selectedDetail?.prescription ?? null;
  const latestDispenseEvent = dashboard.selectedDetail?.dispensationHistory[0] ?? null;
  const userInitials = getInitials(user?.name);
  const selectedPatientAvatar = getAvatarLetters(selectedPrescription?.patientName);
  const lookupQuery = dashboard.searchQuery.trim();
  const looksLikeDhid = /^dhid-/i.test(lookupQuery);
  const matchedDhidPrescriptions = useMemo(() => {
    if (!looksLikeDhid) {
      return [];
    }

    const normalizedQuery = lookupQuery.toLowerCase();
    return dashboard.filteredPrescriptions.filter(
      (item) => (item.patientDhid ?? "").trim().toLowerCase() === normalizedQuery,
    );
  }, [dashboard.filteredPrescriptions, lookupQuery, looksLikeDhid]);
  const historyStatusOptions = useMemo(
    () => Array.from(new Set(dashboard.history.map((entry) => entry.status))).sort(),
    [dashboard.history],
  );
  const filteredHistory = useMemo(() => {
    return dashboard.history.filter((entry) => {
      const matchesSearch =
        !deferredHistorySearch ||
        [entry.prescriptionId, entry.patientDhid ?? "", entry.patientName ?? "", entry.status]
          .join(" ")
          .toLowerCase()
          .includes(deferredHistorySearch);
      const matchesStatus = historyStatusFilter === "ALL" || entry.status === historyStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [dashboard.history, deferredHistorySearch, historyStatusFilter]);
  const filteredInventory = useMemo(() => {
    return dashboard.inventory.filter((item) => {
      const quantity = item.stockQuantity ?? 0;
      const stockState =
        quantity <= 0 ? "OUT" : quantity <= 25 ? "LOW" : "HEALTHY";
      const matchesSearch =
        !deferredStockSearch ||
        [item.medicineName, item.medicineUnit ?? "", item.id]
          .join(" ")
          .toLowerCase()
          .includes(deferredStockSearch);
      const matchesStatus = stockStatusFilter === "ALL" || stockState === stockStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [dashboard.inventory, deferredStockSearch, stockStatusFilter]);
  const inventoryStats = useMemo(() => {
    const totalItems = dashboard.inventory.length;
    const outOfStockItems = dashboard.inventory.filter((item) => (item.stockQuantity ?? 0) <= 0).length;
    const lowStockItems = dashboard.inventory.filter((item) => {
      const quantity = item.stockQuantity ?? 0;
      return quantity > 0 && quantity <= 25;
    }).length;
    const totalStockValue = dashboard.inventory.reduce(
      (sum, item) => sum + (item.stockQuantity ?? 0) * (item.unitPrice ?? 0),
      0,
    );

    return {
      totalItems,
      lowStockItems,
      outOfStockItems,
      totalStockValue,
    };
  }, [dashboard.inventory]);
  const stockPharmacyName =
    dashboard.inventory[0]?.pharmacyName ??
    selectedPrescription?.sourceName ??
    "Affiliated pharmacy";
  const plannedUnits = useMemo(
    () =>
      dashboard.plannedItems.reduce((sum, { quantityToDispense }) => sum + quantityToDispense, 0),
    [dashboard.plannedItems],
  );
  const unavailableBillingItems = useMemo(
    () =>
      dashboard.plannedItems.filter(
        ({ item, quantityToDispense }) => quantityToDispense > 0 && item.unitPrice === null,
      ),
    [dashboard.plannedItems],
  );
  const partialValidationIssues = useMemo(
    () =>
      dashboard.plannedItems.filter(
        ({ plan, metrics, quantityToDispense }) =>
          plan.action === "PARTIALLY_DISPENSED" &&
          ((metrics.remainingQuantity ?? 0) <= 0 ||
            quantityToDispense <= 0 ||
            quantityToDispense > (metrics.remainingQuantity ?? 0)),
      ),
    [dashboard.plannedItems],
  );
  const dispenseGuardMessage = useMemo(() => {
    if (!selectedPrescription)
      return "Select a live prescription before trying to dispense anything.";
    if (!dashboard.pharmacyId.trim()) return "Enter the pharmacy organisation ID.";
    if (dashboard.unsupportedSelections.length > 0) {
      return "Cancelled and expired item transitions are not supported by the current pharmacist endpoint.";
    }
    if (partialValidationIssues.length > 0) {
      return "One or more partial-dispense lines are invalid. Partial quantity must be above zero and cannot exceed the remaining quantity.";
    }
    if (dashboard.billingItems.length === 0) {
      return "Choose at least one valid line-item action.";
    }
    return null;
  }, [
    dashboard.billingItems.length,
    dashboard.pharmacyId,
    dashboard.unsupportedSelections.length,
    partialValidationIssues.length,
    selectedPrescription,
  ]);

  const headerAlerts = useMemo(() => {
    const items: Array<{
      tone: "error" | "info" | "success";
      title: string;
      description: string;
    }> = [];

    if (dashboard.actionMessage) {
      items.push(getActionAlert(dashboard.actionMessage));
    }

    if (dashboard.error) {
      items.push({
        tone: "error",
        title: "Queue unavailable",
        description: dashboard.error,
      });
    }

    if (dashboard.detailError) {
      items.push({
        tone: "error",
        title: "Prescription detail unavailable",
        description: dashboard.detailError,
      });
    }

    return items;
  }, [dashboard.actionMessage, dashboard.detailError, dashboard.error]);

  const safetyAlerts = useMemo(() => {
    const items: Array<{
      tone: "error" | "info" | "success";
      title: string;
      description: string;
    }> = [];

    if (!dashboard.pharmacyId.trim()) {
      items.push({
        tone: "error",
        title: "Pharmacy ID required",
        description: "Pharmacy organisation ID is required before stock reduction is processed.",
      });
    }

    if (dashboard.unsupportedSelections.length > 0) {
      items.push({
        tone: "error",
        title: "Unsupported item actions selected",
        description:
          "Cancelled and expired status changes are not exposed by the current backend pharmacist endpoint yet.",
      });
    }

    if (latestDispenseEvent) {
      items.push({
        tone: "info",
        title: "Recent dispense activity",
        description: `${latestDispenseEvent.status.replaceAll("_", " ")} recorded on ${formatDateTime(
          latestDispenseEvent.dispensedAt,
        )}.`,
      });
    }

    items.push({
      tone: "success",
      title: "Privacy boundary enforced",
      description:
        "This screen uses DHID, prescription, stock, and billing data only. Diagnosis notes and encounter history stay out of pharmacist hands.",
    });

    return items;
  }, [dashboard.pharmacyId, dashboard.unsupportedSelections.length, latestDispenseEvent]);

  return (
    <div className="min-h-screen bg-surface font-body text-on-background antialiased transition-colors dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sky-200/60 bg-sky-100 px-4 py-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-10 px-6">
          <AppBrandMark subtitle="Verified Pharmacist" />
        </div>

        <nav className="flex-1 space-y-1 px-2">
          {[
            { id: "home" as const, label: "Home", icon: Home },
            { id: "stock" as const, label: "Medicine Stock", icon: Package },
            { id: "dispensing" as const, label: "Prescription Dispensing", icon: Pill },
            { id: "history" as const, label: "Transaction History", icon: History },
          ].map((item) => {
            const Icon = item.icon;
            const active = section === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all",
                  active
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
                    : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800",
                )}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-4">
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-2 text-xs text-slate-500 transition-colors hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <header className="fixed left-64 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-slate-100 bg-white/80 px-8 shadow-sm backdrop-blur-xl transition-colors dark:border-slate-800 dark:bg-slate-950/80">
        <div className="flex items-center">
          <span className="font-headline text-[1.45rem] font-extrabold uppercase tracking-[0.08em] text-blue-900 dark:text-blue-400 sm:text-[1.75rem]">
            National Health Portal
          </span>
        </div>

        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300"
          >
            {isLight ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-200">
                {user?.name ?? "Pharmacist"}
              </p>
              <p className="text-[10px] font-bold uppercase text-primary dark:text-blue-400">
                {user?.role?.replaceAll("_", " ") ?? "PHARMACIST"}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-xs font-bold text-blue-900 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
              {userInitials}
            </div>
          </div>
        </div>
      </header>

      <main className="ml-64 min-h-screen px-8 pb-12 pt-24">
        {section === "home" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 flex flex-col gap-12 pb-16">
            {/* 1. HERO SECTION (Slideshow) */}
            <section className="relative -mx-4 md:-mx-8 -mt-4 md:-mt-8 flex min-h-[65vh] items-center justify-center overflow-hidden shadow-2xl shadow-blue-900/10">
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
                    {/* Overlay Gradient for "Void" feel */}
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-[#050505] backdrop-blur-[1px]" />
                  </div>
                ))}
              </div>

              {/* Content Layer */}
              <div className="relative z-10 max-w-4xl px-6 text-center text-white">
                <span className="mb-4 inline-block rounded-full bg-blue-500/20 px-4 py-1.5 text-xs font-bold tracking-[0.2em] uppercase text-blue-100 backdrop-blur-md border border-blue-400/30">
                  State Pharmacy Dispensing Portal
                </span>
                <h1 className="font-headline text-5xl font-extrabold tracking-tight sm:text-7xl drop-shadow-2xl">
                  Welcome, <span className="text-blue-400">{user?.name}</span>
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-200/90 drop-shadow-md sm:text-xl font-medium">
                  Securely manage prescriptions, track inventory reduction, and coordinate
                  pharmaceutical care across authorized state facilities.
                </p>

                <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
                  <button
                    onClick={() => setSection("dispensing")}
                    className="group flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 font-bold text-white shadow-xl transition-all hover:bg-blue-700 hover:scale-105 active:scale-95"
                  >
                    <Zap className="h-5 w-5" />
                    Start Dispensing
                  </button>
                  <button
                    onClick={() => setSection("history")}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-8 py-4 font-bold text-white backdrop-blur-md transition-all hover:bg-white/20 hover:scale-105 active:scale-95"
                  >
                    <History className="h-5 w-5" />
                    View History
                  </button>
                </div>
              </div>
            </section>

            {/* SECTION: PHARMACY DISPENSING NETWORK */}
            <section className="mt-6 border-t border-slate-100 pt-6 dark:border-white/5">
              <div className="mb-6 flex flex-col items-start gap-4">
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300">
                  <Sparkles size={14} />
                  Dispensing & Inventory Logic
                </span>
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  <span className="text-sky-600 dark:text-sky-400">Streamlined </span>Pharmacy
                  Operations.
                </h2>
                <p className="max-w-2xl text-slate-500 dark:text-slate-400 text-sm md:text-base">
                  MediConnect connects digital prescriptions directly with pharmacy workflows.
                  Monitor medicine inventory in real time, process prescriptions efficiently, and
                  maintain secure dispensing records with complete traceability.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {[
                  {
                    title: "Smart Prescription Queue",
                    desc: "Receive prescriptions instantly from doctors and prepare medications before patients arrive for faster dispensing.",
                    icon: Zap,
                    color: "blue",
                  },
                  {
                    title: "Inventory Monitoring",
                    desc: "Track medicine availability in real time, manage low-stock alerts, and reduce dispensing delays across the pharmacy.",
                    icon: BarChart3,
                    color: "emerald",
                  },
                  {
                    title: "Secure Dispensing Records",
                    desc: "Every prescription and medication issue is securely logged under the patient’s Digital Health ID for safe and traceable care.",
                    icon: ClipboardCheck,
                    color: "blue",
                  },
                ].map((feature, i) => (
                  <article
                    key={i}
                    className="group relative overflow-hidden rounded-[2rem] border border-sky-200/50 bg-white p-8 transition-all hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900/90"
                  >
                    <div className="relative z-10">
                      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm transition-transform group-hover:scale-110 dark:bg-sky-900/30 dark:text-sky-400">
                        <feature.icon size={28} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {feature.desc}
                      </p>
                    </div>

                    {/* Subtle right-aligned glow to match your "effectful" gradient style */}
                    <div className="absolute inset-y-0 right-0 w-32 bg-[radial-gradient(circle_at_right,_rgba(14,165,233,0.1),_transparent_80%)]" />
                  </article>
                ))}
              </div>

              {/* Inventory Metrics Banner */}
              <div className="mt-10 rounded-[2.5rem] bg-sky-600 p-1 dark:bg-sky-500/10">
                <div className="flex flex-col items-center justify-between gap-6 rounded-[2.3rem] bg-white px-10 py-6 dark:bg-[#050505] md:flex-row">
                  <div className="flex items-center gap-6">
                    <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 md:flex">
                      <Package size={20} />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-slate-900 dark:text-white">
                        Unified Inventory Backbone
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Your facility is currently connected to the National State Pharmacy
                        registry.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. OPERATIONAL STATUS STATS */}
            <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="group relative overflow-hidden rounded-3xl border border-blue-100/10 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:bg-white/5">
                <div className="flex items-center gap-4">
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">Security Status</p>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Encrypted Session
                    </h3>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                  System Verified & Active
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-3xl border border-emerald-100/10 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:bg-white/5">
                <div className="flex items-center gap-4">
                  <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <Pill className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">Today's Volume</p>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {dashboard.stats.dispensedToday} Handled
                    </h3>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                  <Activity className="h-4 w-4" /> Queue Moving Efficiently
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-3xl border border-amber-100/10 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:bg-white/5">
                <div className="flex items-center gap-4">
                  <div className="rounded-2xl bg-amber-50 p-3 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <RefreshCcw className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">Awaiting Action</p>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {dashboard.stats.pendingPrescriptions} Pending
                    </h3>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-amber-600 uppercase tracking-widest">
                  Ready for Verification
                </div>
              </div>
            </section>

            {/* 3. QUICK ACTIONS GRID */}
            <section>
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                  Pharmacy Quick Actions
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
                {[
                  { label: "Dispensing Lane", icon: Pill, color: "blue", target: "dispensing" },
                  { label: "Audit Logs", icon: History, color: "emerald", target: "history" },
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={() => setSection(action.target as PharmacistSection)}
                    className="flex flex-col items-center gap-4 rounded-3xl border border-slate-100 bg-white p-6 transition-all hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg dark:border-white/5 dark:bg-[#0a0a0a]"
                  >
                    <div
                      className={`rounded-2xl bg-${action.color}-50 p-4 text-${action.color}-600 dark:bg-${action.color}-500/10 dark:text-${action.color}-400`}
                    >
                      <action.icon className="h-6 w-6" />
                    </div>
                    <span className="font-bold text-slate-700 dark:text-slate-200 text-sm text-center">
                      {action.label}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* 4. FACILITY CONNECT BANNER */}
            <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-slate-900 to-blue-900 p-10 text-white shadow-xl shadow-blue-900/20">
              <div className="relative z-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                <div className="max-w-md">
                  <h2 className="text-3xl font-bold">State Hospital Network</h2>
                  <p className="mt-2 text-blue-100/80 font-medium text-sm">
                    You are currently authenticated at{" "}
                    <span className="text-blue-300 font-bold">National Hospital Sri Lanka</span>.
                    All dispensed items are logged directly to the central healthcare backbone.
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-md">
                  <ShieldCheck className="text-blue-400" />
                </div>
              </div>
              {/* Abstract medical design elements */}
              <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
              <div className="absolute -bottom-20 left-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
            </section>
          </div>
        )}
        {section === "dispensing" ? (
          <div className="transition-opacity duration-300">
            <div className="mb-10 grid gap-8 xl:grid-cols-[minmax(0,1fr),320px] xl:items-start">
              <div>
                <div className="mb-6 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
                    <ShieldCheck size={14} />
                    Live pharmacist workflow
                  </span>
                  <button
                    type="button"
                    onClick={() => void dashboard.refresh()}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCcw size={16} />
                    Refresh
                  </button>
                </div>

                <h1 className="text-3xl font-extrabold tracking-tight">Prescription Dispensing</h1>
                <p className="mb-6 mt-2 text-slate-500 dark:text-slate-400">
                  Enter a Digital Health ID or prescription ID to fetch live authorised prescriptions
                  and process dispensing safely.
                </p>

                <div className="grid gap-4 lg:grid-cols-[1.35fr,0.65fr]">
                  <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          DHID / Prescription Lookup
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Paste a `DHID-XXXX-XXXX` or a prescription ID from the live queue.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-2 dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
                      <div className="relative flex-1">
                        <Fingerprint
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                          size={18}
                        />
                        <input
                          value={dashboard.searchQuery}
                          onChange={(event) => dashboard.setSearchQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              dashboard.lookupPrescription();
                            }
                          }}
                          className="w-full rounded-xl border-none bg-transparent py-3.5 pl-12 pr-4 font-mono text-sm placeholder:text-slate-400 focus:ring-0 dark:text-white"
                          placeholder="DHID-XXXX-XXXX or prescription ID"
                          type="text"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => dashboard.lookupPrescription()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-3 text-sm font-bold text-white transition-all hover:brightness-110 dark:bg-blue-600"
                      >
                        <ScanLine size={18} />
                        Verify & Lookup
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-xs">
                      <span className="rounded-full bg-blue-50 px-3 py-1 font-bold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                        {looksLikeDhid ? "Lookup mode: DHID" : "Lookup mode: Queue / prescription ID"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <QrScannerLane
                      onScanSuccess={(decodedText) => {
                        const normalizedLookupValue = extractLookupValueFromScan(decodedText);
                        dashboard.setSearchQuery(normalizedLookupValue);
                        dashboard.lookupPrescription(normalizedLookupValue);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                    Dispensed Today
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">{dashboard.stats.dispensedToday}</p>
                </div>
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                    Total Bill Value
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {formatLkr(dashboard.stats.totalBilledToday)}
                  </p>
                </div>
              </div>
            </div>

            {headerAlerts.length > 0 ? (
              <div className="mb-8 space-y-3">
                {headerAlerts.map((alert) => (
                  <div
                    key={`${alert.title}-${alert.description}`}
                    className={cn(
                      "rounded-2xl border px-4 py-3 text-sm",
                      noticeClassName(alert.tone),
                    )}
                  >
                    <p className="font-bold">{alert.title}</p>
                    <p className="mt-1">{alert.description}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-12 space-y-8 lg:col-span-8">
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {dashboard.isLoadingDetail ? (
                    <div className="flex min-h-[180px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                      Loading selected prescription detail...
                    </div>
                  ) : selectedPrescription ? (
                    <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
                      <div className="flex items-center gap-6">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-lg font-extrabold uppercase text-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
                          {selectedPatientAvatar}
                        </div>
                        <div>
                          <div className="mb-1 flex flex-wrap items-center gap-3">
                            <h2 className="font-headline text-xl font-bold">
                              {selectedPrescription.patientName ?? "Identity hidden by backend"}
                            </h2>
                            <PrescriptionStatusBadge status={selectedPrescription.status} />
                            {selectedPrescription.signatureValid !== null &&
                            selectedPrescription.signatureValid !== undefined ? (
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary dark:border-blue-500/30 dark:bg-blue-900/30 dark:text-blue-300">
                                {selectedPrescription.signatureValid
                                  ? "Digital signature valid"
                                  : "Signature requires review"}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            DHID: {selectedPrescription.patientDhid ?? "Not supplied"}
                          </div>
                        </div>
                      </div>

                      <div className="text-left xl:text-right">
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          Prescription source
                        </p>
                        <p className="text-sm font-bold">
                          {selectedPrescription.sourceName ?? "Organisation unavailable"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {selectedPrescription.doctorName ?? "Doctor not provided"}
                        </p>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Issued{" "}
                          {selectedPrescription.issuedAt
                            ? formatDate(selectedPrescription.issuedAt)
                            : "Unknown date"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                      <Search className="mb-4 text-slate-300 dark:text-slate-700" size={42} />
                      <h2 className="text-lg font-bold">No prescription selected</h2>
                      <p className="mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                        Search with a DHID or prescription ID and pick a live result from the
                        backend queue first.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
                        Valid Active Prescriptions
                      </h3>
                    </div>
                    {looksLikeDhid ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {matchedDhidPrescriptions.length} valid result(s)
                      </span>
                    ) : null}
                  </div>

                  {!looksLikeDhid ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      DHID ekak enter karama me thanata e patientge valid active prescriptions witharai pennanawa.
                    </div>
                  ) : dashboard.isLoadingList ? (
                    <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Loading valid prescriptions...
                    </div>
                  ) : matchedDhidPrescriptions.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {matchedDhidPrescriptions.map((result) => {
                        const active = result.id === dashboard.selectedPrescriptionId;
                        return (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => dashboard.setSelectedPrescriptionId(result.id)}
                            className={cn(
                              "rounded-2xl border p-4 text-left transition-all",
                              active
                                ? "border-blue-300 bg-blue-50 shadow-sm dark:border-blue-700 dark:bg-blue-950/30"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900",
                            )}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">
                                {result.patientName ?? result.patientDhid ?? "Patient"}
                              </p>
                              <PrescriptionStatusBadge status={result.status} />
                            </div>
                            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                              <p>Doctor: {result.doctorName ?? "Not provided"}</p>
                              <p>Hospital: {result.sourceName ?? "Organisation unavailable"}</p>
                              <p>
                                Encounter type: {result.encounterType ?? "Not provided"}
                              </p>
                              <p>Items: {result.totalItems ?? 0}</p>
                              <p>Issued: {result.issuedAt ? formatDate(result.issuedAt) : "Unknown"}</p>
                              <p>Valid until: {result.expiresAt ? formatDate(result.expiresAt) : "No expiry set"}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      Me DHID ekata valid period eka athule active prescriptions hambune na.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-500">
                        <Pill className="text-primary dark:text-blue-400" size={18} />
                        Prescription Items
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Item data from the selected prescription.
                      </p>
                    </div>
                  </div>

                  {selectedPrescription && dashboard.selectedDetail ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                          <tr>
                            <th className="px-6 py-3">Medicine & Dosage</th>
                            <th className="px-6 py-3">Quantity</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3 text-right">Status Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dashboard.plannedItems.map(
                            ({
                              item,
                              plan,
                              metrics,
                              quantityToDispense,
                              previewDispensedQuantity,
                              previewRemainingQuantity,
                            }) => {
                              const isOutOfStock =
                                item.availabilityMessage ===
                                  "This medicine is not stocked in your pharmacy." ||
                                (item.pharmacyStock !== null && item.pharmacyStock <= 0);

                              return (
                            <tr
                              key={item.id}
                              className="align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30"
                            >
                              <td className="px-6 py-5">
                                <p className="font-bold text-blue-900 dark:text-blue-300">
                                  {item.medicineName}
                                </p>
                                <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                                  {formatDosagePerDay(item.dosage, item.unit)}
                                </p>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  {formatPrescriptionInstructionSummary(
                                    item.instructions,
                                    item.unit,
                                  )}
                                </p>
                                <div className="mt-2 space-y-1 text-xs">
                                  {item.unitPrice !== null ? (
                                    <p className="text-emerald-700 dark:text-emerald-300">
                                      {`Price locked: ${formatLkr(item.unitPrice)}${item.catalogUnit ? ` per ${item.catalogUnit}` : ""}`}
                                    </p>
                                  ) : null}
                                  <p
                                    className={
                                      item.availabilityMessage ===
                                      "This medicine is not stocked in your pharmacy."
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-slate-500 dark:text-slate-400"
                                    }
                                  >
                                    {item.availabilityMessage ?? "Availability not confirmed yet."}
                                    {item.pharmacyStock !== null
                                      ? ` Stock on hand: ${item.pharmacyStock}.`
                                      : ""}
                                  </p>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {metrics.remainingQuantity !== null &&
                                  metrics.remainingQuantity <= 0 ? (
                                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                      Fully dispensed already
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-1 text-sm">
                                  <p className="font-bold">
                                    Prescribed: {metrics.prescribedQuantity ?? "N/A"} {metrics.quantityLabel}
                                  </p>
                                  <p className="text-slate-500 dark:text-slate-400">
                                    Dispensed so far: {previewDispensedQuantity} {metrics.quantityLabel}
                                  </p>
                                  <p
                                    className={cn(
                                      "font-medium",
                                      (previewRemainingQuantity ?? 0) > 0
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-emerald-600 dark:text-emerald-400",
                                    )}
                                  >
                                    Remaining: {previewRemainingQuantity ?? "Unknown"} {metrics.quantityLabel}
                                  </p>
                                  {metrics.unitKind === "ml" || metrics.unitKind === "drops" ? (
                                    <p className="text-slate-500 dark:text-slate-400">
                                      {metrics.dailyDose && metrics.durationDays
                                        ? `${metrics.dailyDose} ${item.unit ?? metrics.unitKind} x ${metrics.durationDays} day(s)${
                                            metrics.unitKind === "drops" ? " (20 drops = 1 mL)" : ""
                                          }${
                                            metrics.packageCapacity
                                              ? ` -> ${metrics.quantityLabel} from ${metrics.packageCapacity} capacity`
                                              : ""
                                          }`
                                        : "Bottle count follows dosage x duration."}
                                    </p>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-2 text-xs">
                                  <p className="rounded-xl bg-slate-100 px-3 py-2 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {formatStatusLabel(plan.action)}
                                  </p>
                                  {quantityToDispense > 0 ? (
                                    <p className="text-slate-500 dark:text-slate-400">
                                      {`${quantityToDispense} ${metrics.quantityLabel} will be sent in this request.`}
                                    </p>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex flex-col items-stretch gap-3 md:items-end">
                                  <select
                                    value={plan.action}
                                    disabled={isOutOfStock || (metrics.remainingQuantity ?? 0) <= 0}
                                    onChange={(event) =>
                                      dashboard.updatePlanAction(
                                        item.id,
                                        event.target.value as
                                          | "ISSUED"
                                          | "PARTIALLY_DISPENSED"
                                          | "DISPENSED",
                                      )
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-500"
                                  >
                                    <option value="DISPENSED">
                                      {formatStatusActionLabel("DISPENSED")}
                                    </option>
                                    <option value="PARTIALLY_DISPENSED">
                                      {formatStatusActionLabel("PARTIALLY_DISPENSED")}
                                    </option>
                                    <option value="ISSUED">
                                      {formatStatusActionLabel("ISSUED")}
                                    </option>
                                  </select>

                                  {plan.action === "PARTIALLY_DISPENSED" &&
                                  !isOutOfStock &&
                                  (metrics.remainingQuantity ?? 0) > 0 ? (
                                    <label className="block w-full md:w-36">
                                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Dispense now
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        max={metrics.remainingQuantity ?? undefined}
                                        value={plan.quantity}
                                        onChange={(event) =>
                                          dashboard.updatePlanQuantity(
                                            item.id,
                                            Number(event.target.value),
                                          )
                                        }
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-500"
                                      />
                                    </label>
                                  ) : null}

                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    This action dispenses{" "}
                                    <span className="font-bold text-slate-800 dark:text-slate-200">
                                      {quantityToDispense}
                                    </span>{" "}
                                    {metrics.quantityLabel} now.
                                  </p>
                                  {plan.action === "PARTIALLY_DISPENSED" &&
                                  quantityToDispense >= (metrics.remainingQuantity ?? 0) &&
                                  (metrics.remainingQuantity ?? 0) > 0 ? (
                                    <p className="max-w-[220px] text-right text-xs text-amber-700 dark:text-amber-300">
                                      This equals the full remaining quantity. If you are issuing
                                      everything, switch the line to{" "}
                                      <span className="font-bold">DISPENSED</span>.
                                    </p>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                              );
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                      Search and select a live prescription first to view medicine lines.
                    </div>
                  )}
                </div>
              </div>

              <div className="col-span-12 space-y-6 lg:col-span-4">
                <div className="relative overflow-hidden rounded-2xl border border-slate-900 bg-blue-900 p-8 text-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                  <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/5 blur-xl" />
                  <h3 className="mb-6 flex items-center gap-2 text-lg font-bold">
                    <ShieldCheck className="text-cyan-300" size={20} />
                    Billing Summary
                  </h3>

                  <div className="mb-8 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/70">
                          Items
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">
                          {dashboard.billingItems.length}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/70">
                          Quantity
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{plannedUnits}</p>
                      </div>
                    </div>

                    {dashboard.billingItems.length > 0 ? (
                      dashboard.billingItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between gap-3 text-sm text-white/80"
                        >
                          <span>
                            {item.name} ({item.quantity} {item.quantityLabel} x {item.unitPrice.toFixed(2)})
                          </span>
                          <span className="font-bold">{item.total.toFixed(2)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-blue-100/75">
                        No dispense quantities selected yet. Choose line-item actions and the bill
                        updates live.
                      </p>
                    )}

                    {unavailableBillingItems.length > 0 ? (
                      <div className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        {unavailableBillingItems.map(({ item }) => (
                          <p key={item.id}>
                            {item.medicineName}:{" "}
                            {item.availabilityMessage ??
                              "Not available in this pharmacy, so it stays out of the bill."}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex items-end justify-between border-t border-white/10 pt-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase opacity-60">Total LKR</p>
                        <p className="font-headline text-3xl font-extrabold">
                          {dashboard.billingTotal !== null
                            ? dashboard.billingTotal.toFixed(2)
                            : "0.00"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {dispenseGuardMessage ? (
                    <div className="mb-5 rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                      {dispenseGuardMessage}
                    </div>
                  ) : (
                    <div className="mb-5 rounded-2xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                      Select Complete Dispense to Finish Prescription Handling.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void dashboard.dispenseSelected()}
                    disabled={dashboard.isDispensing || Boolean(dispenseGuardMessage)}
                    className="w-full rounded-xl bg-cyan-500 py-4 text-sm font-extrabold text-blue-950 shadow-lg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {dashboard.isDispensing ? "PROCESSING..." : "COMPLETE DISPENSE"}
                  </button>
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-6 dark:border-slate-800 dark:bg-slate-900">
                  <h4 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    Safety Protocol Alerts
                  </h4>
                  <div className="space-y-4">
                    {safetyAlerts.map((alert) => (
                      <div
                        key={`${alert.title}-${alert.description}`}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-3",
                          alert.tone === "error" &&
                            "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20",
                          alert.tone === "success" &&
                            "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20",
                          alert.tone === "info" &&
                            "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50",
                        )}
                      >
                        {alert.tone === "error" ? (
                          <ShieldAlert
                            className="shrink-0 text-red-600 dark:text-red-400"
                            size={18}
                          />
                        ) : alert.tone === "success" ? (
                          <ShieldCheck
                            className="shrink-0 text-emerald-600 dark:text-emerald-400"
                            size={18}
                          />
                        ) : (
                          <Info className="shrink-0 text-primary dark:text-blue-400" size={18} />
                        )}
                        <div>
                          <p
                            className={cn(
                              "text-xs font-bold",
                              alert.tone === "error" && "text-red-800 dark:text-red-300",
                              alert.tone === "success" && "text-emerald-800 dark:text-emerald-300",
                              alert.tone === "info" && "text-slate-900 dark:text-slate-200",
                            )}
                          >
                            {alert.title}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-[11px]",
                              alert.tone === "error" && "text-red-700/90 dark:text-red-300/80",
                              alert.tone === "success" &&
                                "text-emerald-700/90 dark:text-emerald-300/80",
                              alert.tone === "info" && "text-slate-500 dark:text-slate-400",
                            )}
                          >
                            {alert.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {section === "stock" ? (
          <div className="transition-opacity duration-300">
            <header className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Medicine Stock</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Pharmacy: <span className="font-semibold text-slate-800 dark:text-slate-200">{stockPharmacyName}</span>
                  {" • "}ID:{" "}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {dashboard.pharmacyId || "Not set"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void dashboard.refresh()}
                className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCcw size={16} />
                Refresh stock
              </button>
            </header>

            <div className="mb-6 grid gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Medicines listed
                </p>
                <p className="mt-3 text-3xl font-extrabold">{inventoryStats.totalItems}</p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Low stock
                </p>
                <p className="mt-3 text-3xl font-extrabold text-amber-600 dark:text-amber-300">
                  {inventoryStats.lowStockItems}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Out of stock
                </p>
                <p className="mt-3 text-3xl font-extrabold text-red-600 dark:text-red-300">
                  {inventoryStats.outOfStockItems}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Visible stock value
                </p>
                <p className="mt-3 text-2xl font-extrabold">{formatLkr(inventoryStats.totalStockValue)}</p>
              </div>
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr]">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Search medicine
                </label>
                <div className="relative mt-2">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                  />
                  <input
                    value={stockSearch}
                    onChange={(event) => setStockSearch(event.target.value)}
                    placeholder="Medicine name, unit, row ID"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    type="text"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Stock filter
                </label>
                <select
                  value={stockStatusFilter}
                  onChange={(event) => setStockStatusFilter(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="ALL">All stock states</option>
                  <option value="HEALTHY">Healthy</option>
                  <option value="LOW">Low stock</option>
                  <option value="OUT">Out of stock</option>
                </select>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Visible rows
                </p>
                <p className="mt-3 text-3xl font-extrabold">{filteredInventory.length}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Filtered from your pharmacy inventory only
                </p>
              </div>
            </div>

            {dashboard.inventoryError ? (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {dashboard.inventoryError}
              </div>
            ) : null}

            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {dashboard.isLoadingInventory ? (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  Loading live inventory rows...
                </div>
              ) : filteredInventory.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <Package className="mb-4 text-slate-300 dark:text-slate-700" size={52} />
                  <p className="font-medium text-slate-400">
                    {dashboard.inventory.length === 0
                      ? "No inventory rows were returned for this pharmacy yet."
                      : "No medicines matched the current stock search and filters."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-4 font-semibold">Medicine</th>
                        <th className="px-6 py-4 font-semibold">Unit</th>
                        <th className="px-6 py-4 font-semibold">Stock</th>
                        <th className="px-6 py-4 font-semibold">Unit Price</th>
                        <th className="px-6 py-4 font-semibold">Status</th>
                        <th className="px-6 py-4 font-semibold">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredInventory.map((item) => {
                        const quantity = item.stockQuantity ?? 0;
                        const isOut = quantity <= 0;
                        const isLow = quantity > 0 && quantity <= 25;

                        return (
                          <tr
                            key={item.id}
                            className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-6 py-4">
                              <p className="font-bold">{item.medicineName}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Row ID {item.id}
                              </p>
                            </td>
                            <td className="px-6 py-4">{item.medicineUnit ?? "Not set"}</td>
                            <td className="px-6 py-4 font-semibold">{quantity}</td>
                            <td className="px-6 py-4">{formatLkr(item.unitPrice)}</td>
                            <td className="px-6 py-4">
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-3 py-1 text-xs font-bold",
                                  isOut &&
                                    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
                                  !isOut &&
                                    isLow &&
                                    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                                  !isOut &&
                                    !isLow &&
                                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                                )}
                              >
                                {isOut ? "Out of stock" : isLow ? "Low stock" : "Healthy"}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                              {formatDateTime(item.updatedAt ?? item.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {section === "history" ? (
          <div className="transition-opacity duration-300">
            <header className="mb-8">
              <h1 className="text-3xl font-extrabold tracking-tight">Operational History</h1>
              <p className="mt-2 text-slate-500 dark:text-slate-400">
                Recent backend dispense events processed under your pharmacist identity.
              </p>
            </header>

            <div className="mb-6 grid gap-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr]">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Search history
                </label>
                <div className="relative mt-2">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                  />
                  <input
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="Prescription ID, DHID, status"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    type="text"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Status filter
                </label>
                <select
                  value={historyStatusFilter}
                  onChange={(event) => setHistoryStatusFilter(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="ALL">All statuses</option>
                  {historyStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Visible events
                </p>
                <p className="mt-3 text-3xl font-extrabold">{filteredHistory.length}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Filtered from live dispense history only
                </p>
              </div>
            </div>

            {dashboard.historyError ? (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {dashboard.historyError}
              </div>
            ) : null}

            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {dashboard.isLoadingHistory ? (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  Loading live dispense history...
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <History className="mb-4 text-slate-300 dark:text-slate-700" size={52} />
                  <p className="font-medium text-slate-400">
                    {dashboard.history.length === 0
                      ? "No dispense events recorded yet for this pharmacist."
                      : "No dispense events matched the current search and filters."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-4 font-semibold">Timestamp</th>
                        <th className="px-6 py-4 font-semibold">Prescription</th>
                        <th className="px-6 py-4 font-semibold">Patient DHID</th>
                        <th className="px-6 py-4 font-semibold">Items</th>
                        <th className="px-6 py-4 font-semibold">Value</th>
                        <th className="px-6 py-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredHistory.map((entry) => (
                        <tr
                          key={entry.id}
                          className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-6 py-4 font-mono text-xs">
                            {formatDateTime(entry.dispensedAt)}
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold">{entry.prescriptionId}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {entry.patientName ?? "Patient name unavailable"}
                            </p>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">
                            {entry.patientDhid ?? "Not supplied"}
                          </td>
                          <td className="px-6 py-4">{entry.itemCount ?? "N/A"}</td>
                          <td className="px-6 py-4">{formatLkr(entry.estimatedTotal)}</td>
                          <td className="px-6 py-4">
                            <PrescriptionStatusBadge status={entry.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

      <footer className="ml-64 border-t border-slate-100 bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-8 py-12 text-xs uppercase tracking-widest text-slate-500 md:flex-row">
          <p className="font-bold">© 2026 National Health Ministry</p>
        </div>
      </footer>
    </div>
  );
}
