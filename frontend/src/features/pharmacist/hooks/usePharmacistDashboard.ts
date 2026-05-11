import { useEffect, useMemo, useState } from "react";
import {
  dispensePrescription,
  getPharmacistPrescriptionDetail,
  listPharmacistHistory,
  listPharmacistPrescriptions,
} from "../api/pharmacistApi";
import type {
  PharmacistDashboardState,
  PharmacistDispenseAction,
  PharmacistDispenseHistoryEntry,
  PharmacistDispensePlanItem,
  PharmacistOverviewStats,
  PharmacistPrescriptionDetail,
  PharmacistPrescriptionItem,
  PharmacistPrescriptionSummary,
} from "../types";

const PHARMACY_ID_STORAGE_KEY = "medi_connect_pharmacist_pharmacy_id";

function getStoredPharmacyId() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(PHARMACY_ID_STORAGE_KEY) ?? "";
}

function clampQuantity(value: number, max: number | null) {
  const normalized = Number.isFinite(value) ? Math.max(Math.floor(value), 0) : 0;

  if (max === null) {
    return normalized;
  }

  return Math.min(normalized, Math.max(max, 0));
}

function parsePositiveInteger(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : null;
  }

  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) {
      const parsed = Number.parseInt(match[0], 10);
      return parsed > 0 ? parsed : null;
    }
  }

  return null;
}

