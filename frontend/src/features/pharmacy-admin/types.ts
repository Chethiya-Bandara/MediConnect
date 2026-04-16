export type PharmacyAdminSection =
  | "inventory"
  | "prescriptions"
  | "billing"
  | "settings";

export interface PharmacyInventoryItem {
  id: string;
  pharmacyId: string | null;
  medicineName: string;
  stockQuantity: number | null;
  unitPrice: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PharmacyInventoryStats {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  pricedItems: number;
  totalStockValue: number | null;
  averageUnitPrice: number | null;
}

export interface PharmacyInventoryMutationPayload {
  pharmacyId: string;
  medicineName: string;
  stockQuantity: number;
  unitPrice: number;
}

export interface PharmacyInventoryUpdatePayload {
  itemId: string;
  stockQuantity: number;
  unitPrice: number;
}
