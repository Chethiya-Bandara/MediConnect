import { useDeferredValue, useMemo, useState } from "react";
import {
  addInventoryItem,
  deleteInventoryItem,
  getInventory,
  updateInventoryItem,
} from "../api/pharmacyAdminApi";
import { lowStockThreshold } from "../constants";
import type {
  PharmacyInventoryItem,
  PharmacyInventoryMutationPayload,
  PharmacyInventoryStats,
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

export function usePharmacyAdminDashboard() {
  const [pharmacyIdInput, setPharmacyIdInput] = useState("");
  const [activePharmacyId, setActivePharmacyId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<PharmacyInventoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [isMutatingInventory, setIsMutatingInventory] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const loadInventory = async (pharmacyId = pharmacyIdInput.trim()) => {
    if (!pharmacyId) {
      setError("Enter a pharmacy ID before loading inventory.");
      setInventory([]);
      setSelectedItemId(null);
      setActivePharmacyId(null);
      return false;
    }

    setIsLoadingInventory(true);
    setError(null);
    setActionMessage(null);

    try {
      const items = await getInventory(pharmacyId);
      setInventory(items);
      setActivePharmacyId(pharmacyId);
      setSelectedItemId(items[0]?.id ?? null);
      return true;
    } catch (loadError) {
      setInventory([]);
      setSelectedItemId(null);
      setActivePharmacyId(pharmacyId);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Inventory could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingInventory(false);
    }
  };

  const createMedicine = async (payload: PharmacyInventoryMutationPayload) => {
    setIsMutatingInventory(true);
    setActionMessage(null);

    try {
      const response = await addInventoryItem(payload);
      setActionMessage(response.message ?? "Medicine added.");
      await loadInventory(payload.pharmacyId);
      return true;
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Medicine creation failed.",
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
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Inventory update failed.",
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
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Inventory delete failed.",
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
  }, [inventory, deferredSearchQuery]);

  const stats = useMemo(() => buildInventoryStats(inventory), [inventory]);

  const selectedItem =
    inventory.find((item) => item.id === selectedItemId) ?? null;

  return {
    pharmacyIdInput,
    activePharmacyId,
    inventory,
    filteredInventory,
    selectedItem,
    selectedItemId,
    stats,
    searchQuery,
    error,
    actionMessage,
    isLoadingInventory,
    isMutatingInventory,
    setPharmacyIdInput,
    setSearchQuery,
    setSelectedItemId,
    loadInventory,
    createMedicine,
    updateMedicine,
    removeMedicine,
  };
}
