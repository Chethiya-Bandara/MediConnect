import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  ActiveStaffMember,
  AffiliationDecisionStatus,
  CreateAvailabilityPayload,
  HospitalAuditLog,
  HospitalAvailabilitySlot,
  HospitalDashboardStats,
  InviteDoctorPayload,
  PendingAffiliationItem,
  PendingInvitationItem,
  UpdateAvailabilityPayload,
} from "../types";

interface RawAvailabilitySlot {
  id?: string | number | null;
  doctor_id?: string | number | null;
  hospital_id?: string | number | null;
  start_time?: string | null;
  end_time?: string | null;
  created_at?: string | null;
  is_booked?: boolean | null;
}

interface HospitalDashboardResponse {
  hospital?: {
    id?: string | number | null;
    name?: string | null;
    type?: string | null;
    status?: string | null;
  };
  stats?: {
    active_doctors?: number;
    pending_affiliations?: number;
    pending_invitations?: number;
    appointments_today?: number;
    capacity_load?: number;
    total_slots_today?: number;
    booked_slots_today?: number;
  };
  pending_affiliations?: Array<{
    affiliation_id?: string | number | null;
    doctor_id?: string | number | null;
    doctor_name?: string | null;
    doctor_email?: string | null;
    specialization?: string | null;
    slmc_number?: string | null;
    status?: string | null;
    requested_at?: string | null;
  }>;
  pending_invitations?: Array<{
    id?: string | number | null;
    doctor_email?: string | null;
    status?: string | null;
    created_at?: string | null;
  }>;
  active_staff?: Array<{
    affiliation_id?: string | number | null;
    doctor_id?: string | number | null;
    doctor_name?: string | null;
    doctor_email?: string | null;
    specialization?: string | null;
    slmc_number?: string | null;
    status?: string | null;
    joined_at?: string | null;
  }>;
  audit_logs?: Array<{
    id?: string | number | null;
    timestamp?: string | null;
    actor_id?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    action?: string | null;
    details?: string | null;
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

function normalizeAvailabilitySlot(raw: RawAvailabilitySlot): HospitalAvailabilitySlot {
  return {
    id: asString(raw.id) ?? `slot-${Math.random().toString(36).slice(2, 8)}`,
    doctorId: asString(raw.doctor_id),
    hospitalId: asString(raw.hospital_id),
    dayOfWeek: raw.start_time
      ? new Date(raw.start_time).toLocaleDateString("en-LK", { weekday: "long" })
      : null,
    startTime: raw.start_time ?? null,
    endTime: raw.end_time ?? null,
    createdAt: raw.created_at ?? null,
    isBooked: Boolean(raw.is_booked),
  };
}

function normalizeDashboardStats(
  payload: HospitalDashboardResponse["stats"],
): HospitalDashboardStats {
  return {
    activeDoctors: Number(payload?.active_doctors ?? 0),
    pendingAffiliations: Number(payload?.pending_affiliations ?? 0),
    pendingInvitations: Number(payload?.pending_invitations ?? 0),
    appointmentsToday: Number(payload?.appointments_today ?? 0),
    capacityLoad: Number(payload?.capacity_load ?? 0),
    totalSlotsToday: Number(payload?.total_slots_today ?? 0),
    bookedSlotsToday: Number(payload?.booked_slots_today ?? 0),
  };
}

function normalizePendingAffiliations(
  payload: HospitalDashboardResponse["pending_affiliations"],
): PendingAffiliationItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    affiliationId: asString(item.affiliation_id) ?? "",
    doctorId: asString(item.doctor_id) ?? "",
    doctorName: item.doctor_name ?? null,
    doctorEmail: item.doctor_email ?? null,
    specialization: item.specialization ?? null,
    slmcNumber: item.slmc_number ?? null,
    status: item.status ?? null,
    requestedAt: item.requested_at ?? null,
  }));
}

function normalizePendingInvitations(
  payload: HospitalDashboardResponse["pending_invitations"],
): PendingInvitationItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: asString(item.id) ?? "",
    doctorEmail: item.doctor_email ?? null,
    status: item.status ?? null,
    createdAt: item.created_at ?? null,
  }));
}

