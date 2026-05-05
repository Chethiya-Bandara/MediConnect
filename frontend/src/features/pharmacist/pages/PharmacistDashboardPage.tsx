import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Fingerprint,
  HeartPulse,
  History,
  Info,
  LogOut,
  Moon,
  Pill,
  QrCode,
  RefreshCcw,
  ScanLine,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBrandMark } from "../../../components/ui";
import { cn } from "../../../lib/utils/cn";
import { formatDate } from "../../../lib/utils/formatDate";
import { useAuth } from "../../auth/context/AuthContext";
import { PrescriptionStatusBadge } from "../components/PrescriptionStatusBadge";
import { usePharmacistDashboard } from "../hooks/usePharmacistDashboard";
import type { PharmacistSection } from "../types";

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

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ");
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

export function PharmacistDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<PharmacistSection>("dispensing");
  const [isDark, setIsDark] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const dashboard = usePharmacistDashboard(user?.id, user?.organisationId ?? null);
  const deferredHistorySearch = useDeferredValue(historySearch.trim().toLowerCase());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("theme");
    const dark = storedTheme !== "light";
    document.documentElement.classList.toggle("dark", dark);
    setIsDark(dark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const selectedPrescription = dashboard.selectedDetail?.prescription ?? null;
  const latestDispenseEvent = dashboard.selectedDetail?.dispensationHistory[0] ?? null;
  const userInitials = getInitials(user?.name);
  const lookupQuery = dashboard.searchQuery.trim();
  const looksLikeDhid = /^dhid-/i.test(lookupQuery);
  const quickLookupResults = useMemo(
    () => dashboard.filteredPrescriptions.slice(0, 6),
    [dashboard.filteredPrescriptions],
  );
  const historyStatusOptions = useMemo(
    () => Array.from(new Set(dashboard.history.map((entry) => entry.status))).sort(),
    [dashboard.history],
  );
  const filteredHistory = useMemo(() => {
    return dashboard.history.filter((entry) => {
      const matchesSearch = !deferredHistorySearch
        || [
          entry.prescriptionId,
          entry.patientDhid ?? "",
          entry.patientName ?? "",
          entry.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(deferredHistorySearch);
      const matchesStatus = historyStatusFilter === "ALL" || entry.status === historyStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [dashboard.history, deferredHistorySearch, historyStatusFilter]);
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
        ({ item, plan, quantityToDispense }) =>
          plan.action === "PARTIALLY_DISPENSED"
          && ((item.remainingQuantity ?? 0) <= 0 || quantityToDispense <= 0 || quantityToDispense >= (item.remainingQuantity ?? 0)),
      ),
    [dashboard.plannedItems],
  );
  const dispenseGuardMessage = useMemo(() => {
    if (!selectedPrescription) return "Select a live prescription before trying to dispense anything.";
    if (!dashboard.pharmacyId.trim()) return "Enter the pharmacy organisation ID before the backend will accept a dispense request.";
    if (dashboard.unsupportedSelections.length > 0) {
      return "Cancelled and expired item transitions are not supported by the current pharmacist endpoint.";
    }
    if (partialValidationIssues.length > 0) {
      return "One or more partial-dispense lines are invalid. Partial quantity must be lower than the remaining quantity and above zero.";
    }
    if (dashboard.billingItems.length === 0) {
      return "Choose at least one valid line-item action so the bill and dispense payload are real.";
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
      items.push({
        tone: dashboard.actionMessage.toLowerCase().includes("successful")
          ? "success"
          : "error",
        title: dashboard.actionMessage.toLowerCase().includes("successful")
          ? "Dispense update"
          : "Action response",
        description: dashboard.actionMessage,
      });
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
        description:
          "Current backend dispense endpoint needs the pharmacy organisation ID before it will process stock reduction.",
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
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-100 bg-slate-50 py-6 transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-10 px-6">
          <AppBrandMark subtitle="Verified Pharmacist" />
        </div>

        <nav className="flex-1 space-y-1 px-2">
          {[
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
          <span className="font-headline text-xl font-extrabold tracking-tight text-blue-900 dark:text-blue-400">
            National Health Portal
          </span>
        </div>

        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
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
        {section === "dispensing" ? (
          <div className="transition-opacity duration-300">
            <div className="mb-10 max-w-3xl">
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
                Enter a Digital Health ID or prescription ID to fetch live authorised prescriptions and process dispensing safely.
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
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {dashboard.filteredPrescriptions.length} live match{dashboard.filteredPrescriptions.length === 1 ? "" : "es"}
                    </span>
                  </div>

                  <div className="flex flex-col gap-4 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-2 dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
                    <div className="relative flex-1">
                      <Fingerprint className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
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
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Privacy boundary: no diagnosis or encounter notes exposed
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-800">
                      <QrCode size={22} />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                        Scan-ready lane
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Browser camera scanning is not available yet, so use a scanned DHID or prescription ID from your verified workflow.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-950">
                    <QrCode className="mx-auto mb-3 text-slate-300 dark:text-slate-700" size={42} />
                    <p className="text-sm font-semibold">Scan lane reserved</p>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      For now, scan the patient QR outside the browser and paste the verified DHID here.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {headerAlerts.length > 0 ? (
              <div className="mb-8 space-y-3">
                {headerAlerts.map((alert) => (
                  <div
                    key={`${alert.title}-${alert.description}`}
                    className={cn("rounded-2xl border px-4 py-3 text-sm", noticeClassName(alert.tone))}
                  >
                    <p className="font-bold">{alert.title}</p>
                    <p className="mt-1">{alert.description}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-12 space-y-8 lg:col-span-8">
                <div className="flex flex-wrap gap-4">
                  <div className="min-w-[180px] rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Active Queue</p>
                    <p className="mt-3 text-3xl font-extrabold">{dashboard.stats.pendingPrescriptions}</p>
                  </div>
                  <div className="min-w-[180px] rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Dispensed Today</p>
                    <p className="mt-3 text-3xl font-extrabold">{dashboard.stats.dispensedToday}</p>
                  </div>
                  <div className="min-w-[220px] rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Estimated Queue Value</p>
                    <p className="mt-3 text-3xl font-extrabold">{formatLkr(dashboard.stats.estimatedValue)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
                        Live Queue Matches
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Pick the exact prescription before dispensing so the selected queue item matches the live backend record.
                      </p>
                    </div>
                    {lookupQuery ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Query: {lookupQuery}
                      </span>
                    ) : null}
                  </div>

                  {dashboard.isLoadingList ? (
                    <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Refreshing pharmacist queue...
                    </div>
                  ) : quickLookupResults.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {quickLookupResults.map((result) => {
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
                              <p className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                {result.id}
                              </p>
                              <PrescriptionStatusBadge status={result.status} />
                            </div>
                            <p className="font-semibold">
                              {result.patientDhid ?? "DHID not supplied"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {result.totalItems ?? 0} item(s) • issued {result.issuedAt ? formatDate(result.issuedAt) : "unknown"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      {lookupQuery
                        ? "Nothing in the live queue matched that DHID or prescription id."
                        : "Type a DHID or prescription ID to surface live queue matches."}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {dashboard.isLoadingDetail ? (
                    <div className="flex min-h-[180px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                      Loading selected prescription detail...
                    </div>
                  ) : selectedPrescription ? (
                    <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
                      <div className="flex items-center gap-6">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/20">
                          <HeartPulse className="text-primary dark:text-blue-400" size={28} />
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
                          Issued {selectedPrescription.issuedAt ? formatDate(selectedPrescription.issuedAt) : "Unknown date"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                      <Search className="mb-4 text-slate-300 dark:text-slate-700" size={42} />
                      <h2 className="text-lg font-bold">No prescription selected</h2>
                      <p className="mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                        Search with a DHID or prescription ID and pick a live result from the backend queue first.
                      </p>
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
                        Live item data from the backend with dispense actions mapped to the real endpoint.
                      </p>
                    </div>
                    {dashboard.isLoadingList ? (
                      <span className="text-sm text-slate-500 dark:text-slate-400">Loading queue...</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {dashboard.filteredPrescriptions.length} results in queue
                      </span>
                    )}
                  </div>

                  {selectedPrescription && dashboard.selectedDetail ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                          <tr>
                            <th className="px-6 py-3">Medicine & Dosage</th>
                            <th className="px-6 py-3">Quantity</th>
                            <th className="px-6 py-3">Transition</th>
                            <th className="px-6 py-3 text-right">Status Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dashboard.plannedItems.map(({ item, plan, quantityToDispense }) => (
                            <tr key={item.id} className="align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                              <td className="px-6 py-5">
                                <p className="font-bold text-blue-900 dark:text-blue-300">{item.medicineName}</p>
                                <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                                  {item.dosage ?? "Dosage not supplied"}
                                </p>
                                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {item.instructions ?? "No extra instructions from backend."}
                                  </p>
                                  <div className="mt-2 space-y-1 text-xs">
                                    <p className={item.unitPrice !== null ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                                      {item.unitPrice !== null
                                        ? `Price locked: ${formatLkr(item.unitPrice)}${item.catalogUnit ? ` per ${item.catalogUnit}` : ""}`
                                        : "Not billable from this pharmacy right now"}
                                    </p>
                                    <p className="text-slate-500 dark:text-slate-400">
                                      {item.availabilityMessage ?? "Availability not confirmed yet."}
                                      {item.pharmacyStock !== null ? ` Stock on hand: ${item.pharmacyStock}.` : ""}
                                    </p>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                      Current: {formatStatusLabel(selectedPrescription.status)}
                                    </span>
                                    {item.remainingQuantity !== null && item.remainingQuantity <= 0 ? (
                                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                        Fully dispensed already
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                              <td className="px-6 py-5">
                                <div className="space-y-1 text-sm">
                                  <p className="font-bold">Prescribed: {item.quantity ?? "N/A"} units</p>
                                  <p className="text-slate-500 dark:text-slate-400">Dispensed so far: {item.dispensedQuantity}</p>
                                  <p
                                    className={cn(
                                      "font-medium",
                                      (item.remainingQuantity ?? 0) > 0
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-emerald-600 dark:text-emerald-400",
                                    )}
                                  >
                                    Remaining: {item.remainingQuantity ?? "Unknown"}
                                  </p>
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-2 text-xs">
                                  <p className="font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Planned result
                                  </p>
                                  <p className="rounded-xl bg-slate-100 px-3 py-2 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {formatStatusLabel(plan.action)}
                                  </p>
                                  <p className="text-slate-500 dark:text-slate-400">
                                    {quantityToDispense > 0
                                      ? `${quantityToDispense} unit(s) will be sent in this request.`
                                      : "No units will be sent with the current action."}
                                  </p>
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex flex-col items-stretch gap-3 md:items-end">
                                  <select
                                    value={plan.action}
                                    disabled={(item.remainingQuantity ?? 0) <= 0}
                                    onChange={(event) =>
                                      dashboard.updatePlanAction(
                                        item.id,
                                        event.target.value as
                                          | "ISSUED"
                                          | "PARTIALLY_DISPENSED"
                                          | "DISPENSED"
                                          | "CANCELLED"
                                          | "EXPIRED",
                                      )
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-500"
                                  >
                                    <option value="ISSUED">ISSUED</option>
                                    <option value="PARTIALLY_DISPENSED">PARTIALLY_DISPENSED</option>
                                    <option value="DISPENSED">DISPENSED</option>
                                    <option disabled value="CANCELLED">CANCELLED (unsupported)</option>
                                    <option disabled value="EXPIRED">EXPIRED (unsupported)</option>
                                  </select>

                                  {plan.action === "PARTIALLY_DISPENSED" && (item.remainingQuantity ?? 0) > 0 ? (
                                    <label className="block w-full md:w-36">
                                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Dispense now
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        max={item.remainingQuantity ?? undefined}
                                        value={plan.quantity}
                                        onChange={(event) =>
                                          dashboard.updatePlanQuantity(item.id, Number(event.target.value))
                                        }
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-500"
                                      />
                                    </label>
                                  ) : null}

                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    This action dispenses <span className="font-bold text-slate-800 dark:text-slate-200">{quantityToDispense}</span> unit(s) now.
                                  </p>
                                  {plan.action === "PARTIALLY_DISPENSED" && quantityToDispense >= (item.remainingQuantity ?? 0) && (item.remainingQuantity ?? 0) > 0 ? (
                                    <p className="max-w-[220px] text-right text-xs text-amber-700 dark:text-amber-300">
                                      This equals the full remaining quantity. If you are issuing everything, switch the line to <span className="font-bold">DISPENSED</span>.
                                    </p>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
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

                  <label className="mb-5 block">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-blue-100/80">
                      Pharmacy Organisation ID
                    </span>
                    <input
                      value={dashboard.pharmacyId}
                      onChange={(event) => dashboard.setPharmacyId(event.target.value)}
                      placeholder="Enter pharmacy ID"
                      className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-blue-100/60 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                    />
                  </label>

                  <div className="mb-8 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/70">
                          Planned items
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{dashboard.billingItems.length}</p>
                      </div>
                      <div className="rounded-2xl bg-white/5 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/70">
                          Planned units
                        </p>
                        <p className="mt-2 text-2xl font-extrabold">{plannedUnits}</p>
                      </div>
                    </div>

                    {dashboard.billingItems.length > 0 ? (
                      dashboard.billingItems.map((item) => (
                        <div key={item.id} className="flex justify-between gap-3 text-sm text-white/80">
                          <span>
                            {item.name} ({item.quantity} x {item.unitPrice.toFixed(2)})
                          </span>
                          <span className="font-bold">{item.total.toFixed(2)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-blue-100/75">
                        No dispense quantities selected yet. Choose line-item actions and the bill updates live.
                      </p>
                    )}

                    {unavailableBillingItems.length > 0 ? (
                      <div className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        {unavailableBillingItems.map(({ item }) => (
                          <p key={item.id}>
                            {item.medicineName}: {item.availabilityMessage ?? "Not available in this pharmacy, so it stays out of the bill."}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex items-end justify-between border-t border-white/10 pt-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase opacity-60">Total LKR</p>
                        <p className="font-headline text-3xl font-extrabold">
                          {dashboard.billingTotal !== null ? dashboard.billingTotal.toFixed(2) : "0.00"}
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
                      Dispense payload looks valid against the current frontend checks.
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
                          alert.tone === "error" && "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20",
                          alert.tone === "success" && "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20",
                          alert.tone === "info" && "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50",
                        )}
                      >
                        {alert.tone === "error" ? (
                          <ShieldAlert className="shrink-0 text-red-600 dark:text-red-400" size={18} />
                        ) : alert.tone === "success" ? (
                          <ShieldCheck className="shrink-0 text-emerald-600 dark:text-emerald-400" size={18} />
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
                              alert.tone === "success" && "text-emerald-700/90 dark:text-emerald-300/80",
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
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
                        <th className="px-6 py-4 font-semibold">Backend-safe detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredHistory.map((entry) => (
                        <tr key={entry.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-6 py-4 font-mono text-xs">{formatDateTime(entry.dispensedAt)}</td>
                          <td className="px-6 py-4">
                            <p className="font-bold">{entry.prescriptionId}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {entry.patientName ?? "Patient name unavailable"}
                            </p>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">{entry.patientDhid ?? "Not supplied"}</td>
                          <td className="px-6 py-4">{entry.itemCount ?? "N/A"}</td>
                          <td className="px-6 py-4">{formatLkr(entry.estimatedTotal)}</td>
                          <td className="px-6 py-4">
                            <PrescriptionStatusBadge status={entry.status} />
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                            Medicine count, DHID, and billing metadata only. Diagnosis and encounter notes stay blocked.
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
          <p className="font-bold">© 2026 National Health Portal</p>
          <div className="flex gap-8">
            <span className="cursor-default transition-colors hover:text-primary">Security</span>
            <span className="cursor-default transition-colors hover:text-primary">Privacy Policy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
