import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Box,
  CheckCircle2,
  LogOut,
  Moon,
  PackagePlus,
  Search,
  Sun,
  Trash2,
  UserCog,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBrandMark } from "../../../components/ui";
import { cn } from "../../../lib/utils/cn";
import { formatDate } from "../../../lib/utils/formatDate";
import { useAuth } from "../../auth/context/AuthContext";
import { searchPharmacyCatalogMedicines } from "../api/pharmacyAdminApi";
import { usePharmacyAdminDashboard } from "../hooks/usePharmacyAdminDashboard";
import type {
  PharmacyAdminSection,
  PharmacyInventoryItem,
  PharmacyMedicineCatalogItem,
} from "../types";

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
  if (!name) return "PA";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function normalizeNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function noticeClassName(message: string | null | undefined) {
  if (!message) {
    return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }

  const lowered = message.toLowerCase();
  if (
    lowered.includes("fail") ||
    lowered.includes("error") ||
    lowered.includes("missing") ||
    lowered.includes("blocked") ||
    lowered.includes("not exposed")
  ) {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300";
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ");
}

function normalizeMedicineKey(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function PharmacyAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<PharmacyAdminSection>("dashboard");
  const [isDark, setIsDark] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState("ALL");
  const [staffStatusFilter, setStaffStatusFilter] = useState("ALL");
  const [inventoryFeedback, setInventoryFeedback] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [staffFeedback, setStaffFeedback] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    medicineName: "",
    stockQuantity: "",
    unitPrice: "",
  });
  const [showStaffCreateForm, setShowStaffCreateForm] = useState(false);
  const [staffCreateForm, setStaffCreateForm] = useState({
    fullName: "",
    email: "",
    password: "",
    licenseNo: "",
  });
  const [catalogSuggestions, setCatalogSuggestions] = useState<PharmacyMedicineCatalogItem[]>([]);
  const [selectedCatalogMedicine, setSelectedCatalogMedicine] =
    useState<PharmacyMedicineCatalogItem | null>(null);
  const [isCatalogSearchLoading, setIsCatalogSearchLoading] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { stockQuantity: string; unitPrice: string }>
  >({});
  const dashboard = usePharmacyAdminDashboard(user?.organisationId ?? null);
  const deferredStaffFilter = useDeferredValue(staffStatusFilter);
  const deferredCatalogQuery = useDeferredValue(createForm.medicineName.trim());

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("theme");
    const dark = storedTheme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    setIsDark(dark);
  }, []);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of dashboard.inventory) {
        if (!next[item.id]) {
          next[item.id] = {
            stockQuantity: String(item.stockQuantity ?? 0),
            unitPrice: String(item.unitPrice ?? 0),
          };
        }
      }
      return next;
    });
  }, [dashboard.inventory]);

  useEffect(() => {
    const query = deferredCatalogQuery;
    if (query.length < 2) {
      setCatalogSuggestions([]);
      setIsCatalogSearchLoading(false);
      setSelectedCatalogMedicine((current) =>
        current && current.name.toLowerCase() === createForm.medicineName.trim().toLowerCase()
          ? current
          : null,
      );
      return;
    }

    let active = true;
    setIsCatalogSearchLoading(true);

    void searchPharmacyCatalogMedicines(query)
      .then((items) => {
        if (!active) return;
        setCatalogSuggestions(items);
        const normalizedQuery = normalizeMedicineKey(createForm.medicineName);
        const matchedSuggestion =
          items.find((item) => normalizeMedicineKey(item.name) === normalizedQuery) ??
          (items.length === 1
            ? items[0]
            : items.find((item) => normalizeMedicineKey(item.name).startsWith(normalizedQuery))) ??
          null;

        if (matchedSuggestion) {
          setSelectedCatalogMedicine(matchedSuggestion);
          setCreateForm((current) => ({
            ...current,
            medicineName: matchedSuggestion.name,
            unitPrice:
              matchedSuggestion.retailPrice !== null ? String(matchedSuggestion.retailPrice) : "",
          }));
        } else {
          setSelectedCatalogMedicine(null);
          setCreateForm((current) => ({
            ...current,
            unitPrice: "",
          }));
        }
      })
      .catch(() => {
        if (!active) return;
        setCatalogSuggestions([]);
      })
      .finally(() => {
        if (!active) return;
        setIsCatalogSearchLoading(false);
      });

    return () => {
      active = false;
    };
  }, [createForm.medicineName, deferredCatalogQuery]);

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

  const activeSummary = dashboard.summary;
  const userInitials = getInitials(user?.name);
  const activeOrganizationId =
    dashboard.summary?.pharmacyId ?? dashboard.activePharmacyId ?? dashboard.pharmacyIdInput;

  const topMovingItems = activeSummary?.reportSummary.fastMovingItems ?? [];
  const recentAdjustments = activeSummary?.reportSummary.recentAdjustments ?? [];
  const staff = activeSummary?.staff ?? [];
  const inventoryRows = useMemo(() => {
    return dashboard.filteredInventory.filter((item) => {
      if (inventoryStatusFilter === "ALL") return true;
      const quantity = item.stockQuantity ?? 0;
      if (inventoryStatusFilter === "LOW") return quantity > 0 && quantity <= 25;
      if (inventoryStatusFilter === "OUT") return quantity <= 0;
      if (inventoryStatusFilter === "HEALTHY") return quantity > 25;
      return true;
    });
  }, [dashboard.filteredInventory, inventoryStatusFilter]);
  const staffStatusOptions = useMemo(
    () => Array.from(new Set(staff.map((member) => member.status || "UNKNOWN"))).sort(),
    [staff],
  );
  const filteredStaff = useMemo(() => {
    if (deferredStaffFilter === "ALL") return staff;
    return staff.filter((member) => member.status === deferredStaffFilter);
  }, [deferredStaffFilter, staff]);
  const maxDispensedUnits = topMovingItems[0]?.unitsDispensed ?? 0;

  const updateDraftField = (
    itemId: string,
    field: "stockQuantity" | "unitPrice",
    value: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        stockQuantity: field === "stockQuantity" ? value : (current[itemId]?.stockQuantity ?? "0"),
        unitPrice: field === "unitPrice" ? value : (current[itemId]?.unitPrice ?? "0"),
      },
    }));
  };

  const handleSaveItem = async (item: PharmacyInventoryItem) => {
    const draft = drafts[item.id] ?? {
      stockQuantity: String(item.stockQuantity ?? 0),
      unitPrice: String(item.unitPrice ?? 0),
    };

    const success = await dashboard.updateMedicine({
      itemId: item.id,
      stockQuantity: normalizeNumberInput(draft.stockQuantity),
      unitPrice: normalizeNumberInput(draft.unitPrice),
    });

    setInventoryFeedback(
      success
        ? `${item.medicineName} updated successfully.`
        : (dashboard.actionMessage ?? `Failed to update ${item.medicineName}.`),
    );
  };

  const handleCreateMedicine = async () => {
    if (!activeOrganizationId) {
      dashboard.setActionMessage("Pharmacy organisation is missing for this admin.");
      return;
    }

    const matchedMedicine =
      selectedCatalogMedicine ??
      catalogSuggestions.find(
        (item) => normalizeMedicineKey(item.name) === normalizeMedicineKey(createForm.medicineName),
      ) ??
      (catalogSuggestions.length === 1 ? catalogSuggestions[0] : null) ??
      null;

    if (!matchedMedicine) {
      setInventoryFeedback("Pick a medicine from the central catalog before saving stock.");
      return;
    }

    const success = await dashboard.createMedicine({
      pharmacyId: activeOrganizationId,
      medicineId: matchedMedicine.id,
      medicineName: matchedMedicine.name,
      stockQuantity: normalizeNumberInput(createForm.stockQuantity),
      unitPrice: matchedMedicine.retailPrice ?? normalizeNumberInput(createForm.unitPrice),
    });

    if (success) {
      setCreateForm({ medicineName: "", stockQuantity: "", unitPrice: "" });
      setCatalogSuggestions([]);
      setSelectedCatalogMedicine(null);
      setShowCreateForm(false);
      setInventoryFeedback("New inventory item added successfully.");
    } else {
      setInventoryFeedback(dashboard.actionMessage ?? "Inventory item creation failed.");
    }
  };

  const handleCreateMedicineNameChange = (value: string) => {
    setCreateForm((current) => ({ ...current, medicineName: value }));
    const normalizedValue = normalizeMedicineKey(value);
    const matchedSuggestion =
      catalogSuggestions.find((item) => normalizeMedicineKey(item.name) === normalizedValue) ??
      (catalogSuggestions.length === 1
        ? catalogSuggestions[0]
        : catalogSuggestions.find((item) =>
            normalizeMedicineKey(item.name).startsWith(normalizedValue),
          )) ??
      null;

    setSelectedCatalogMedicine(matchedSuggestion ?? null);
    if (matchedSuggestion) {
      setCreateForm((current) => ({
        ...current,
        medicineName: matchedSuggestion.name,
        unitPrice:
          matchedSuggestion.retailPrice !== null ? String(matchedSuggestion.retailPrice) : "",
      }));
    } else {
      setCreateForm((current) => ({
        ...current,
        unitPrice: "",
      }));
    }
  };

  const actionBanner = dashboard.actionMessage ? (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${noticeClassName(dashboard.actionMessage)}`}
    >
      {dashboard.actionMessage}
    </div>
  ) : null;

  const errorBanner = dashboard.error ? (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
      {dashboard.error}
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-surface font-body text-on-background antialiased transition-colors dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-100 bg-slate-50 py-6 transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 px-6">
          <AppBrandMark subtitle="Pharmacy Admin" />
        </div>

        <nav className="flex-1 space-y-1 px-2">
          {[
            { id: "dashboard" as const, label: "Dashboard", icon: BarChart3 },
            { id: "inventory" as const, label: "Stock Management", icon: Box },
            { id: "reports" as const, label: "Revenue Reports", icon: BarChart3 },
            { id: "staff" as const, label: "Staff Management", icon: UserCog },
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
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-4 pt-4">
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-2 text-xs text-slate-500 transition-colors hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
              onClick={handleLogout}
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
          <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-200">
                {user?.name ?? "Pharmacy Admin"}
              </p>
              <p className="text-[10px] font-bold uppercase text-primary dark:text-blue-400">
                Pharmacy Head
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-xs font-bold text-blue-900 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
              {userInitials}
            </div>
          </div>
        </div>
      </header>

      <main className="ml-64 min-h-screen px-8 pb-12 pt-24">
        <div className="mb-6 space-y-3">
          {errorBanner}
          {actionBanner}
          {inventoryFeedback ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${noticeClassName(inventoryFeedback)}`}
            >
              {inventoryFeedback}
            </div>
          ) : null}
          {reportFeedback ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${noticeClassName(reportFeedback)}`}
            >
              {reportFeedback}
            </div>
          ) : null}
          {staffFeedback ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${noticeClassName(staffFeedback)}`}
            >
              {staffFeedback}
            </div>
          ) : null}
        </div>

        {section === "dashboard" ? (
          <div className="space-y-8 transition-opacity duration-300">
            <header>
              <h1 className="text-3xl font-extrabold tracking-tight">Pharmacy Operations</h1>
              <p className="mt-2 text-slate-500 dark:text-slate-400">
                Inventory oversight and commercial performance metrics for organization{" "}
                {activeOrganizationId || "not assigned"}.
              </p>
            </header>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {/* Inventory Value Card */}
              <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200/90 bg-[linear-gradient(135deg,_rgba(255,255,255,0.95)_0%,_rgba(241,245,249,0.9)_100%)] p-6 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-[linear-gradient(135deg,_rgba(15,23,42,0.98)_0%,_rgba(30,41,59,0.94)_100%)]">
                <p className="relative z-10 mb-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Inventory Value
                </p>
                <h3 className="relative z-10 text-3xl font-extrabold text-blue-900 dark:text-blue-300">
                  {formatLkr(
                    activeSummary?.inventorySummary.totalInventoryValue ??
                      dashboard.stats.totalStockValue,
                  )}
                </h3>
                <p className="relative z-10 mt-2 text-[10px] font-bold text-green-600 dark:text-green-400">
                  Last refreshed {formatDate(new Date())}
                </p>
              </div>

              {/* Stock Alerts Card */}
              <div className="relative overflow-hidden rounded-[1.75rem] border border-red-200/50 bg-[linear-gradient(135deg,_rgba(255,241,241,0.9)_0%,_rgba(255,255,255,0.8)_100%)] p-6 shadow-sm backdrop-blur-md dark:border-red-500/20 dark:bg-[linear-gradient(135deg,_rgba(69,10,10,0.4)_0%,_rgba(15,23,42,0.9)_100%)]">
                <div className="absolute top-0 left-0 h-full w-1.5 bg-red-500" />
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Stock Alerts
                </p>
                <h3 className="text-3xl font-extrabold text-red-600 dark:text-red-400">
                  {activeSummary?.inventorySummary.lowStockItems ?? dashboard.stats.lowStockItems}{" "}
                  Items
                </h3>
                <p className="mt-2 text-[10px] font-bold text-red-600 dark:text-red-500">
                  Critical restock required
                </p>
              </div>

              {/* Staff Active Card */}
              <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200/90 bg-[linear-gradient(135deg,_rgba(255,255,255,0.95)_0%,_rgba(241,245,249,0.9)_100%)] p-6 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-[linear-gradient(135deg,_rgba(15,23,42,0.98)_0%,_rgba(30,41,59,0.94)_100%)]">
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Staff Active
                </p>
                <h3 className="text-3xl font-extrabold text-slate-900 dark:text-slate-200">
                  {staff.length}
                </h3>
                <p className="mt-2 text-[10px] text-slate-400">Registered pharmacists</p>
              </div>

              {/* Today's Revenue Card */}
              <div className="relative overflow-hidden rounded-[1.75rem] border border-blue-400/30 bg-[linear-gradient(135deg,_rgba(37,99,235,0.1)_0%,_rgba(37,99,235,0.2)_100%)] p-6 shadow-xl backdrop-blur-xl dark:border-blue-400/20 dark:bg-[linear-gradient(135deg,_rgba(37,99,235,0.2)_0%,_rgba(30,41,59,0.8)_100%)]">
                <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-blue-500/20 blur-2xl" />
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
                  Today's Revenue
                </p>
                <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white">
                  {formatLkr(activeSummary?.reportSummary.todayRevenue ?? null)}
                </h3>
                <p className="mt-2 text-[10px] font-bold text-blue-600/80 dark:text-blue-300/80">
                  Tracked from dispense events
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-slate-500">
                  Fast-Moving Items
                </h4>
                <div className="space-y-4">
                  {topMovingItems.length > 0 ? (
                    topMovingItems.map((item) => (
                      <div
                        key={item.medicineName}
                        className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"
                      >
                        <span className="text-sm font-bold">{item.medicineName}</span>
                        <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-bold text-green-700 dark:bg-green-900 dark:text-green-300">
                          {item.unitsDispensed} Units Sold
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No dispensing analytics available yet for this pharmacy.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-slate-500">
                  Inventory Audit Snippet
                </h4>
                <div className="space-y-4 font-mono text-[11px] text-slate-500">
                  {recentAdjustments.length > 0 ? (
                    recentAdjustments.map((item) => (
                      <p key={item.id} className="border-b pb-2 dark:border-slate-800">
                        {formatDateTime(item.timestamp)}: {item.adjustmentType} {item.medicineName}{" "}
                        ({item.unitPrice !== null ? `LKR ${item.unitPrice.toFixed(2)}` : "No price"}
                        {item.stockQuantity !== null ? `, stock ${item.stockQuantity}` : ""})
                      </p>
                    ))
                  ) : (
                    <p>No inventory adjustments returned by the backend yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">Live Inventory Health</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Live summary of inventory.
                    </p>
                  </div>
                  <CheckCircle2 className="text-emerald-500 dark:text-emerald-400" size={22} />
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Tracked items
                    </p>
                    <p className="mt-2 text-2xl font-extrabold">{dashboard.stats.totalItems}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Priced items
                    </p>
                    <p className="mt-2 text-2xl font-extrabold">{dashboard.stats.pricedItems}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Average price
                    </p>
                    <p className="mt-2 text-2xl font-extrabold">
                      {formatLkr(dashboard.stats.averageUnitPrice)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-lg font-bold">Operational Notes</h3>
                <div className="mt-5 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    Organization ID in scope:{" "}
                    <span className="font-bold">{activeOrganizationId || "Not assigned"}</span>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    Dashboard summary source:{" "}
                    <span className="font-bold">
                      {activeSummary ? "Live summary" : "Inventory-only"}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    Staff action module: <span className="font-bold">Currently unavailable</span>,
                    so permission updates remain disabled until support is available.
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {section === "inventory" ? (
          <div className="space-y-8 transition-opacity duration-300">
            <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Inventory Management</h1>
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Admin-only stock and price control for organization{" "}
                  {activeOrganizationId || "not assigned"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateForm((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 dark:bg-blue-600"
              >
                <PackagePlus size={16} />
                New SKU Entry
              </button>
            </header>

            {showCreateForm ? (
              <div className="grid gap-4 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-4">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Medicine Name
                  </span>
                  <input
                    list="pharmacy-admin-medicine-catalog"
                    value={createForm.medicineName}
                    onChange={(event) => handleCreateMedicineNameChange(event.target.value)}
                    placeholder="Start typing medicine name"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <datalist id="pharmacy-admin-medicine-catalog">
                  {catalogSuggestions.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.unit ?? "unit"} • Retail LKR {item.retailPrice ?? 0}
                    </option>
                  ))}
                </datalist>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Stock Quantity
                  </span>
                  <input
                    value={createForm.stockQuantity}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        stockQuantity: event.target.value,
                      }))
                    }
                    placeholder="Enter stock quantity"
                    type="number"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Unit Price (Auto)
                  </span>
                  <input
                    value={createForm.unitPrice}
                    readOnly
                    placeholder="Auto from catalog"
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800/70 dark:text-white"
                  />
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreateMedicine()}
                    className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-900"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setSelectedCatalogMedicine(null);
                      setCatalogSuggestions([]);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold dark:border-slate-700"
                  >
                    Cancel
                  </button>
                </div>
                <div className="md:col-span-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                  {isCatalogSearchLoading ? (
                    <span>Loading central medicine catalog...</span>
                  ) : selectedCatalogMedicine ? (
                    <span>
                      Locked to{" "}
                      <span className="font-bold text-primary dark:text-blue-400">
                        {selectedCatalogMedicine.name}
                      </span>{" "}
                      • {selectedCatalogMedicine.unit ?? "Unit not set"} • Retail{" "}
                      {formatLkr(selectedCatalogMedicine.retailPrice)}
                    </span>
                  ) : createForm.medicineName.trim().length >= 2 ? (
                    <span>
                      Pick the catalog hit from the browser suggestion list. If one result only
                      exists, the form now auto-locks it.
                    </span>
                  ) : (
                    <span>
                      Start typing a medicine name and the central catalog suggestions will show up
                      here.
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row">
                <div className="relative w-full md:w-96">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                  />
                  <input
                    value={dashboard.searchQuery}
                    onChange={(event) => dashboard.setSearchQuery(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="Filter by Name, SKU or Ingredient..."
                    type="text"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={inventoryStatusFilter}
                    onChange={(event) => setInventoryStatusFilter(event.target.value)}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="ALL">All stock states</option>
                    <option value="HEALTHY">Healthy stock</option>
                    <option value="LOW">Low stock</option>
                    <option value="OUT">Out of stock</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      dashboard.exportInventoryCsv();
                      setReportFeedback(
                        `Exported ${inventoryRows.length} inventory row(s) to CSV.`,
                      );
                    }}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold dark:bg-slate-800"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void dashboard.loadInventory()}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold dark:bg-slate-800"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="mb-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Visible rows
                  </p>
                  <p className="mt-2 text-2xl font-extrabold">{inventoryRows.length}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Low stock
                  </p>
                  <p className="mt-2 text-2xl font-extrabold text-red-600 dark:text-red-400">
                    {dashboard.stats.lowStockItems}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                    Out of stock
                  </p>
                  <p className="mt-2 text-2xl font-extrabold">{dashboard.stats.outOfStockItems}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:bg-slate-800/80">
                    <tr>
                      <th className="px-6 py-4">Medicine & SKU</th>
                      <th className="px-6 py-4">Current Stock</th>
                      <th className="px-6 py-4">Unit Price (LKR)</th>
                      <th className="px-6 py-4">Updated</th>
                      <th className="px-6 py-4">Row State</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inventoryRows.length > 0 ? (
                      inventoryRows.map((item) => {
                        const draft = drafts[item.id] ?? {
                          stockQuantity: String(item.stockQuantity ?? 0),
                          unitPrice: String(item.unitPrice ?? 0),
                        };
                        const lowStock =
                          (item.stockQuantity ?? 0) > 0 && (item.stockQuantity ?? 0) <= 25;
                        const outOfStock = (item.stockQuantity ?? 0) <= 0;
                        const dirty =
                          draft.stockQuantity !== String(item.stockQuantity ?? 0) ||
                          draft.unitPrice !== String(item.unitPrice ?? 0);
                        const rowClass = lowStock
                          ? "bg-error-container/5 hover:bg-error-container/10"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/40";

                        return (
                          <tr key={item.id} className={cn("transition-colors", rowClass)}>
                            <td className="px-6 py-4">
                              <p
                                className={cn(
                                  "font-bold",
                                  lowStock ? "text-error" : "text-blue-900 dark:text-blue-300",
                                )}
                              >
                                {item.medicineName}
                              </p>
                              <p className="text-[10px] text-slate-400">{item.id}</p>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <input
                                  value={draft.stockQuantity}
                                  onChange={(event) =>
                                    updateDraftField(item.id, "stockQuantity", event.target.value)
                                  }
                                  className={cn(
                                    "w-20 rounded-lg border px-2 py-1 text-center text-sm font-bold",
                                    lowStock
                                      ? "border-error/50 bg-white text-error dark:bg-slate-800"
                                      : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800",
                                  )}
                                  type="number"
                                />
                                <span
                                  className={cn(
                                    "text-[10px] font-bold",
                                    lowStock ? "text-error" : "text-green-600 dark:text-green-400",
                                  )}
                                >
                                  {lowStock ? "REORDER" : "Safe"}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <input
                                value={draft.unitPrice}
                                onChange={(event) =>
                                  updateDraftField(item.id, "unitPrice", event.target.value)
                                }
                                className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center text-sm font-bold text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-blue-400"
                                type="number"
                                step="0.01"
                              />
                            </td>
                            <td className="px-6 py-4 text-xs font-medium">
                              {formatDateTime(item.updatedAt ?? item.createdAt)}
                            </td>
                            <td className="px-6 py-4">
                              <div className="space-y-2 text-xs">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-3 py-1 font-bold uppercase tracking-[0.18em]",
                                    outOfStock
                                      ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                                      : lowStock
                                        ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
                                  )}
                                >
                                  {outOfStock ? "Out" : lowStock ? "Low" : "Healthy"}
                                </span>
                                {dirty ? (
                                  <p className="text-amber-700 dark:text-amber-300">
                                    Unsaved inline changes
                                  </p>
                                ) : (
                                  <p className="text-slate-500 dark:text-slate-400">
                                    Synced with latest loaded row
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveItem(item)}
                                  disabled={dashboard.isMutatingInventory}
                                  className="text-xs font-bold text-primary hover:underline dark:text-blue-400"
                                >
                                  Save Changes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const confirmed = window.confirm(
                                      `Delete ${item.medicineName} from inventory?`,
                                    );
                                    if (!confirmed) return;
                                    void dashboard.removeMedicine(item.id).then((success) => {
                                      setInventoryFeedback(
                                        success
                                          ? `${item.medicineName} removed from inventory.`
                                          : (dashboard.actionMessage ??
                                              `Failed to remove ${item.medicineName}.`),
                                      );
                                    });
                                  }}
                                  disabled={dashboard.isMutatingInventory}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-error hover:underline"
                                >
                                  <Trash2 size={12} />
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
                          colSpan={6}
                          className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                        >
                          {dashboard.isLoadingInventory
                            ? "Refreshing inventory rows..."
                            : "No inventory items matched the current search and stock filters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {section === "staff" ? (
          <div className="space-y-8 transition-opacity duration-300">
            <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Pharmacist Management</h1>
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Live pharmacist accounts under this pharmacy organisation, with permission
                  control.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <select
                  value={staffStatusFilter}
                  onChange={(event) => setStaffStatusFilter(event.target.value)}
                  className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="ALL">All staff statuses</option>
                  {staffStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowStaffCreateForm((current) => !current)}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white dark:bg-slate-700"
                >
                  {showStaffCreateForm ? "Hide Registration" : "Register Pharmacist"}
                </button>
                <button
                  type="button"
                  onClick={() => void dashboard.loadDashboardSummary()}
                  className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold dark:bg-slate-800 dark:text-slate-200"
                >
                  Refresh Staff
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {showStaffCreateForm ? (
                <div className="md:col-span-3 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-5">
                    <h3 className="text-lg font-bold">Register New Pharmacist</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Creates the auth user, users row, and pharmacists row in one shot.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Full Name
                      </span>
                      <input
                        value={staffCreateForm.fullName}
                        onChange={(event) =>
                          setStaffCreateForm((current) => ({
                            ...current,
                            fullName: event.target.value,
                          }))
                        }
                        placeholder="Pharmacist full name"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Email
                      </span>
                      <input
                        value={staffCreateForm.email}
                        onChange={(event) =>
                          setStaffCreateForm((current) => ({
                            ...current,
                            email: event.target.value,
                          }))
                        }
                        placeholder="pharmacist@email.com"
                        type="email"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Temporary Password
                      </span>
                      <input
                        value={staffCreateForm.password}
                        onChange={(event) =>
                          setStaffCreateForm((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        placeholder="At least 8 characters"
                        type="password"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        License Number
                      </span>
                      <input
                        value={staffCreateForm.licenseNo}
                        onChange={(event) =>
                          setStaffCreateForm((current) => ({
                            ...current,
                            licenseNo: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="PH-12345"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={dashboard.isMutatingStaff || !activeOrganizationId}
                      onClick={() => {
                        if (!activeOrganizationId) {
                          setStaffFeedback("This admin is not linked to a pharmacy yet.");
                          return;
                        }
                        void dashboard
                          .registerStaff({
                            pharmacyId: activeOrganizationId,
                            fullName: staffCreateForm.fullName,
                            email: staffCreateForm.email,
                            password: staffCreateForm.password,
                            licenseNo: staffCreateForm.licenseNo,
                            status: "pending",
                          })
                          .then((success) => {
                            setStaffFeedback(
                              success
                                ? `${staffCreateForm.fullName} registered under organization ${activeOrganizationId} with pending approval.`
                                : (dashboard.actionMessage ?? "Pharmacist registration failed."),
                            );
                            if (!success) return;
                            setStaffCreateForm({
                              fullName: "",
                              email: "",
                              password: "",
                              licenseNo: "",
                            });
                            setShowStaffCreateForm(false);
                          });
                      }}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
                    >
                      {dashboard.isMutatingStaff ? "Registering..." : "Create Pharmacist"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowStaffCreateForm(false);
                        setStaffCreateForm({
                          fullName: "",
                          email: "",
                          password: "",
                          licenseNo: "",
                        });
                      }}
                      className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold dark:border-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {filteredStaff.length > 0 ? (
                filteredStaff.map((member) => (
                  <div
                    key={member.id}
                    className="group relative overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-6 flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-500 dark:bg-slate-800">
                        {getInitials(member.name)}
                      </div>
                      <div>
                        <h4 className="font-bold">{member.name}</h4>
                        <p className="text-[10px] font-bold uppercase text-primary dark:text-blue-400">
                          {member.licenseNo ?? "Licensed pharmacist"}
                        </p>
                      </div>
                    </div>
                    <div className="mb-6 space-y-2">
                      <p className="flex justify-between text-[11px]">
                        <span>Status:</span>
                        <span
                          className={cn(
                            "font-bold",
                            (member.status ?? "").toLowerCase() === "suspended"
                              ? "text-red-600 dark:text-red-400"
                              : (member.status ?? "").toLowerCase() === "pending"
                                ? "text-amber-600 dark:text-amber-400"
                              : "text-green-600 dark:text-green-400",
                          )}
                        >
                          {formatStatusLabel(member.status)}
                        </span>
                      </p>
                      <p className="flex justify-between text-[11px]">
                        <span>Email:</span>
                        <span>{member.email ?? "Not supplied"}</span>
                      </p>
                      <p className="flex justify-between text-[11px]">
                        <span>Dispense events:</span>
                        <span>{member.dispenseEventsCount}</span>
                      </p>
                      <p className="flex justify-between text-[11px]">
                        <span>Last activity:</span>
                        <span>{formatDateTime(member.lastDispensedAt)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={dashboard.isMutatingStaff || !activeOrganizationId}
                      onClick={() => {
                        if (!activeOrganizationId) {
                          setStaffFeedback("This admin is not linked to a pharmacy yet.");
                          return;
                        }
                        const nextStatus =
                          (member.status ?? "").toLowerCase() === "suspended"
                            ? "approved"
                            : (member.status ?? "").toLowerCase() === "pending"
                              ? "approved"
                            : "suspended";
                        void dashboard
                          .updateStaffStatus({
                            pharmacyId: activeOrganizationId,
                            staffId: member.id,
                            status: nextStatus,
                          })
                          .then((success) => {
                            setStaffFeedback(
                              success
                                ? `${member.name} marked as ${nextStatus}.`
                                : (dashboard.actionMessage ?? `Failed to update ${member.name}.`),
                            );
                          });
                      }}
                      className={cn(
                        "w-full rounded-lg py-2 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        (member.status ?? "").toLowerCase() === "suspended"
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : (member.status ?? "").toLowerCase() === "pending"
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : "bg-slate-100 hover:bg-error/10 hover:text-error dark:bg-slate-800",
                      )}
                    >
                      {(member.status ?? "").toLowerCase() === "suspended"
                        ? "Approve Access"
                        : (member.status ?? "").toLowerCase() === "pending"
                          ? "Approve Access"
                          : "Suspend Access"}
                    </button>
                  </div>
                ))
              ) : (
                <div className="md:col-span-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  No staff rows matched the current status filter.
                </div>
              )}

              {!showStaffCreateForm ? (
                <button
                  type="button"
                  onClick={() => setShowStaffCreateForm(true)}
                  className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-6 text-slate-400 transition-all hover:border-primary hover:text-primary dark:border-slate-800"
                >
                  <UserCog className="mb-2" size={36} />
                  <p className="text-xs font-bold uppercase tracking-widest">
                    Register New Pharmacist
                  </p>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {section === "reports" ? (
          <div className="space-y-8 transition-opacity duration-300">
            <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Commercial Insights</h1>
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Tracked dispensing trends and financial performance.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    dashboard.exportRevenueCsv();
                    setReportFeedback(
                      "Revenue CSV exported from the currently loaded backend summary.",
                    );
                  }}
                  className="rounded-xl bg-slate-800 px-6 py-2 text-xs font-bold text-white dark:bg-slate-700"
                >
                  Download CSV Report
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Today</p>
                <p className="mt-3 text-3xl font-extrabold">
                  {formatLkr(activeSummary?.reportSummary.todayRevenue ?? null)}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  This Month
                </p>
                <p className="mt-3 text-3xl font-extrabold">
                  {formatLkr(activeSummary?.reportSummary.currentMonthRevenue ?? null)}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Tracked Revenue
                </p>
                <p className="mt-3 text-3xl font-extrabold">
                  {formatLkr(activeSummary?.reportSummary.totalTrackedRevenue ?? null)}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-lowest p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-8 grid gap-6 lg:grid-cols-[0.9fr,1.1fr]">
                <div className="rounded-2xl bg-slate-50 p-6 dark:bg-slate-800/50">
                  <h3 className="text-lg font-bold">Summary</h3>
                  <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                    <p className="flex justify-between">
                      <span>Dispense Events</span>
                      <span className="font-bold">
                        {activeSummary?.reportSummary.dispenseEvents ?? 0}
                      </span>
                    </p>
                    <p className="flex justify-between">
                      <span>Low Stock Items</span>
                      <span className="font-bold">
                        {activeSummary?.inventorySummary.lowStockItems ??
                          dashboard.stats.lowStockItems}
                      </span>
                    </p>
                    <p className="flex justify-between">
                      <span>Out of Stock</span>
                      <span className="font-bold">
                        {activeSummary?.inventorySummary.outOfStockItems ??
                          dashboard.stats.outOfStockItems}
                      </span>
                    </p>
                    <p className="flex justify-between">
                      <span>Fast Movers Listed</span>
                      <span className="font-bold">{topMovingItems.length}</span>
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
                  <h3 className="text-lg font-bold">Fast-Moving Items</h3>
                  <div className="mt-5 space-y-4">
                    {topMovingItems.length > 0 ? (
                      topMovingItems.map((item) => {
                        const width =
                          maxDispensedUnits > 0
                            ? `${Math.max(16, Math.round((item.unitsDispensed / maxDispensedUnits) * 100))}%`
                            : "16%";
                        return (
                          <div key={item.medicineName}>
                            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                              <span className="font-semibold">{item.medicineName}</span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {item.unitsDispensed} units
                              </span>
                            </div>
                            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className="h-2.5 rounded-full bg-blue-600 dark:bg-blue-500"
                                style={{ width }}
                              />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No fast-moving item data came back from the current backend summary.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-4 text-lg font-bold">Recent Operational Adjustments</h3>
                <div className="space-y-3">
                  {recentAdjustments.length > 0 ? (
                    recentAdjustments.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl bg-slate-50 px-4 py-4 text-sm dark:bg-slate-800/50"
                      >
                        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                          <div>
                            <p className="font-bold">{item.medicineName}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {item.adjustmentType} at {formatDateTime(item.timestamp)}
                            </p>
                          </div>
                          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Stock {item.stockQuantity ?? "N/A"} | {formatLkr(item.unitPrice)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No recent inventory adjustments returned by the backend.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                Export actions use the live summary already loaded on this page. If charts look
                sparse, the source data itself is limited.
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
