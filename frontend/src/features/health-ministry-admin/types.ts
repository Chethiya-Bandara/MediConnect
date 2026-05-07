export type HealthMinistryAdminSection =
  | "overview"
  | "approvals"
  | "medicines"
  | "analytics"
  | "users"
  | "anomalies"
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

export type AnomalyFlagStatus = "open" | "resolved" | "dismissed";

export interface AnomalyFlag {
  id: number;
  eventType: string;
  sourceIp: string | null;
  eventCount: number;
  windowSeconds: number;
  threshold: number;
  flaggedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  status: AnomalyFlagStatus;
}

export type DeletionEntityType =
  | "patient"
  | "doctor"
  | "pharmacist"
  | "hospital_admin"
  | "medicine"
  | "hospital"
  | "pharmacy"
  | "organisation";

export type DeletionRequestStatus = "pending" | "approved" | "expired" | "cancelled";

export interface DeletionRequest {
  id: string;
  entityType: DeletionEntityType;
  entityId: string;
  entityDisplayName: string | null;
  status: DeletionRequestStatus;
  reason: string | null;
  requestedAt: string | null;
  expiresAt: string | null;
  approvedAt: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
  canApprove: boolean;
}

export interface RegistryPersonItem {
  id: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  status: string | null;
  createdAt: string | null;
  // doctor-specific
  slmcNumber?: string | null;
  specialization?: string | null;
  // patient-specific
  dhid?: string | null;
  // pharmacist-specific
  licenseNo?: string | null;
  // hospital admin-specific
  adminRole?: string | null;
  organisationId?: number | string | null;
}
