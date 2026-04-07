import type {
  AssistantReply,
  BookingOption,
  ConsentUpdateResult,
  DashboardAppointment,
  DashboardOverview,
  DashboardRecord,
  DispensingSummary,
  PharmacyInventoryItem,
} from "../types";

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

export function getDashboardOverview() {
  return request<DashboardOverview>("/patient/dashboard/overview");
}

export async function getAppointments() {
  const response = await request<{ items: DashboardAppointment[] }>(
    "/patient/dashboard/appointments",
  );
  return response.items;
}

export function updatePatientProfile(payload: { name: string }) {
  return request<DashboardOverview["user"]>("/patient/dashboard/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getBookingOptions() {
  const response = await request<{ items: BookingOption[] }>(
    "/patient/dashboard/booking-options",
  );
  return response.items;
}

export function createAppointment(payload: {
  doctor_id: number;
  organisation_id: number;
  start_time: string;
  end_time: string;
}) {
  return request<DashboardAppointment>("/patient/dashboard/appointments", {
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
  return request<DashboardAppointment>(
    `/patient/dashboard/appointments/${appointmentId}`,
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
  return request<ConsentUpdateResult>(
    `/patient/dashboard/appointments/${appointmentId}/consent`,
    {
      method: "POST",
      body: JSON.stringify({ granted }),
    },
  );
}

export async function getMedicalRecords() {
  const response = await request<{ items: DashboardRecord[] }>(
    "/patient/dashboard/records",
  );
  return response.items;
}

export async function searchPharmacy(query: string) {
  const search = new URLSearchParams();
  if (query.trim()) {
    search.set("query", query.trim());
  }

  const response = await request<{ items: PharmacyInventoryItem[] }>(
    `/patient/dashboard/pharmacy${search.toString() ? `?${search.toString()}` : ""}`,
  );
  return response.items;
}

export function getDispensingSummary() {
  return request<DispensingSummary>("/patient/dashboard/dispensing");
}

export function askHealthAssistant(payload: {
  message: string;
  history: Array<{
    role: "assistant" | "user";
    text: string;
  }>;
}) {
  return request<AssistantReply>("/patient/dashboard/assistant/respond", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
