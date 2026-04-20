import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  addInventoryItem,
  deleteInventoryItem,
  getDashboardSummary,
  getInventory,
  registerPharmacyStaff,
  updateInventoryItem,
  updatePharmacyStaffStatus,
} from "../api/pharmacyAdminApi";
import { lowStockThreshold } from "../constants";
import type {
  PharmacyAdminDashboardSummary,
  PharmacyInventoryItem,
  PharmacyInventoryMutationPayload,
  PharmacyInventoryStats,
  PharmacyAdminStaffRegistrationPayload,
  PharmacyAdminStaffStatusPayload,
  PharmacyInventoryUpdatePayload,
} from "../types";

function buildInventoryStats(items: PharmacyInventoryItem[]): PharmacyInventoryStats {
  const totalItems = items.length;
  const lowStockItems = items.filter((item) => {
    const quantity = item.stockQuantity ?? 0;
    return quantity > 0 && quantity <= lowStockThreshold;
  }).length;
  const outOfStockItems = items.filter((item) => (item.stockQuantity ?? 0) <= 0).length;
  const pricedItems = items.filter((item) => (item.unitPrice ?? 0) > 0).length;

  const totalStockValue =
    items.every((item) => item.stockQuantity !== null && item.unitPrice !== null)
      ? items.reduce(
          (sum, item) => sum + (item.stockQuantity ?? 0) * (item.unitPrice ?? 0),
          0,
        )
      : null;

  const averageUnitPrice =
    pricedItems > 0
      ? items.reduce((sum, item) => sum + (item.unitPrice ?? 0), 0) / pricedItems
      : null;

  return {
    totalItems,
    lowStockItems,
    outOfStockItems,
    pricedItems,
    totalStockValue,
    averageUnitPrice,
  };
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function usePharmacyAdminDashboard(organisationId?: number | null) {
  const [pharmacyIdInput, setPharmacyIdInput] = useState(
    organisationId ? String(organisationId) : "",
  );
  const [activePharmacyId, setActivePharmacyId] = useState<string | null>(
    organisationId ? String(organisationId) : null,
  );
  const [inventory, setInventory] = useState<PharmacyInventoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isMutatingInventory, setIsMutatingInventory] = useState(false);
  const [isMutatingStaff, setIsMutatingStaff] = useState(false);
  const [summary, setSummary] = useState<PharmacyAdminDashboardSummary | null>(null);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!organisationId) {
      return;
    }

    const nextId = String(organisationId);
    setPharmacyIdInput(nextId);
    setActivePharmacyId(nextId);
  }, [organisationId]);

  const loadDashboardSummary = async (
    pharmacyId = activePharmacyId ?? pharmacyIdInput.trim(),
  ) => {
    if (!pharmacyId) {
      setSummary(null);
      return null;
    }

    setIsLoadingDashboard(true);
    try {
      const response = await getDashboardSummary(pharmacyId);
      setSummary(response);
      const resolvedPharmacyId = response.pharmacyId || pharmacyId;
      if (resolvedPharmacyId) {
        setActivePharmacyId(resolvedPharmacyId);
      }
      return resolvedPharmacyId;
    } catch (loadError) {
      setSummary(null);
      setError(
        loadError instanceof Error ? loadError.message : "Dashboard summary could not be loaded.",
      );
      return null;
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  const loadInventory = async (pharmacyId = activePharmacyId ?? pharmacyIdInput.trim()) => {
    if (!pharmacyId) {
      setError("Pharmacy organisation is not assigned to this admin yet.");
      setInventory([]);
      setSelectedItemId(null);
      setActivePharmacyId(null);
      return false;
    }

    setIsLoadingInventory(true);
    setError(null);

    try {
      const items = await getInventory(pharmacyId);
      setInventory(items);
      setSelectedItemId(items[0]?.id ?? null);
      const resolvedFromSummary = await loadDashboardSummary(pharmacyId);
      const resolvedPharmacyId = items[0]?.pharmacyId ?? resolvedFromSummary ?? null;
      if (resolvedPharmacyId) {
        setActivePharmacyId(resolvedPharmacyId);
      }
      return true;
    } catch (loadError) {
      setInventory([]);
      setSelectedItemId(null);
      setActivePharmacyId(null);
      setError(
        loadError instanceof Error ? loadError.message : "Inventory could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingInventory(false);
    }
  };

  useEffect(() => {
    if (!organisationId) {
      return;
    }

    void loadInventory(String(organisationId));
  }, [organisationId]);

  const createMedicine = async (payload: PharmacyInventoryMutationPayload) => {
    setIsMutatingInventory(true);
    setActionMessage(null);

    try {
      const response = await addInventoryItem(payload);
      setActionMessage(response.message ?? "Medicine added.");
      await loadInventory(payload.pharmacyId);
      return true;
    } catch (mutationError) {
      setActionMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Medicine creation failed.",
      );
      return false;
    } finally {
      setIsMutatingInventory(false);
    }
  };

  const updateMedicine = async (payload: PharmacyInventoryUpdatePayload) => {
    setIsMutatingInventory(true);
    setActionMessage(null);

    try {
      const response = await updateInventoryItem(payload);
      setActionMessage(response.message ?? "Inventory updated.");
      if (activePharmacyId) {
        await loadInventory(activePharmacyId);
      }
      return true;
    } catch (mutationError) {
      setActionMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Inventory update failed.",
      );
      return false;
    } finally {
      setIsMutatingInventory(false);
    }
  };

  const removeMedicine = async (itemId: string) => {
    setIsMutatingInventory(true);
    setActionMessage(null);

    try {
      const response = await deleteInventoryItem(itemId);
      setActionMessage(response.message ?? "Medicine removed.");
      if (activePharmacyId) {
        await loadInventory(activePharmacyId);
      }
      return true;
    } catch (mutationError) {
      setActionMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Inventory delete failed.",
      );
      return false;
    } finally {
      setIsMutatingInventory(false);
    }
  };

  const filteredInventory = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) {
      return inventory;
    }

    return inventory.filter((item) =>
      [item.id, item.medicineName, item.pharmacyId ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [deferredSearchQuery, inventory]);

  const stats = useMemo(() => buildInventoryStats(inventory), [inventory]);
  const selectedItem = inventory.find((item) => item.id === selectedItemId) ?? null;

  const exportInventoryCsv = () => {
    const rows = [
      ["Item ID", "Medicine", "Pharmacy ID", "Stock", "Unit Price"],
      ...filteredInventory.map((item) => [
        item.id,
        item.medicineName,
        item.pharmacyId ?? "",
        item.stockQuantity ?? "",
        item.unitPrice ?? "",
      ]),
    ];
    downloadCsv("pharmacy-inventory.csv", rows);
  };

  const exportRevenueCsv = () => {
    if (!summary) {
      setActionMessage("Load dashboard data first before exporting a revenue report.");
      return;
    }

    const rows = [
      ["Metric", "Value"],
      ["Today Revenue", summary.reportSummary.todayRevenue ?? ""],
      ["Current Month Revenue", summary.reportSummary.currentMonthRevenue ?? ""],
      ["Total Tracked Revenue", summary.reportSummary.totalTrackedRevenue ?? ""],
      ["Dispense Events", summary.reportSummary.dispenseEvents],
      [],
      ["Fast Moving Item", "Units Dispensed"],
      ...summary.reportSummary.fastMovingItems.map((item) => [
        item.medicineName,
        item.unitsDispensed,
      ]),
    ];
    downloadCsv("pharmacy-revenue-report.csv", rows);
  };

  const registerStaff = async (payload: PharmacyAdminStaffRegistrationPayload) => {
    setIsMutatingStaff(true);
    setActionMessage(null);

    try {
      const response = await registerPharmacyStaff(payload);
      setActionMessage(response.message ?? "Pharmacist registered.");
      await loadDashboardSummary(payload.pharmacyId);
      return true;
    } catch (mutationError) {
      setActionMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Pharmacist registration failed.",
      );
      return false;
    } finally {
      setIsMutatingStaff(false);
    }
  };

  const updateStaffStatus = async (payload: PharmacyAdminStaffStatusPayload) => {
    setIsMutatingStaff(true);
    setActionMessage(null);

    try {
      const response = await updatePharmacyStaffStatus(payload);
      setActionMessage(response.message ?? "Staff status updated.");
      await loadDashboardSummary(payload.pharmacyId);
      return true;
    } catch (mutationError) {
      setActionMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Staff status update failed.",
      );
      return false;
    } finally {
      setIsMutatingStaff(false);
    }
  };

  return {
    pharmacyIdInput,
    activePharmacyId,
    inventory,
    filteredInventory,
    selectedItem,
    selectedItemId,
    stats,
    summary,
    searchQuery,
    error,
    actionMessage,
    isLoadingInventory,
    isLoadingDashboard,
    isMutatingInventory,
    isMutatingStaff,
    setPharmacyIdInput,
    setSearchQuery,
    setSelectedItemId,
    setActionMessage,
    loadInventory,
    loadDashboardSummary,
    createMedicine,
    updateMedicine,
    removeMedicine,
    registerStaff,
    updateStaffStatus,
    exportInventoryCsv,
    exportRevenueCsv,
  };
}
