export type PharmacistSection =
  | "overview"
  | "lookup"
  | "dispensing"
  | "settings";

export interface PharmacistPrescriptionSummary {
  id: string;
  status: string;
  patientDhid: string | null;
  patientName: string | null;
  doctorName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  totalItems: number | null;
}

export interface PharmacistPrescriptionItem {
  id: string;
  medicineName: string;
  dosage: string | null;
  quantity: number | null;
  instructions: string | null;
  unitPrice: number | null;
}

export interface PharmacistPrescriptionDetail {
  prescription: PharmacistPrescriptionSummary;
  items: PharmacistPrescriptionItem[];
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
  stats: PharmacistOverviewStats;
  isLoadingList: boolean;
  isLoadingDetail: boolean;
  isDispensing: boolean;
  error: string | null;
  detailError: string | null;
  actionMessage: string | null;
  searchQuery: string;
}
