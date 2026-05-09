import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  ApprovalStatus,
  DiagnosisMetric,
  GovernanceAction,
  GovernanceTargetType,
  HealthMinistryAuditLog,
  HealthMinistryDashboardStats,
  ManagedOrganisationItem,
  ManagedMedicineItem,
  ManagedMedicinePayload,
  PendingAdminItem,
  PendingDoctorItem,
  PendingOrganisationItem,
} from "../types";

interface IncidenceRequestPayload {
  startDate: string;
  endDate: string;
  district: string;
}

interface MonthlyReportResponse {
  report?: string;
  generated_at?: string;
}

interface DashboardResponse {
  stats?: {
    total_organisations?: number;
    pending_organisations?: number;
    total_doctors?: number;
    pending_doctors?: number;
    pending_admins?: number;
    total_patients?: number;
    audit_events_24h?: number;
  };
  pending_organisations?: Array<{
    id?: string | number | null;
    name?: string | null;
    type?: string | null;
    status?: string | null;
    created_at?: string | null;
  }>;
  pending_doctors?: Array<{
    doctor_id?: string | number | null;
    user_id?: string | null;
    name?: string | null;
    preferred_name?: string | null;
    email?: string | null;
    specialization?: string | null;
    slmc_number?: string | null;
    status?: string | null;
    created_at?: string | null;
  }>;
  pending_admins?: Array<{
    profile_id?: string | number | null;
    user_id?: string | null;
    name?: string | null;
    preferred_name?: string | null;
    email?: string | null;
    role?: string | null;
    admin_role?: string | null;
    organisation_id?: string | number | null;
    organisation_name?: string | null;
    status?: string | null;
    created_at?: string | null;
  }>;
  audit_logs?: Array<{
    id?: string | number | null;
    timestamp?: string | null;
    actor_id?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    organisation_id?: number | null;
    organisation_name?: string | null;
    action?: string | null;
    details?: string | null;
  }>;
}

interface OrganisationRegistryResponse {
  items?: Array<{
    id?: string | number | null;
    name?: string | null;
    type?: string | null;
    status?: string | null;
    created_at?: string | null;
    linked_table?: string | null;
    linked_record_id?: number | null;
  }>;
}

interface MedicineRegistryResponse {
  items?: Array<{
    id?: string | number | null;
    name?: string | null;
    unit?: string | null;
    wholesale_price?: number | string | null;
    retail_price?: number | string | null;
    created_at?: string | null;
    inventory_links?: number | string | null;
  }>;
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

function normalizeDashboardStats(
  payload: DashboardResponse["stats"],
): HealthMinistryDashboardStats {
  return {
    totalOrganisations: Number(payload?.total_organisations ?? 0),
    pendingOrganisations: Number(payload?.pending_organisations ?? 0),
    totalDoctors: Number(payload?.total_doctors ?? 0),
    pendingDoctors: Number(payload?.pending_doctors ?? 0),
    pendingAdmins: Number(payload?.pending_admins ?? 0),
    totalPatients: Number(payload?.total_patients ?? 0),
    auditEvents24h: Number(payload?.audit_events_24h ?? 0),
  };
}

function normalizePendingOrganisations(
  payload: DashboardResponse["pending_organisations"],
): PendingOrganisationItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: asString(item.id) ?? "",
    name: item.name ?? null,
    type: item.type ?? null,
    status: item.status ?? null,
    createdAt: item.created_at ?? null,
  }));
}

function normalizePendingDoctors(
  payload: DashboardResponse["pending_doctors"],
): PendingDoctorItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    doctorId: asString(item.doctor_id) ?? "",
    userId: item.user_id ?? null,
    name: item.name ?? null,
    preferredName: item.preferred_name ?? item.name ?? null,
    email: item.email ?? null,
    specialization: item.specialization ?? null,
    slmcNumber: item.slmc_number ?? null,
    status: item.status ?? null,
    createdAt: item.created_at ?? null,
  }));
}

function normalizePendingAdmins(payload: DashboardResponse["pending_admins"]): PendingAdminItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    profileId: asString(item.profile_id) ?? "",
    userId: asString(item.user_id) ?? "",
    name: item.name ?? null,
    preferredName: item.preferred_name ?? item.name ?? null,
    email: item.email ?? null,
    role: item.role ?? null,
    adminRole: item.admin_role ?? null,
    organisationId: asString(item.organisation_id) ?? null,
    organisationName: item.organisation_name ?? null,
    status: item.status ?? null,
    createdAt: item.created_at ?? null,
  }));
}

function normalizeAuditLogs(payload: DashboardResponse["audit_logs"]): HealthMinistryAuditLog[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: item.id ?? null,
    timestamp: item.timestamp ?? null,
    actorId: item.actor_id ?? null,
    actorName: item.actor_name ?? null,
    actorRole: item.actor_role ?? null,
    organisationId: typeof item.organisation_id === "number" ? item.organisation_id : null,
    organisationName: item.organisation_name ?? null,
    action: item.action ?? null,
    details: item.details ?? null,
  }));
}

function normalizeManagedOrganisations(
  payload: OrganisationRegistryResponse["items"],
): ManagedOrganisationItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: asString(item.id) ?? "",
    name: item.name ?? null,
    type: item.type ?? null,
    status: item.status ?? null,
    createdAt: item.created_at ?? null,
    linkedTable: item.linked_table ?? null,
    linkedRecordId: typeof item.linked_record_id === "number" ? item.linked_record_id : null,
  }));
}

