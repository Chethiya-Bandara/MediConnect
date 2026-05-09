import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import type {
  PharmacistDispenseHistoryEntry,
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
  total_items?: number | string | null;
  hospital_name?: string | null;
  organisation_name?: string | null;
  organization_name?: string | null;
  signature_valid?: boolean | null;
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
  catalog_unit?: string | null;
  pharmacy_stock?: number | string | null;
  availability_message?: string | null;
  dispensed_quantity?: number | string | null;
}

interface RawHistoryEntry {
  id?: string | number | null;
  prescription_id?: string | number | null;
  status?: string | null;
  dispensed_at?: string | null;
  pharmacist_id?: string | number | null;
  patient_dhid?: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  item_count?: number | string | null;
  estimated_total?: number | string | null;
}

interface RawPrescriptionDetail {
  prescription?: RawPrescription | null;
  items?: RawPrescriptionItem[] | null;
  dispensations?: RawHistoryEntry[] | null;
}

interface DispensePrescriptionPayload {
  pharmacyId: string;
  items: Array<{
    id: string;
    quantity: number;
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

function asBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function buildFallbackId(
  prefix: string,
  raw: RawPrescription | RawPrescriptionItem | RawHistoryEntry,
) {
  return [
    prefix,
    asString("id" in raw ? raw.id : null) ?? "unknown",
    asString("prescription_id" in raw ? raw.prescription_id : null) ?? "",
    asString("dispensed_at" in raw ? raw.dispensed_at : null) ?? "",
  ]
    .filter(Boolean)
    .join("-");
}

function normalizePrescription(raw: RawPrescription): PharmacistPrescriptionSummary {
  return {
    id: asString(raw.id) ?? buildFallbackId("rx", raw),
    status: raw.status?.toUpperCase() ?? "UNKNOWN",
    patientDhid: raw.patient_dhid ?? raw.dhid ?? null,
    patientName: raw.patient_name ?? null,
    doctorName: raw.doctor_name ?? null,
    issuedAt: raw.issued_at ?? raw.created_at ?? null,
    expiresAt: raw.expires_at ?? null,
    totalItems: asNumber(raw.total_items),
    sourceName: raw.hospital_name ?? raw.organisation_name ?? raw.organization_name ?? null,
    signatureValid: asBoolean(raw.signature_valid),
  };
}

function normalizeItem(raw: RawPrescriptionItem): PharmacistPrescriptionItem {
  const prescribedQuantity = asNumber(raw.quantity ?? raw.quantity_prescribed);
  const dispensedQuantity = asNumber(raw.dispensed_quantity) ?? 0;
  const remainingQuantity =
    prescribedQuantity === null ? null : Math.max(prescribedQuantity - dispensedQuantity, 0);

  return {
    id: asString(raw.id) ?? buildFallbackId("item", raw),
    medicineName: raw.medicine_name ?? raw.drug_name ?? "Unnamed medicine",
    dosage: raw.dosage ?? null,
    quantity: prescribedQuantity,
    instructions: raw.instructions ?? null,
    unitPrice: asNumber(raw.unit_price ?? raw.price),
    catalogUnit: raw.catalog_unit ?? null,
    pharmacyStock: asNumber(raw.pharmacy_stock),
    availabilityMessage: raw.availability_message ?? null,
    dispensedQuantity,
    remainingQuantity,
  };
}

function normalizeHistory(raw: RawHistoryEntry): PharmacistDispenseHistoryEntry {
  return {
    id: asString(raw.id) ?? buildFallbackId("history", raw),
    prescriptionId: asString(raw.prescription_id) ?? "unknown-prescription",
    status: raw.status?.toUpperCase() ?? "UNKNOWN",
    dispensedAt: raw.dispensed_at ?? null,
    pharmacistId: asString(raw.pharmacist_id),
    patientDhid: raw.patient_dhid ?? null,
    patientName: raw.patient_name ?? null,
    doctorName: raw.doctor_name ?? null,
    itemCount: asNumber(raw.item_count),
    estimatedTotal: asNumber(raw.estimated_total),
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

  return {
    prescription: normalizePrescription(response.prescription ?? {}),
    items: (response.items ?? []).map((item) => normalizeItem(item)),
    dispensationHistory: (response.dispensations ?? []).map((item) => normalizeHistory(item)),
  } satisfies PharmacistPrescriptionDetail;
}

export async function listPharmacistHistory() {
  const response = await apiRequest<RawHistoryEntry[]>(endpoints.pharmacist.history);
  return response.map((item) => normalizeHistory(item));
}

export async function dispensePrescription(
  prescriptionId: string,
  payload: DispensePrescriptionPayload,
) {
  return apiRequest<{ message?: string; status?: string }>(
    `${endpoints.pharmacist.dispense}/${prescriptionId}`,
    {
      method: "POST",
      body: JSON.stringify({
        pharmacy_id: payload.pharmacyId,
        items: payload.items,
      }),
    },
  );
}
