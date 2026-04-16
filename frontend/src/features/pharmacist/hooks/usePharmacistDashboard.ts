import { useEffect, useMemo, useState } from "react";
import {
  dispensePrescription,
  getPharmacistPrescriptionDetail,
  listPharmacistPrescriptions,
} from "../api/pharmacistApi";
import type {
  PharmacistDashboardState,
  PharmacistOverviewStats,
  PharmacistPrescriptionDetail,
  PharmacistPrescriptionSummary,
} from "../types";

function buildStats(
  prescriptions: PharmacistPrescriptionSummary[],
  detail: PharmacistPrescriptionDetail | null,
): PharmacistOverviewStats {
  const pendingPrescriptions = prescriptions.filter(
    (item) => item.status === "PENDING",
  ).length;
  const dispensedToday = prescriptions.filter((item) => {
    if (!item.issuedAt || item.status !== "DISPENSED") {
      return false;
    }

    const date = new Date(item.issuedAt);
    const today = new Date();

    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }).length;

  const queuedItems = prescriptions.reduce(
    (sum, item) => sum + (item.totalItems ?? 0),
    0,
  );

  const estimatedValue =
    detail?.items.every((item) => item.unitPrice !== null && item.quantity !== null)
      ? detail.items.reduce(
          (sum, item) => sum + (item.unitPrice ?? 0) * (item.quantity ?? 0),
          0,
        )
      : null;

  return {
    pendingPrescriptions,
    dispensedToday,
    queuedItems,
    estimatedValue,
  };
}

export function usePharmacistDashboard(pharmacistId?: string) {
  const [prescriptions, setPrescriptions] = useState<PharmacistPrescriptionSummary[]>([]);
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PharmacistPrescriptionDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isDispensing, setIsDispensing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadPrescriptions = async (nextSelectedId?: string | null) => {
    setIsLoadingList(true);
    setError(null);

    try {
      const items = await listPharmacistPrescriptions();
      setPrescriptions(items);

      const targetId =
        nextSelectedId && items.some((item) => item.id === nextSelectedId)
          ? nextSelectedId
          : items[0]?.id ?? null;
      setSelectedPrescriptionId(targetId);
      return targetId;
    } catch (loadError) {
      setPrescriptions([]);
      setSelectedPrescriptionId(null);
      setSelectedDetail(null);
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

  const loadDetail = async (prescriptionId: string | null) => {
    if (!prescriptionId) {
      setSelectedDetail(null);
      setDetailError(null);
      return;
    }

    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const detail = await getPharmacistPrescriptionDetail(prescriptionId);
      setSelectedDetail(detail);
    } catch (loadError) {
      setSelectedDetail(null);
      setDetailError(
        loadError instanceof Error
          ? loadError.message
          : "Prescription detail could not be loaded.",
      );
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
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
      [
        item.id,
        item.patientDhid ?? "",
        item.patientName ?? "",
        item.doctorName ?? "",
        item.status,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [prescriptions, searchQuery]);

  const stats = useMemo(
    () => buildStats(prescriptions, selectedDetail),
    [prescriptions, selectedDetail],
  );

  const dispenseSelected = async () => {
    if (!selectedPrescriptionId) {
      setActionMessage("Pick a prescription first.");
      return false;
    }

    if (!pharmacistId) {
      setActionMessage("Signed-in pharmacist identity is missing.");
      return false;
    }

    setIsDispensing(true);
    setActionMessage(null);

    try {
      const response = await dispensePrescription(selectedPrescriptionId, pharmacistId);
      setActionMessage(response.message ?? "Prescription dispensed.");
      const nextId = await loadPrescriptions(selectedPrescriptionId);
      await loadDetail(nextId);
      return true;
    } catch (dispenseError) {
      setActionMessage(
        dispenseError instanceof Error
          ? dispenseError.message
          : "Dispense action failed.",
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
    stats,
    isLoadingList,
    isLoadingDetail,
    isDispensing,
    error,
    detailError,
    actionMessage,
    searchQuery,
  };

  return {
    ...state,
    setSearchQuery,
    setSelectedPrescriptionId,
    setActionMessage,
    refresh: async () => {
      const nextId = await loadPrescriptions(selectedPrescriptionId);
      await loadDetail(nextId);
    },
    dispenseSelected,
  };
}
