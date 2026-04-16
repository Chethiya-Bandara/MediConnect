import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  PharmacistPrescriptionDetail,
  PharmacistPrescriptionItem,
  PharmacistPrescriptionSummary,
} from "../types";

interface RawPrescription {
  id?: string | number | null;
  status?: string | null;
  patient_dhid?: string | null;
  dhid?: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  created_at?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  total_items?: number | null;
}

interface RawPrescriptionItem {
  id?: string | number | null;
  medicine_name?: string | null;
  drug_name?: string | null;
  dosage?: string | null;
  quantity?: number | string | null;
  quantity_prescribed?: number | string | null;
  instructions?: string | null;
  unit_price?: number | string | null;
  price?: number | string | null;
}

interface RawPrescriptionDetail {
  prescription?: RawPrescription | null;
  items?: RawPrescriptionItem[] | null;
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

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizePrescription(
  raw: RawPrescription,
  fallbackItemsCount?: number,
): PharmacistPrescriptionSummary {
  return {
    id: asString(raw.id) ?? `rx-${Math.random().toString(36).slice(2, 8)}`,
    status: raw.status?.toUpperCase() ?? "UNKNOWN",
    patientDhid: raw.patient_dhid ?? raw.dhid ?? null,
    patientName: raw.patient_name ?? null,
    doctorName: raw.doctor_name ?? null,
    issuedAt: raw.issued_at ?? raw.created_at ?? null,
    expiresAt: raw.expires_at ?? null,
    totalItems: raw.total_items ?? fallbackItemsCount ?? null,
  };
}

function normalizeItem(raw: RawPrescriptionItem): PharmacistPrescriptionItem {
  return {
    id: asString(raw.id) ?? `item-${Math.random().toString(36).slice(2, 8)}`,
    medicineName: raw.medicine_name ?? raw.drug_name ?? "Unnamed medicine",
    dosage: raw.dosage ?? null,
    quantity: asNumber(raw.quantity ?? raw.quantity_prescribed),
    instructions: raw.instructions ?? null,
    unitPrice: asNumber(raw.unit_price ?? raw.price),
  };
}

export async function listPharmacistPrescriptions() {
  const response = await apiRequest<RawPrescription[]>(endpoints.pharmacist.prescriptions);
  return response.map((item) => normalizePrescription(item));
}

export async function getPharmacistPrescriptionDetail(prescriptionId: string) {
  const response = await apiRequest<RawPrescriptionDetail>(
    `${endpoints.pharmacist.prescriptions}/${prescriptionId}`,
  );

  const items = (response.items ?? []).map((item) => normalizeItem(item));
  return {
    prescription: normalizePrescription(response.prescription ?? {}, items.length),
    items,
  } satisfies PharmacistPrescriptionDetail;
}

export async function dispensePrescription(
  prescriptionId: string,
  pharmacistId: string,
) {
  return apiRequest<{ message?: string }>(
    `${endpoints.pharmacist.dispense}/${prescriptionId}?pharmacist_id=${encodeURIComponent(pharmacistId)}`,
    {
      method: "POST",
    },
  );
}
