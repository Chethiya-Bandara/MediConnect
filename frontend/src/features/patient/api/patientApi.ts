import type {
  AvailableSlot,
  AssistantReply,
  BookingOption,
  ConsentUpdateResult,
  DashboardAppointment,
  DashboardOverview,
  DashboardRecord,
  DispensingSummary,
  PatientPharmacyOption,
  PharmacyEstimate,
  PharmacyInventoryItem,
} from "../types";
import type { ApiListResponse } from "../../../types/api";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";

export function getDashboardOverview() {
  return apiRequest<DashboardOverview>(endpoints.patient.overview);
}

export async function getAppointments() {
  const response = await apiRequest<ApiListResponse<DashboardAppointment>>(
    endpoints.patient.appointments,
  );
  return response.items;
}

export function updatePatientProfile(payload: {
  name?: string;
  medical_record_consent_default?: boolean;
}) {
  return apiRequest<DashboardOverview["user"]>(endpoints.patient.profile, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getBookingOptions() {
  const response = await apiRequest<ApiListResponse<BookingOption>>(
    endpoints.patient.bookingOptions,
  );
  return response.items;
}

export async function getAvailableSlots(doctorId: number) {
  const search = new URLSearchParams();
  search.set("doctor_id", String(doctorId));

  const response = await apiRequest<{ slots: AvailableSlot[] }>(
    `${endpoints.patient.availableSlots}?${search.toString()}`,
  );

  return Array.isArray(response.slots) ? response.slots : [];
}

export function createAppointment(payload: {
  slot_id: number;
}) {
  return apiRequest<DashboardAppointment>(endpoints.patient.appointments, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAppointment(
  appointmentId: number,
  payload: {
    start_time?: string;
    end_time?: string;
    status?: string;
  },
) {
  return apiRequest<DashboardAppointment>(
    `${endpoints.patient.appointments}/${appointmentId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function updateAppointmentConsent(
  appointmentId: number,
  granted: boolean,
) {
  return apiRequest<ConsentUpdateResult>(
    `${endpoints.patient.appointments}/${appointmentId}/consent`,
    {
      method: "POST",
      body: JSON.stringify({ granted }),
    },
  );
}

export async function getMedicalRecords() {
  const response = await apiRequest<ApiListResponse<DashboardRecord>>(
    endpoints.patient.records,
  );
  return response.items;
}

export async function searchPharmacy(query: string) {
  const search = new URLSearchParams();
  if (query.trim()) {
    search.set("query", query.trim());
  }

  const response = await apiRequest<ApiListResponse<PharmacyInventoryItem>>(
    `${endpoints.patient.pharmacy}${search.toString() ? `?${search.toString()}` : ""}`,
  );
  return response.items;
}

export async function getPatientPharmacies() {
  const response = await apiRequest<ApiListResponse<PatientPharmacyOption>>(
    endpoints.patient.pharmacies,
  );
  return response.items;
}

export function getPharmacyEstimate(
  prescriptionId: number,
  pharmacyId: number,
) {
  const search = new URLSearchParams({
    prescription_id: String(prescriptionId),
    pharmacy_id: String(pharmacyId),
  });

  return apiRequest<PharmacyEstimate>(
    `${endpoints.patient.pharmacyEstimate}?${search.toString()}`,
  );
}

export function getDispensingSummary() {
  return apiRequest<DispensingSummary>(endpoints.patient.dispensing);
}

export function askHealthAssistant(payload: {
  message: string;
  history: Array<{
    role: "assistant" | "user";
    text: string;
  }>;
}) {
  return apiRequest<AssistantReply>(endpoints.patient.assistant, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
