import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  PharmacyAdminAdjustment,
  PharmacyAdminDashboardSummary,
  PharmacyAdminFastMovingItem,
  PharmacyAdminStaffMember,
  PharmacyAdminStaffRegistrationPayload,
  PharmacyAdminStaffStatusPayload,
  PharmacyInventoryItem,
  PharmacyInventoryMutationPayload,
  PharmacyInventoryUpdatePayload,
  PharmacyMedicineCatalogItem,
} from "../types";

interface RawInventoryItem {
  id?: string | number | null;
  pharmacy_id?: string | number | null;
  medicine_id?: string | number | null;
  medicine_name?: string | null;
  drug_name?: string | null;
  medicine_unit?: string | null;
  stock_quantity?: number | string | null;
  unit_price?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface RawMedicineCatalogItem {
  id?: number | string | null;
  name?: string | null;
  unit?: string | null;
  retail_price?: number | string | null;
  wholesale_price?: number | string | null;
}

interface RawAdjustment {
  id?: string | number | null;
  timestamp?: string | null;
  medicine_name?: string | null;
  adjustment_type?: string | null;
  stock_quantity?: number | string | null;
  unit_price?: number | string | null;
}

interface RawFastMovingItem {
  medicine_name?: string | null;
  units_dispensed?: number | string | null;
}

interface RawStaffMember {
  id?: string | number | null;
  user_id?: string | number | null;
  name?: string | null;
  email?: string | null;
  license_no?: string | null;
  pharmacy_id?: string | number | null;
  status?: string | null;
  dispense_events_count?: number | string | null;
  last_dispensed_at?: string | null;
}

interface RawDashboardSummary {
  pharmacy_id?: string | number | null;
  inventory_summary?: {
    total_items?: number | string | null;
    total_inventory_value?: number | string | null;
    low_stock_items?: number | string | null;
    out_of_stock_items?: number | string | null;
  } | null;
  report_summary?: {
    today_revenue?: number | string | null;
    current_month_revenue?: number | string | null;
    total_tracked_revenue?: number | string | null;
    dispense_events?: number | string | null;
    fast_moving_items?: RawFastMovingItem[] | null;
    recent_adjustments?: RawAdjustment[] | null;
  } | null;
  staff?: RawStaffMember[] | null;
}

function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
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
    medicineId: asNumber(raw.medicine_id),
    medicineName: raw.medicine_name ?? raw.drug_name ?? "Unnamed medicine",
    medicineUnit: raw.medicine_unit ?? null,
    stockQuantity: asNumber(raw.stock_quantity),
    unitPrice: asNumber(raw.unit_price),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

function normalizeMedicineCatalogItem(raw: RawMedicineCatalogItem): PharmacyMedicineCatalogItem {
  return {
    id: asNumber(raw.id) ?? 0,
    name: raw.name ?? "Unnamed medicine",
    unit: raw.unit ?? null,
    retailPrice: asNumber(raw.retail_price),
    wholesalePrice: asNumber(raw.wholesale_price),
  };
}

function normalizeFastMovingItem(raw: RawFastMovingItem): PharmacyAdminFastMovingItem {
  return {
    medicineName: raw.medicine_name ?? "Unnamed medicine",
    unitsDispensed: asNumber(raw.units_dispensed) ?? 0,
  };
}

function normalizeAdjustment(raw: RawAdjustment): PharmacyAdminAdjustment {
  return {
    id: asString(raw.id) ?? `adjustment-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: raw.timestamp ?? null,
    medicineName: raw.medicine_name ?? "Unnamed medicine",
    adjustmentType: raw.adjustment_type ?? "Updated",
    stockQuantity: asNumber(raw.stock_quantity),
    unitPrice: asNumber(raw.unit_price),
  };
}

function normalizeStaffMember(raw: RawStaffMember): PharmacyAdminStaffMember {
  return {
    id: asString(raw.id) ?? `staff-${Math.random().toString(36).slice(2, 8)}`,
    userId: asString(raw.user_id),
    name: raw.name ?? "Unnamed pharmacist",
    email: raw.email ?? null,
    licenseNo: raw.license_no ?? null,
    pharmacyId: asString(raw.pharmacy_id),
    status: raw.status ?? "ACTIVE",
    dispenseEventsCount: asNumber(raw.dispense_events_count) ?? 0,
    lastDispensedAt: raw.last_dispensed_at ?? null,
  };
}

export async function getDashboardSummary(pharmacyId: string) {
  const response = await apiRequest<RawDashboardSummary>(
    `${endpoints.pharmacyAdmin.dashboardBase}/${encodeURIComponent(pharmacyId)}`,
  );

  return {
    pharmacyId: asString(response.pharmacy_id) ?? pharmacyId,
    inventorySummary: {
      totalItems: asNumber(response.inventory_summary?.total_items) ?? 0,
      totalInventoryValue: asNumber(response.inventory_summary?.total_inventory_value),
      lowStockItems: asNumber(response.inventory_summary?.low_stock_items) ?? 0,
      outOfStockItems: asNumber(response.inventory_summary?.out_of_stock_items) ?? 0,
    },
    reportSummary: {
      todayRevenue: asNumber(response.report_summary?.today_revenue),
      currentMonthRevenue: asNumber(response.report_summary?.current_month_revenue),
      totalTrackedRevenue: asNumber(response.report_summary?.total_tracked_revenue),
      dispenseEvents: asNumber(response.report_summary?.dispense_events) ?? 0,
      fastMovingItems: (response.report_summary?.fast_moving_items ?? []).map((item) =>
        normalizeFastMovingItem(item),
      ),
      recentAdjustments: (response.report_summary?.recent_adjustments ?? []).map((item) =>
        normalizeAdjustment(item),
      ),
    },
    staff: (response.staff ?? []).map((item) => normalizeStaffMember(item)),
  } satisfies PharmacyAdminDashboardSummary;
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
      medicine_id: payload.medicineId,
      medicine_name: payload.medicineName,
      stock_quantity: payload.stockQuantity,
      unit_price: payload.unitPrice,
    }),
  });
}

export async function searchPharmacyCatalogMedicines(query: string) {
  const response = await apiRequest<{ items?: RawMedicineCatalogItem[] }>(
    `${endpoints.pharmacyAdmin.medicinesSearch}?query=${encodeURIComponent(query)}`,
  );
  return (response.items ?? []).map((item) => normalizeMedicineCatalogItem(item));
}

export async function updateInventoryItem(payload: PharmacyInventoryUpdatePayload) {
  return apiRequest<{ message?: string }>(endpoints.pharmacyAdmin.inventoryBase, {
    method: "PUT",
    body: JSON.stringify({
      id: payload.itemId,
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

export async function registerPharmacyStaff(payload: PharmacyAdminStaffRegistrationPayload) {
  return apiRequest<{ message?: string }>(endpoints.pharmacyAdmin.staffBase, {
    method: "POST",
    body: JSON.stringify({
      pharmacy_id: payload.pharmacyId,
      full_name: payload.fullName,
      email: payload.email,
      password: payload.password,
      license_no: payload.licenseNo,
      status: payload.status ?? "pending",
    }),
  });
}

export async function updatePharmacyStaffStatus(payload: PharmacyAdminStaffStatusPayload) {
  return apiRequest<{ message?: string }>(
    `${endpoints.pharmacyAdmin.staffBase}/${encodeURIComponent(payload.staffId)}/status`,
    {
      method: "PUT",
      body: JSON.stringify({
        pharmacy_id: payload.pharmacyId,
        status: payload.status,
      }),
    },
  );
}
