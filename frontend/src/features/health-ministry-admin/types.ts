export type HealthMinistryAdminSection =
  | "overview"
  | "approvals"
  | "medicines"
  | "analytics"
  | "users"
  | "settings";

export type ApprovalStatus = "approved" | "rejected";

export type GovernanceTargetType = "USER" | "ORGANIZATION";

export type GovernanceAction = "SUSPEND" | "ACTIVATE";

export interface DiagnosisMetric {
  code: string;
  count: number;
}

export interface AnalyticsFilters {
  startDate: string;
  endDate: string;
  district: string;
}

export interface HealthMinistryOverviewStats {
  totalIncidence: number;
  trackedDiagnoses: number;
  leadingDiagnosis: string;
  reportReady: boolean;
}

export interface HealthMinistryDashboardStats {
  totalOrganisations: number;
  pendingOrganisations: number;
  totalDoctors: number;
  pendingDoctors: number;
  totalPatients: number;
  auditEvents24h: number;
}

export interface PendingOrganisationItem {
  id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface ManagedOrganisationItem {
  id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  createdAt: string | null;
  linkedTable: string | null;
  linkedRecordId: number | null;
}

export interface ManagedMedicineItem {
  id: string;
  name: string | null;
  unit: string | null;
  wholesalePrice: number | null;
  retailPrice: number | null;
  createdAt: string | null;
  inventoryLinks: number;
}

export interface ManagedMedicinePayload {
  name: string;
  unit: string;
  wholesalePrice: number;
  retailPrice: number;
}

export interface PendingDoctorItem {
  doctorId: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  specialization: string | null;
  slmcNumber: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface HealthMinistryAuditLog {
  id: number | string | null;
  timestamp: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  organisationId: number | null;
  organisationName: string | null;
  action: string | null;
  details: string | null;
}
