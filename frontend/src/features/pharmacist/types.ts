export type PharmacistSection =
  | "overview"
  | "lookup"
  | "dispensing"
  | "settings"
  | "history";

export type PharmacistDispenseAction =
  | "ISSUED"
  | "PARTIALLY_DISPENSED"
  | "DISPENSED"
  | "CANCELLED"
  | "EXPIRED";

export interface PharmacistPrescriptionSummary {
  id: string;
  status: string;
  patientDhid: string | null;
  patientName: string | null;
  doctorName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  totalItems: number | null;
  sourceName?: string | null;
  signatureValid?: boolean | null;
}

export interface PharmacistPrescriptionItem {
  id: string;
  medicineName: string;
  dosage: string | null;
  quantity: number | null;
  instructions: string | null;
  unitPrice: number | null;
  dispensedQuantity: number;
  remainingQuantity: number | null;
}

export interface PharmacistDispenseHistoryEntry {
  id: string;
  prescriptionId: string;
  status: string;
  dispensedAt: string | null;
  pharmacistId: string | null;
  patientDhid: string | null;
  patientName: string | null;
  doctorName: string | null;
  itemCount: number | null;
  estimatedTotal: number | null;
}

export interface PharmacistDispensePlanItem {
  action: PharmacistDispenseAction;
  quantity: number;
}

export interface PharmacistPrescriptionDetail {
  prescription: PharmacistPrescriptionSummary;
  items: PharmacistPrescriptionItem[];
  dispensationHistory: PharmacistDispenseHistoryEntry[];
}

export interface PharmacistOverviewStats {
  pendingPrescriptions: number;
  dispensedToday: number;
  queuedItems: number;
  estimatedValue: number | null;
}

export interface PharmacistDashboardState {
  prescriptions: PharmacistPrescriptionSummary[];
  filteredPrescriptions: PharmacistPrescriptionSummary[];
  selectedPrescriptionId: string | null;
  selectedDetail: PharmacistPrescriptionDetail | null;
  history: PharmacistDispenseHistoryEntry[];
  pharmacyId: string;
  dispensePlan: Record<string, PharmacistDispensePlanItem>;
  stats: PharmacistOverviewStats;
  isLoadingList: boolean;
  isLoadingDetail: boolean;
  isLoadingHistory: boolean;
  isDispensing: boolean;
  error: string | null;
  detailError: string | null;
  historyError: string | null;
  actionMessage: string | null;
  searchQuery: string;
}