function normalizeActiveStaff(
  payload: HospitalDashboardResponse["active_staff"],
): ActiveStaffMember[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    affiliationId: asString(item.affiliation_id) ?? "",
    doctorId: asString(item.doctor_id) ?? "",
    doctorName: item.doctor_name ?? null,
    doctorEmail: item.doctor_email ?? null,
    specialization: item.specialization ?? null,
    slmcNumber: item.slmc_number ?? null,
    status: item.status ?? null,
    joinedAt: item.joined_at ?? null,
  }));
}

function normalizeAuditLogs(payload: HospitalDashboardResponse["audit_logs"]): HospitalAuditLog[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => ({
    id: item.id ?? null,
    timestamp: item.timestamp ?? null,
    actorId: item.actor_id ?? null,
    actorName: item.actor_name ?? null,
    actorRole: item.actor_role ?? null,
    action: item.action ?? null,
    details: item.details ?? null,
  }));
}

export async function getHospitalAdminDashboard() {
  const response = await apiRequest<HospitalDashboardResponse>(endpoints.hospitalAdmin.dashboard);

  return {
    hospital: {
      id: asString(response.hospital?.id),
      name: response.hospital?.name ?? null,
      type: response.hospital?.type ?? null,
      status: response.hospital?.status ?? null,
    },
    stats: normalizeDashboardStats(response.stats),
    pendingAffiliations: normalizePendingAffiliations(response.pending_affiliations),
    pendingInvitations: normalizePendingInvitations(response.pending_invitations),
    activeStaff: normalizeActiveStaff(response.active_staff),
    auditLogs: normalizeAuditLogs(response.audit_logs),
  };
}

export async function getDoctorAvailability(doctorId: string, slotDate?: string) {
  const response = await apiRequest<RawAvailabilitySlot[] | { slots?: RawAvailabilitySlot[] }>(
    `${endpoints.hospitalAdmin.availabilityBase}/${encodeURIComponent(doctorId)}${
      slotDate ? `?slot_date=${encodeURIComponent(slotDate)}` : ""
    }`,
  );
  const items = Array.isArray(response) ? response : response.slots;
  return (items ?? []).map((item) => normalizeAvailabilitySlot(item));
}

export async function createAvailabilitySlot(payload: CreateAvailabilityPayload) {
  return apiRequest<{ message?: string; created_count?: number; slots?: RawAvailabilitySlot[] }>(
    endpoints.hospitalAdmin.availabilityBase,
    {
      method: "POST",
      body: JSON.stringify({
        doctor_id: payload.doctorId,
        slot_date: payload.slotDate,
        start_time: payload.startTime,
        end_time: payload.endTime,
        slot_duration_minutes: payload.slotDurationMinutes,
      }),
    },
  );
}

export function updateAvailabilitySlot(payload: UpdateAvailabilityPayload) {
  return apiRequest<{ success: boolean; slot: RawAvailabilitySlot | null }>(
    `${endpoints.hospitalAdmin.availabilityBase}/${encodeURIComponent(payload.slotId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        start_time: payload.startTime,
        end_time: payload.endTime,
      }),
    },
  );
}

export function deleteAvailabilitySlot(slotId: string) {
  return apiRequest<{ success: boolean }>(
    `${endpoints.hospitalAdmin.availabilityBase}/${encodeURIComponent(slotId)}`,
    {
      method: "DELETE",
    },
  );
}

export function cancelBookedAvailabilitySlot(slotId: string) {
  return apiRequest<{ success: boolean; message?: string; appointment_id?: number | null }>(
    `${endpoints.hospitalAdmin.availabilityCancelBooking}/${encodeURIComponent(slotId)}/cancel-booking`,
    {
      method: "POST",
    },
  );
}

export async function inviteDoctor(payload: InviteDoctorPayload) {
  return apiRequest<{ message?: string }>(endpoints.hospitalAdmin.invite, {
    method: "POST",
    body: JSON.stringify({
      doctor_email: payload.doctorEmail,
    }),
  });
}

export async function decideAffiliation(affiliationId: string, status: AffiliationDecisionStatus) {
  return apiRequest<{ message?: string }>(endpoints.hospitalAdmin.affiliationDecision, {
    method: "PUT",
    body: JSON.stringify({
      affiliation_id: affiliationId,
      status,
    }),
  });
}

export async function revokeAffiliation(affiliationId: string) {
  return apiRequest<{ message?: string }>(endpoints.hospitalAdmin.affiliationRevoke, {
    method: "PUT",
    body: JSON.stringify({
      affiliation_id: affiliationId,
    }),
  });
}
