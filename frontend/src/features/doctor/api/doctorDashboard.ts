import type { DoctorAssistantReply, DoctorDashboardData } from "../types";

const API_URL = "http://localhost:8000";

interface ApiErrorPayload {
  detail?: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");

  if (!token) {
    throw new Error("Missing login token");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ApiErrorPayload | T) : null;

  if (!response.ok) {
    const message =
      (payload as ApiErrorPayload | null)?.detail ||
      (payload as ApiErrorPayload | null)?.message ||
      "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

export function getDoctorDashboard() {
  return request<DoctorDashboardData>("/doctor/dashboard");
}

export function updateDoctorProfile(payload: {
  name: string;
  specialization: string;
  slmc_number: string;
}) {
  return request<{
    user: DoctorDashboardData["user"];
    doctor: Pick<DoctorDashboardData["doctor"], "id" | "specialization" | "slmc_number">;
  }>("/doctor/dashboard/profile", {
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
  return request<{
    success: boolean;
    encounter_id: number;
    prescription_id: number | null;
    message: string;
  }>("/doctor/dashboard/encounters/submit", {
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
  return request<DoctorAssistantReply>("/doctor/dashboard/assistant/respond", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
