export type HealthMinistryAdminSection =
  | "overview"
  | "approvals"
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