function normalizeManagedMedicines(
  payload: MedicineRegistryResponse["items"],
): ManagedMedicineItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: asString(item.id) ?? "",
    name: item.name ?? null,
    unit: item.unit ?? null,
    wholesalePrice:
      typeof item.wholesale_price === "number"
        ? item.wholesale_price
        : Number(item.wholesale_price ?? 0),
    retailPrice:
      typeof item.retail_price === "number" ? item.retail_price : Number(item.retail_price ?? 0),
    createdAt: item.created_at ?? null,
    inventoryLinks: Number(item.inventory_links ?? 0),
  }));
}

export async function getHealthMinistryDashboard() {
  const response = await apiRequest<DashboardResponse>(endpoints.healthMinistryAdmin.dashboard);

  return {
    stats: normalizeDashboardStats(response.stats),
    pendingOrganisations: normalizePendingOrganisations(response.pending_organisations),
    pendingDoctors: normalizePendingDoctors(response.pending_doctors),
    pendingAdmins: normalizePendingAdmins(response.pending_admins),
    auditLogs: normalizeAuditLogs(response.audit_logs),
  };
}

export async function getManagedOrganisations() {
  const response = await apiRequest<OrganisationRegistryResponse>(
    endpoints.healthMinistryAdmin.organisationsBase,
  );

  return normalizeManagedOrganisations(response.items);
}

export async function createManagedOrganisation(payload: {
  name: string;
  type: string;
  status: string;
}) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.organisationsBase, {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      type: payload.type,
      status: payload.status,
    }),
  });
}

export async function getManagedMedicines(search = "") {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  const response = await apiRequest<MedicineRegistryResponse>(
    `${endpoints.healthMinistryAdmin.medicinesBase}${query}`,
  );

  return normalizeManagedMedicines(response.items);
}

export async function createManagedMedicine(payload: ManagedMedicinePayload) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.medicinesBase, {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      unit: payload.unit,
      wholesale_price: payload.wholesalePrice,
      retail_price: payload.retailPrice,
    }),
  });
}

export async function updateManagedMedicine(medicineId: string, payload: ManagedMedicinePayload) {
  return apiRequest<{ message?: string }>(
    `${endpoints.healthMinistryAdmin.medicinesBase}/${encodeURIComponent(medicineId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: payload.name,
        unit: payload.unit,
        wholesale_price: payload.wholesalePrice,
        retail_price: payload.retailPrice,
      }),
    },
  );
}

export async function deleteManagedMedicine(medicineId: string) {
  return apiRequest<{ message?: string }>(
    `${endpoints.healthMinistryAdmin.medicinesBase}/${encodeURIComponent(medicineId)}`,
    {
      method: "DELETE",
    },
  );
}

function normalizeDiagnosisList(payload: unknown): DiagnosisMetric[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return [];
    }

    const code = typeof entry[0] === "string" ? entry[0] : String(entry[0] ?? "");
    const count = typeof entry[1] === "number" ? entry[1] : Number(entry[1] ?? 0);

    if (!code.trim() || Number.isNaN(count)) {
      return [];
    }

    return [{ code, count }];
  });
}

function normalizeIncidenceMap(payload: unknown): DiagnosisMetric[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  return Object.entries(payload).flatMap(([code, value]) => {
    const count = typeof value === "number" ? value : Number(value ?? 0);
    if (Number.isNaN(count)) {
      return [];
    }

    return [{ code, count }];
  });
}

export async function approveOrganization(organizationId: string, status: ApprovalStatus) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.approveOrganization, {
    method: "PUT",
    body: JSON.stringify({
      id: organizationId,
      organization_id: organizationId,
      status,
    }),
  });
}

export async function approveDoctor(doctorId: string, status: ApprovalStatus) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.approveDoctor, {
    method: "PUT",
    body: JSON.stringify({
      id: doctorId,
      doctor_id: doctorId,
      status,
    }),
  });
}

export async function updateAdminUserStatus(userId: string, status: ApprovalStatus) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.adminUserStatus, {
    method: "PUT",
    body: JSON.stringify({
      user_id: userId,
      status,
    }),
  });
}

export async function suspendEntity(
  targetId: string,
  targetType: GovernanceTargetType,
  action: GovernanceAction,
) {
  return apiRequest<{ message?: string }>(endpoints.healthMinistryAdmin.suspend, {
    method: "PUT",
    body: JSON.stringify({
      target_id: targetId,
      target_type: targetType,
      action,
    }),
  });
}

export async function getDiseaseIncidence(payload: IncidenceRequestPayload) {
  const response = await apiRequest<Record<string, number>>(
    endpoints.healthMinistryAdmin.analyticsIncidence,
    {
      method: "POST",
      body: JSON.stringify({
        start_date: payload.startDate,
        end_date: payload.endDate,
        district: payload.district || null,
      }),
    },
  );

  return normalizeIncidenceMap(response);
}

export async function getTopDiagnoses() {
  const response = await apiRequest<unknown>(endpoints.healthMinistryAdmin.analyticsTopDiagnoses);
  return normalizeDiagnosisList(response);
}

export async function generateMonthlyReport() {
  const response = await apiRequest<MonthlyReportResponse>(
    endpoints.healthMinistryAdmin.monthlyReport,
    {
      method: "POST",
    },
  );

  return {
    report: response.report ?? "No report content returned.",
    generatedAt: response.generated_at ?? null,
  };
}
