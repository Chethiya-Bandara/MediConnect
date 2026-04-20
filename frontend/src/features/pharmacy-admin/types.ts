export type PharmacyAdminSection =
  | "dashboard"
  | "inventory"
  | "reports"
  | "staff";

export interface PharmacyInventoryItem {
  id: string;
  pharmacyId: string | null;
  medicineName: string;
  medicineId?: number | null;
  medicineUnit?: string | null;
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

export interface PharmacyAdminStaffMember {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  licenseNo: string | null;
  organisationId: string | null;
  status: string;
  dispenseEventsCount: number;
  lastDispensedAt: string | null;
}

export interface PharmacyAdminAdjustment {
  id: string;
  timestamp: string | null;
  medicineName: string;
  adjustmentType: string;
  stockQuantity: number | null;
  unitPrice: number | null;
}

export interface PharmacyAdminFastMovingItem {
  medicineName: string;
  unitsDispensed: number;
}

export interface PharmacyAdminReportSummary {
  todayRevenue: number | null;
  currentMonthRevenue: number | null;
  totalTrackedRevenue: number | null;
  dispenseEvents: number;
  fastMovingItems: PharmacyAdminFastMovingItem[];
  recentAdjustments: PharmacyAdminAdjustment[];
}

export interface PharmacyAdminDashboardSummary {
  pharmacyId: string;
  inventorySummary: {
    totalItems: number;
    totalInventoryValue: number | null;
    lowStockItems: number;
    outOfStockItems: number;
  };
  reportSummary: PharmacyAdminReportSummary;
  staff: PharmacyAdminStaffMember[];
}

export interface PharmacyInventoryMutationPayload {
  pharmacyId: string;
  medicineId?: number | null;
  medicineName: string;
  stockQuantity: number;
  unitPrice?: number | null;
}

export interface PharmacyInventoryUpdatePayload {
  itemId: string;
  stockQuantity: number;
  unitPrice: number;
}

export interface PharmacyMedicineCatalogItem {
  id: number;
  name: string;
  unit: string | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
}

export interface PharmacyAdminStaffRegistrationPayload {
  pharmacyId: string;
  fullName: string;
  email: string;
  password: string;
  licenseNo: string;
  status?: "active" | "suspended";
}

export interface PharmacyAdminStaffStatusPayload {
  pharmacyId: string;
  staffId: string;
  status: "active" | "suspended";
}
