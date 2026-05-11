export interface DashboardAppointment {
  id: number;
  status: string;
  start_time: string;
  end_time: string;
  consent: {
    granted: boolean;
    last_updated: string | null;
    status: string;
  };
  doctor: {
    id: number;
    name: string;
    specialization: string | null;
    email: string | null;
  };
  organisation: {
    id: number;
    name: string;
    type: string | null;
    status: string | null;
  };
}

export interface HealthSnapshot {
  id: number;
  bmi: string | null;
  blood_sugar: string | null;
  cholesterol: string | null;
  blood_pressure: string | null;
  allergies: string | null;
  checked_at: string | null;
  source_role: string | null;
}

export interface MedicalRecordAttachment {
  id: number;
  file_name: string | null;
  file_url: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  created_at: string | null;
}

export interface DashboardOverview {
  user: {
    id: string;
    email: string;
    name: string | null;
    legal_name?: string | null;
    preferred_name?: string | null;
    address?: string | null;
  };
  patient: {
    id: number;
    dhid: string;
    created_at: string | null;
    medical_record_consent_default: boolean;
    medical_record_consent_last_updated: string | null;
    health_snapshot?: HealthSnapshot | null;
  };
  stats: {
    total_appointments: number;
    upcoming_appointments: number;
    medical_records: number;
    active_prescriptions: number;
    pharmacy_items_indexed: number;
  };
  next_appointment: DashboardAppointment | null;
  recent_record: {
    id: number;
    created_at: string | null;
    notes: string | null;
    appointment: {
      id?: number;
      start_time?: string;
      end_time?: string;
      status?: string;
    } | null;
  } | null;
}

export interface BookingOption {
  doctor_id: number;
  organisation_id: number;
  doctor_name: string;
  specialization: string | null;
  organisation_name: string;
  status: string;
}

export interface AvailableSlot {
  id: number;
  doctor_id: number;
  organisation_id: number | null;
  start_time: string;
  end_time: string;
  is_booked: boolean;
}

export interface PrescriptionItem {
  id: number;
  medicine_name: string;
  dosage: string;
  unit?: string | null;
  quantity: string;
  instructions: string;
}

export interface DashboardRecord {
  id: number;
  created_at: string | null;
  notes: string | null;
  title?: string | null;
  source?: "doctor" | "patient";
  health_snapshot?: HealthSnapshot | null;
  attachments?: MedicalRecordAttachment[];
  doctor: {
    id: number;
    name: string;
    specialization: string | null;
  };
  appointment: {
    id: number | null;
    start_time: string | null;
    end_time: string | null;
    status: string | null;
  };
  organisation: {
    id: number | null;
    name: string | null;
  };
  prescriptions: Array<{
    id: number;
    status: string;
    created_at: string | null;
    items: PrescriptionItem[];
  }>;
}

export interface PharmacyInventoryItem {
  id: number;
  medicine_name: string;
  stock_quantity: number;
  unit_price: number | string;
  availability: string;
  pharmacy: {
    id: number;
    name: string;
    organisation_status: string | null;
  };
}

export interface PatientPharmacyOption {
  id: number;
  name: string;
  organisation_status: string | null;
  indexed_items: number;
}

export interface PharmacyEstimateItem {
  id: number;
  inventory_id: number | null;
  medicine_name: string;
  dosage: string | null;
  unit?: string | null;
  quantity: string;
  quantity_value: number;
  instructions: string | null;
  availability_status: "available" | "not_listed" | "out_of_stock" | "insufficient_stock";
  availability_label: string;
  stock_quantity: number;
  unit_price: number | null;
  estimated_total: number | null;
  note: string | null;
}

export interface PharmacyEstimate {
  prescription: {
    id: number;
    status: string;
    created_at: string | null;
    doctor_name: string | null;
  };
  pharmacy: {
    id: number;
    name: string;
    organisation_status: string | null;
  };
  summary: {
    estimated_total: number;
    included_items: number;
    excluded_items: number;
    unavailable_items: number;
  };
  items: PharmacyEstimateItem[];
}

export interface AssistantChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  created_at: string;
}

export interface AssistantReply {
  answer: string;
  source: "gemini_edge" | "patient_fallback";
}

export interface ConsentUpdateResult {
  appointment_id: number;
  granted: boolean;
  status: string;
  last_updated: string;
}

export interface DispensingLineItem {
  id: number;
  medicine_name: string | null;
  dosage: string | null;
  unit?: string | null;
  instructions: string | null;
  quantity_dispensed: number;
  price: number;
}

export interface DispensingRecord {
  id: number;
  prescription_id: number;
  status: string;
  created_at: string | null;
  total_price: number;
  billed_total: number;
  pharmacy: {
    id: number;
    name: string;
  };
  line_items: DispensingLineItem[];
}

export interface DispensingSummary {
  stats: {
    dispensing_events: number;
    prescriptions_dispensed: number;
    total_billed: number;
  };
  items: DispensingRecord[];
}