function parseDurationDays(instructions: string | null | undefined) {
  if (!instructions) {
    return null;
  }

  const match = instructions.match(/Duration:\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return parsed > 0 ? parsed : null;
}

function parsePackageCapacity(
  item: Pick<PharmacistPrescriptionItem, "catalogUnit" | "medicineName">,
) {
  const candidates = [item.catalogUnit ?? "", item.medicineName ?? ""].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    const match =
      normalized.match(/(\d+(?:\.\d+)?)\s*(ml|drops?|bottle|tab(?:let)?s?)/i) ??
      normalized.match(/(\d+(?:\.\d+)?)/);

    if (!match) {
      continue;
    }

    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function getDispenseMetrics(item: PharmacistPrescriptionItem) {
  const unitKind = (item.unit ?? "").trim().toLowerCase();
  const dailyDose = parsePositiveInteger(item.dosage);
  const durationDays = parseDurationDays(item.instructions);
  const packageCapacity = parsePackageCapacity(item);

  let prescribedQuantity = item.quantity ?? null;
  if (dailyDose !== null && durationDays !== null) {
    if (unitKind === "tablets") {
      prescribedQuantity = dailyDose * durationDays;
    } else if (unitKind === "ml" || unitKind === "drops") {
      const totalVolume =
        unitKind === "drops" ? (dailyDose * durationDays) / 20 : dailyDose * durationDays;
      prescribedQuantity =
        packageCapacity !== null ? Math.max(1, Math.ceil(totalVolume / packageCapacity)) : totalVolume;
    }
  }

  const normalizedPrescribedQuantity =
    prescribedQuantity !== null && Number.isFinite(prescribedQuantity)
      ? Math.max(Math.floor(prescribedQuantity), 0)
      : null;

  const remainingQuantity =
    normalizedPrescribedQuantity === null
      ? null
      : Math.max(normalizedPrescribedQuantity - item.dispensedQuantity, 0);

  const quantityLabel =
    unitKind === "tablets" ? "tablet(s)" : unitKind === "ml" || unitKind === "drops" ? "bottle(s)" : "unit(s)";

  return {
    prescribedQuantity: normalizedPrescribedQuantity,
    remainingQuantity,
    quantityLabel,
    dailyDose,
    durationDays,
    packageCapacity,
  };
}

function isSameDay(dateString: string | null) {
  if (!dateString) {
    return false;
  }

  const value = new Date(dateString);
  if (Number.isNaN(value.getTime())) {
    return false;
  }

  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate()
  );
}

function getDefaultAction(item: PharmacistPrescriptionItem): PharmacistDispenseAction {
  if ((getDispenseMetrics(item).remainingQuantity ?? 0) <= 0) {
    return "DISPENSED";
  }

  if (item.dispensedQuantity > 0) {
    return "PARTIALLY_DISPENSED";
  }

  return "DISPENSED";
}

function getDefaultQuantity(item: PharmacistPrescriptionItem) {
  const metrics = getDispenseMetrics(item);
  if (metrics.remainingQuantity === null) {
    return metrics.prescribedQuantity ?? 0;
  }

  return Math.max(metrics.remainingQuantity, 0);
}

function createPlan(detail: PharmacistPrescriptionDetail | null) {
  if (!detail) {
    return {} as Record<string, PharmacistDispensePlanItem>;
  }

  return detail.items.reduce<Record<string, PharmacistDispensePlanItem>>((accumulator, item) => {
    accumulator[item.id] = {
      action: getDefaultAction(item),
      quantity: getDefaultQuantity(item),
    };
    return accumulator;
  }, {});
}

function getSearchableValues(item: PharmacistPrescriptionSummary) {
  return [
    item.id,
    item.patientDhid ?? "",
    item.patientName ?? "",
    item.doctorName ?? "",
    item.status,
  ].map((value) => value.toLowerCase());
}

function normalizeLookupQuery(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildStats(
  prescriptions: PharmacistPrescriptionSummary[],
  history: PharmacistDispenseHistoryEntry[],
  detail: PharmacistPrescriptionDetail | null,
  billableTotal: number | null,
): PharmacistOverviewStats {
  const pendingPrescriptions = prescriptions.filter((item) =>
    ["PENDING", "ISSUED", "PARTIALLY_DISPENSED"].includes(item.status),
  ).length;

  const dispensedToday = history.filter((item) => isSameDay(item.dispensedAt)).length;

  const queuedItems = prescriptions.reduce((sum, item) => sum + (item.totalItems ?? 0), 0);

  const estimatedValue =
    billableTotal ??
    (detail?.items.every((item) => item.unitPrice !== null && item.quantity !== null)
      ? detail.items.reduce((sum, item) => sum + (item.unitPrice ?? 0) * (item.quantity ?? 0), 0)
      : null);

  const totalBilledToday = history
    .filter((entry) => entry.dispensedAt && isSameDay(entry.dispensedAt))
    .reduce((sum, entry) => sum + (entry.estimatedTotal ?? 0), 0);

  return {
    pendingPrescriptions,
    dispensedToday,
    queuedItems,
    estimatedValue,
    totalBilledToday,
  };
}

export function usePharmacistDashboard(pharmacistId?: string, organisationId?: number | null) {
  const [prescriptions, setPrescriptions] = useState<PharmacistPrescriptionSummary[]>([]);
  const [history, setHistory] = useState<PharmacistDispenseHistoryEntry[]>([]);
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PharmacistPrescriptionDetail | null>(null);
  const [dispensePlan, setDispensePlan] = useState<Record<string, PharmacistDispensePlanItem>>({});
  const [pharmacyId, setPharmacyId] = useState(() =>
    organisationId ? String(organisationId) : getStoredPharmacyId(),
  );
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isDispensing, setIsDispensing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!organisationId) {
      return;
    }

    const nextId = String(organisationId);
    setPharmacyId(nextId);
    window.localStorage.setItem(PHARMACY_ID_STORAGE_KEY, nextId);
  }, [organisationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (pharmacyId.trim()) {
      window.localStorage.setItem(PHARMACY_ID_STORAGE_KEY, pharmacyId.trim());
    }
  }, [pharmacyId]);

  const loadPrescriptions = async (nextSelectedId?: string | null) => {
    setIsLoadingList(true);
    setError(null);

    try {
      const items = await listPharmacistPrescriptions();
      setPrescriptions(items);

      const targetId =
        nextSelectedId && items.some((item) => item.id === nextSelectedId) ? nextSelectedId : null;

      setSelectedPrescriptionId(targetId);
      return targetId;
    } catch (loadError) {
      setPrescriptions([]);
      setSelectedPrescriptionId(null);
      setSelectedDetail(null);
      setDispensePlan({});
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Pharmacist prescriptions could not be loaded.",
      );
      return null;
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);

    try {
      const items = await listPharmacistHistory();
      setHistory(items);
    } catch (loadError) {
      setHistory([]);
      setHistoryError(
        loadError instanceof Error ? loadError.message : "Dispense history could not be loaded.",
      );
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadDetail = async (prescriptionId: string | null) => {
    if (!prescriptionId) {
      setSelectedDetail(null);
      setDispensePlan({});
      setDetailError(null);
      return;
    }

    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const detail = await getPharmacistPrescriptionDetail(prescriptionId);
      setSelectedDetail(detail);
      setDispensePlan(createPlan(detail));
    } catch (loadError) {
      setSelectedDetail(null);
      setDispensePlan({});
      setDetailError(
        loadError instanceof Error ? loadError.message : "Prescription detail could not be loaded.",
      );
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    void loadHistory();
    void loadPrescriptions();
  }, []);

  useEffect(() => {
    void loadDetail(selectedPrescriptionId);
  }, [selectedPrescriptionId]);

  const filteredPrescriptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return prescriptions;
    }

    return prescriptions.filter((item) =>
      getSearchableValues(item).some((value) => value.includes(query)),
    );
  }, [prescriptions, searchQuery]);

  const plannedItems = useMemo(() => {
    if (!selectedDetail) {
      return [];
    }

    return selectedDetail.items.map((item) => {
      const metrics = getDispenseMetrics(item);
      const plan = dispensePlan[item.id] ?? {
        action: getDefaultAction(item),
        quantity: getDefaultQuantity(item),
      };

      const remaining = metrics.remainingQuantity;
      let quantityToDispense = 0;

      if (plan.action === "DISPENSED") {
        quantityToDispense = remaining ?? Math.max(metrics.prescribedQuantity ?? 0, 0);
      } else if (plan.action === "PARTIALLY_DISPENSED") {
        quantityToDispense = clampQuantity(plan.quantity, remaining);
      }

      return {
        item,
        plan,
        metrics,
        quantityToDispense,
      };
    });
  }, [dispensePlan, selectedDetail]);

  const billingItems = useMemo(
    () =>
      plannedItems
        .filter(({ quantityToDispense, item }) => quantityToDispense > 0 && item.unitPrice !== null)
        .map(({ item, metrics, quantityToDispense }) => ({
          id: item.id,
          name: item.medicineName,
          quantity: quantityToDispense,
          quantityLabel: metrics.quantityLabel,
          unitPrice: item.unitPrice ?? 0,
          total: quantityToDispense * (item.unitPrice ?? 0),
        })),
    [plannedItems],
  );

  const billingTotal = useMemo(
    () =>
      billingItems.length > 0 ? billingItems.reduce((sum, item) => sum + item.total, 0) : null,
    [billingItems],
  );

  const unsupportedSelections = useMemo(
    () =>
      plannedItems.filter(({ plan }) => plan.action === "CANCELLED" || plan.action === "EXPIRED"),
    [plannedItems],
  );

  const stats = useMemo(
    () => buildStats(prescriptions, history, selectedDetail, billingTotal),
    [billingTotal, history, prescriptions, selectedDetail],
  );

  const updatePlanAction = (itemId: string, action: PharmacistDispenseAction) => {
    setDispensePlan((current) => {
      const item = selectedDetail?.items.find((entry) => entry.id === itemId);
      if (!item) {
        return current;
      }

      const previous = current[itemId] ?? {
        action: getDefaultAction(item),
        quantity: getDefaultQuantity(item),
      };
      const metrics = getDispenseMetrics(item);

      let quantity = previous.quantity;
      if (action === "DISPENSED") {
        quantity = getDefaultQuantity(item);
      } else if (action === "PARTIALLY_DISPENSED") {
        quantity = clampQuantity(previous.quantity || 1, metrics.remainingQuantity);
        if (quantity === 0 && (metrics.remainingQuantity ?? 0) > 0) {
          quantity = 1;
        }
      } else {
        quantity = 0;
      }

      return {
        ...current,
        [itemId]: {
          action,
          quantity,
        },
      };
    });
  };

  const updatePlanQuantity = (itemId: string, quantity: number) => {
    setDispensePlan((current) => {
      const item = selectedDetail?.items.find((entry) => entry.id === itemId);
      if (!item) {
        return current;
      }

      const existing = current[itemId] ?? {
        action: getDefaultAction(item),
        quantity: getDefaultQuantity(item),
      };
      const metrics = getDispenseMetrics(item);

      return {
        ...current,
        [itemId]: {
          ...existing,
          quantity: clampQuantity(quantity, metrics.remainingQuantity),
        },
      };
    });
  };

  const lookupPrescription = (queryOverride?: string) => {
    const query = normalizeLookupQuery(queryOverride ?? searchQuery);
    setActionMessage(null);

    if (!query) {
      setActionMessage("Enter a DHID or prescription ID first.");
      return false;
    }

    const exactMatch = prescriptions.find((item) =>
      [item.id, item.patientDhid ?? ""].some((value) => value.toLowerCase() === query),
    );

    if (exactMatch) {
      setSelectedPrescriptionId(exactMatch.id);
      setActionMessage("Verify / Lookup mode successful");
      return true;
    }

    const partialMatch = filteredPrescriptions[0];

    if (!partialMatch) {
      setActionMessage("No prescription matched that DHID or ID.");
      return false;
    }

    setSelectedPrescriptionId(partialMatch.id);
    setActionMessage(
      `No exact match found. Showing the closest live queue result ${partialMatch.id} instead.`,
    );
    return true;
  };

  const refresh = async () => {
    const nextId = await loadPrescriptions(selectedPrescriptionId);
    await Promise.all([loadDetail(nextId), loadHistory()]);
  };

  const dispenseSelected = async () => {
    if (!selectedPrescriptionId) {
      setActionMessage("Pick a prescription first.");
      return false;
    }

    if (!pharmacistId) {
      setActionMessage("Signed-in pharmacist identity is missing.");
      return false;
    }

    if (!pharmacyId.trim()) {
      setActionMessage("Pharmacy organisation ID is required before dispensing.");
      return false;
    }

    if (unsupportedSelections.length > 0) {
      setActionMessage(
        "Cancelled or expired line-item actions are not supported by the current backend endpoint.",
      );
      return false;
    }

    const items = plannedItems
      .filter(({ quantityToDispense }) => quantityToDispense > 0)
      .map(({ item, quantityToDispense }) => ({
        id: item.id,
        quantity: quantityToDispense,
      }));

    if (items.length === 0) {
      setActionMessage("Choose at least one medicine quantity to dispense.");
      return false;
    }

    setIsDispensing(true);
    setActionMessage(null);

    try {
      const response = await dispensePrescription(selectedPrescriptionId, {
        pharmacyId: pharmacyId.trim(),
        items,
      });

      setActionMessage(response.message ?? "Dispensing successful.");
      setSelectedPrescriptionId(null);
      const nextId = await loadPrescriptions(null);
      await Promise.all([loadDetail(nextId), loadHistory()]);
      return true;
    } catch (dispenseError) {
      setActionMessage(
        dispenseError instanceof Error ? dispenseError.message : "Dispense action failed.",
      );
      return false;
    } finally {
      setIsDispensing(false);
    }
  };

  const state: PharmacistDashboardState = {
    prescriptions,
    filteredPrescriptions,
    selectedPrescriptionId,
    selectedDetail,
    history,
    pharmacyId,
    dispensePlan,
    stats,
    isLoadingList,
    isLoadingDetail,
    isLoadingHistory,
    isDispensing,
    error,
    detailError,
    historyError,
    actionMessage,
    searchQuery,
  };

  return {
    ...state,
    billingItems,
    billingTotal,
    plannedItems,
    unsupportedSelections,
    setSearchQuery,
    setSelectedPrescriptionId,
    setPharmacyId,
    setActionMessage,
    updatePlanAction,
    updatePlanQuantity,
    lookupPrescription,
    refresh,
    dispenseSelected,
  };
}
