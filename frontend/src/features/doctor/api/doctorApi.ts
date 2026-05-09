import type {
  DoctorAssistantReply,
  DoctorAffiliationHospitalOption,
  DoctorAvailabilitySlot,
  DoctorDashboardData,
  DoctorDiseaseCatalogItem,
  DoctorMedicineCatalogItem,
} from "../types";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";

export function getDoctorDashboard(activeAppointmentId?: number | null) {
  const path = activeAppointmentId
    ? `${endpoints.doctor.dashboard}?active_appointment_id=${encodeURIComponent(activeAppointmentId)}`
    : endpoints.doctor.dashboard;
  return apiRequest<DoctorDashboardData>(path);
}

export function updateDoctorProfile(payload: {
  preferred_name: string;
  specialization: string;
  slmc_number: string;
}) {
  return apiRequest<{
    user: DoctorDashboardData["user"];
    doctor: Pick<DoctorDashboardData["doctor"], "id" | "specialization" | "slmc_number">;
  }>(endpoints.doctor.profile, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function submitDoctorEncounter(payload: {
  patient_id: number;
  appointment_id?: number;
  diagnosis: string;
  encounter_type: string;
  clinical_notes: string;
  prescription_items: Array<{
    medicine_id?: number | null;
    medicine_name: string;
    dosage: string;
    duration: string;
  }>;
}) {
  return apiRequest<{
    success: boolean;
    encounter_id: number;
    prescription_id: number | null;
    message: string;
  }>(endpoints.doctor.encounters, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function askDoctorAssistant(payload: {
  message: string;
  patient_id?: number;
  history: Array<{
    role: "assistant" | "user";
    text: string;
  }>;
}) {
  return apiRequest<DoctorAssistantReply>(endpoints.doctor.assistant, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchDoctorMedicines(query: string) {
  const response = await apiRequest<{ items?: DoctorMedicineCatalogItem[] }>(
    `${endpoints.doctor.medicinesSearch}?query=${encodeURIComponent(query)}`,
  );
  return Array.isArray(response.items) ? response.items : [];
}

export async function searchDoctorDiseases(query: string) {
  const response = await apiRequest<{ items?: DoctorDiseaseCatalogItem[] }>(
    `${endpoints.doctor.diseasesSearch}?query=${encodeURIComponent(query)}`,
  );
  return Array.isArray(response.items) ? response.items : [];
}

export async function getDoctorAvailability(slotDate?: string, hospitalId?: number | "") {
  const search = new URLSearchParams();
  if (slotDate) {
    search.set("slot_date", slotDate);
  }
  if (hospitalId) {
    search.set("hospital_id", String(hospitalId));
  }
  const path = search.toString()
    ? `${endpoints.doctor.availability}?${search.toString()}`
    : endpoints.doctor.availability;
  const response = await apiRequest<{ slots: DoctorAvailabilitySlot[] }>(path);
  return Array.isArray(response.slots) ? response.slots : [];
}

export function createDoctorAvailability(payload: {
  start_time: string;
  end_time: string;
  slot_date?: string;
  hospital_id?: number;
  slot_duration_minutes?: number;
}) {
  return apiRequest<{
    success: boolean;
    created_count?: number;
    slot: DoctorAvailabilitySlot | null;
    slots?: DoctorAvailabilitySlot[];
  }>(endpoints.doctor.availability, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteDoctorAvailability(slotId: number) {
  return apiRequest<{ success: boolean }>(`${endpoints.doctor.availability}/${slotId}`, {
    method: "DELETE",
  });
}

export function updateDoctorAvailability(
  slotId: number,
  payload: { start_time: string; end_time: string },
) {
  return apiRequest<{ success: boolean; slot: DoctorAvailabilitySlot | null }>(
    `${endpoints.doctor.availability}/${slotId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function getDoctorAffiliationHospitals() {
  const response = await apiRequest<{ hospitals: DoctorAffiliationHospitalOption[] }>(
    endpoints.doctor.affiliationHospitals,
  );
  return Array.isArray(response.hospitals) ? response.hospitals : [];
}

export function requestDoctorAffiliation(payload: { hospital_id: number }) {
  return apiRequest<{ message: string; affiliation_id: number }>(
    endpoints.doctor.affiliationRequest,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function revokeDoctorAffiliation(payload: { affiliation_id: number }) {
  return apiRequest<{ message: string; affiliation_id: number }>(
    endpoints.doctor.affiliationRevoke,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}
