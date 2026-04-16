import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  PharmacyInventoryItem,
  PharmacyInventoryMutationPayload,
  PharmacyInventoryUpdatePayload,
} from "../types";

interface RawInventoryItem {
  id?: string | number | null;
  pharmacy_id?: string | number | null;
  medicine_name?: string | null;
  drug_name?: string | null;
  stock_quantity?: number | string | null;
  unit_price?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function asString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeInventoryItem(raw: RawInventoryItem): PharmacyInventoryItem {
  return {
    id: asString(raw.id) ?? `inventory-${Math.random().toString(36).slice(2, 8)}`,
    pharmacyId: asString(raw.pharmacy_id),
    medicineName: raw.medicine_name ?? raw.drug_name ?? "Unnamed medicine",
    stockQuantity: asNumber(raw.stock_quantity),
    unitPrice: asNumber(raw.unit_price),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

export async function getInventory(pharmacyId: string) {
  const response = await apiRequest<RawInventoryItem[]>(
    `${endpoints.pharmacyAdmin.inventoryBase}/${encodeURIComponent(pharmacyId)}`,
  );
  return response.map((item) => normalizeInventoryItem(item));
}

export async function addInventoryItem(payload: PharmacyInventoryMutationPayload) {
  return apiRequest<{ message?: string }>(endpoints.pharmacyAdmin.inventoryBase, {
    method: "POST",
    body: JSON.stringify({
      pharmacy_id: payload.pharmacyId,
      medicine_name: payload.medicineName,
      drug_name: payload.medicineName,
      stock_quantity: payload.stockQuantity,
      unit_price: payload.unitPrice,
    }),
  });
}

export async function updateInventoryItem(payload: PharmacyInventoryUpdatePayload) {
  return apiRequest<{ message?: string }>(endpoints.pharmacyAdmin.inventoryBase, {
    method: "PUT",
    body: JSON.stringify({
      id: payload.itemId,
      item_id: payload.itemId,
      stock_quantity: payload.stockQuantity,
      unit_price: payload.unitPrice,
    }),
  });
}

export async function deleteInventoryItem(itemId: string) {
  return apiRequest<{ message?: string }>(
    `${endpoints.pharmacyAdmin.inventoryBase}/${encodeURIComponent(itemId)}`,
    {
      method: "DELETE",
    },
  );
}
