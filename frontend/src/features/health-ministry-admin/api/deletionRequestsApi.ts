import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  DeletionEntityType,
  DeletionRequest,
  DeletionRequestStatus,
  RegistryPersonItem,
} from "../types";

interface RawDeletionRequest {
  id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_display_name?: string | null;
  status?: string | null;
  reason?: string | null;
  requested_at?: string | null;
  expires_at?: string | null;
  approved_at?: string | null;
  requested_by_name?: string | null;
  approved_by_name?: string | null;
  can_approve?: boolean | null;
}

interface RawPersonItem {
  id?: string | null;
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  created_at?: string | null;
  slmc_number?: string | null;
  specialization?: string | null;
  dhid?: string | null;
  license_no?: string | null;
  admin_role?: string | null;
  organisation_id?: number | string | null;
  organisation_name?: string | null;
}

function normalizeDeletionRequest(raw: RawDeletionRequest): DeletionRequest {
  return {
    id: raw.id ?? "",
    entityType: (raw.entity_type ?? "patient") as DeletionEntityType,
    entityId: raw.entity_id ?? "",
    entityDisplayName: raw.entity_display_name ?? null,
    status: (raw.status ?? "pending") as DeletionRequestStatus,
    reason: raw.reason ?? null,
    requestedAt: raw.requested_at ?? null,
    expiresAt: raw.expires_at ?? null,
    approvedAt: raw.approved_at ?? null,
    requestedByName: raw.requested_by_name ?? null,
    approvedByName: raw.approved_by_name ?? null,
    canApprove: raw.can_approve ?? false,
  };
}

function normalizePersonItem(raw: RawPersonItem): RegistryPersonItem {
  return {
    id: raw.id ?? "",
    userId: raw.user_id ?? null,
    name: raw.name ?? null,
    email: raw.email ?? null,
    status: raw.status ?? null,
    createdAt: raw.created_at ?? null,
    slmcNumber: raw.slmc_number ?? null,
    specialization: raw.specialization ?? null,
    dhid: raw.dhid ?? null,
    licenseNo: raw.license_no ?? null,
    adminRole: raw.admin_role ?? null,
    organisationId: raw.organisation_id ?? null,
    organisationName: raw.organisation_name ?? null,
  };
}

export async function listDeletionRequests(): Promise<DeletionRequest[]> {
  const response = await apiRequest<{ items?: RawDeletionRequest[] }>(
    endpoints.healthMinistryAdmin.deletionRequestsBase,
  );
  return (response.items ?? []).map(normalizeDeletionRequest);
}

export async function createDeletionRequest(payload: {
  entityType: DeletionEntityType;
  entityId: string;
  entityDisplayName?: string;
  reason?: string;
}): Promise<{ message?: string; requestId?: string }> {
  const response = await apiRequest<{ message?: string; request_id?: string }>(
    endpoints.healthMinistryAdmin.deletionRequestsBase,
    {
      method: "POST",
      body: JSON.stringify({
        entity_type: payload.entityType,
        entity_id: payload.entityId,
        entity_display_name: payload.entityDisplayName ?? null,
        reason: payload.reason ?? null,
      }),
    },
  );
  return { message: response.message, requestId: response.request_id ?? undefined };
}

export async function approveDeletionRequest(requestId: string): Promise<{ message?: string }> {
  return apiRequest<{ message?: string }>(
    `${endpoints.healthMinistryAdmin.deletionRequestsBase}/${encodeURIComponent(requestId)}/approve`,
    { method: "POST" },
  );
}

export async function cancelDeletionRequest(requestId: string): Promise<{ message?: string }> {
  return apiRequest<{ message?: string }>(
    `${endpoints.healthMinistryAdmin.deletionRequestsBase}/${encodeURIComponent(requestId)}/cancel`,
    { method: "POST" },
  );
}

export async function getPatientsRegistry(): Promise<RegistryPersonItem[]> {
  const response = await apiRequest<{ items?: RawPersonItem[] }>(
    endpoints.healthMinistryAdmin.patientsRegistry,
  );
  return (response.items ?? []).map(normalizePersonItem);
}

export async function getDoctorsRegistry(): Promise<RegistryPersonItem[]> {
  const response = await apiRequest<{ items?: RawPersonItem[] }>(
    endpoints.healthMinistryAdmin.doctorsRegistry,
  );
  return (response.items ?? []).map(normalizePersonItem);
}

export async function getPharmacistsRegistry(): Promise<RegistryPersonItem[]> {
  const response = await apiRequest<{ items?: RawPersonItem[] }>(
    endpoints.healthMinistryAdmin.pharmacistsRegistry,
  );
  return (response.items ?? []).map(normalizePersonItem);
}

export async function getHospitalAdminsRegistry(): Promise<RegistryPersonItem[]> {
  const response = await apiRequest<{ items?: RawPersonItem[] }>(
    endpoints.healthMinistryAdmin.hospitalAdminsRegistry,
  );
  return (response.items ?? []).map(normalizePersonItem);
}
