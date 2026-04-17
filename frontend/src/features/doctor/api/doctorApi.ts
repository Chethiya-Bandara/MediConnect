import type {
  DoctorAssistantReply,
  DoctorAvailabilitySlot,
  DoctorDashboardData,
} from "../types";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";

export function getDoctorDashboard() {
  return apiRequest<DoctorDashboardData>(endpoints.doctor.dashboard);
}

export function updateDoctorProfile(payload: {
  name: string;
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

export async function getDoctorAvailability() {
  const response = await apiRequest<{ slots: DoctorAvailabilitySlot[] }>(
    endpoints.doctor.availability,
  );
  return Array.isArray(response.slots) ? response.slots : [];
}

export function createDoctorAvailability(payload: {
  start_time: string;
  end_time: string;
}) {
  return apiRequest<{ success: boolean; slot: DoctorAvailabilitySlot | null }>(
    endpoints.doctor.availability,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteDoctorAvailability(slotId: number) {
  return apiRequest<{ success: boolean }>(
    `${endpoints.doctor.availability}/${slotId}`,
    {
      method: "DELETE",
    },
  );
}
