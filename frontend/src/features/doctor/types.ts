export interface DoctorScheduleItem {
  id: number;
  status: string;
  start_time: string | null;
  end_time: string | null;
  patient: {
    id: number;
    name: string;
    dhid: string | null;
    email: string | null;
  };
  organisation: {
    id: number | null;
    name: string;
    type: string | null;
    status: string | null;
  };
  consent: {
    granted: boolean;
    status: string;
    last_updated: string | null;
  };
  encounter: {
    id: number;
    created_at: string | null;
  } | null;
}

export interface DoctorHistoryItem {
  id: number;
  created_at: string | null;
  notes: string | null;
  doctor_name: string;
  organisation_name: string | null;
  appointment_status: string | null;
}

export interface DoctorArchiveItem {
  id: string;
  title: string;
  type: "encounter" | "prescription";
  created_at: string | null;
  meta: string;
}

export interface DoctorPrescriptionItem {
  id: number;
  medicine_id?: number | null;
  medicine_name: string | null;
  dosage: string | null;
  quantity: string | null;
  instructions: string | null;
}

export interface DoctorArchivePrescriptionDetail {
  id: number;
  encounter_id?: number | null;
  status: string | null;
  created_at: string | null;
  items: DoctorPrescriptionItem[];
}

export interface DoctorArchiveEncounterDetail {
  id: number;
  created_at: string | null;
  notes: string | null;
  prescriptions: DoctorArchivePrescriptionDetail[];
}

export interface DoctorPatientHistoryResponse {
  patient_id: number;
  doctor_id: number;
  consent: string;
  encounters: DoctorArchiveEncounterDetail[];
}

export interface DoctorHealthSnapshot {
  id: number;
  bmi: string | null;
  blood_sugar: string | null;
  cholesterol: string | null;
  blood_pressure: string | null;
  allergies: string | null;
  checked_at: string | null;
  source_role: string | null;
}

export interface DoctorActivePatient {
  patient: {
    id: number;
    name: string;
    dhid: string | null;
    email: string | null;
    created_at: string | null;
  };
  appointment: DoctorScheduleItem;
  summary: {
    medical_records: number;
    active_prescriptions: number;
    last_encounter_at: string | null;
    doctor_has_previous_records: boolean;
  };
  latest_record: {
    id: number;
    created_at: string | null;
    notes: string | null;
  } | null;
  latest_prescription: {
    id: number;
    status: string;
    created_at: string | null;
    items: DoctorPrescriptionItem[];
  } | null;
  allergies: string[];
  health_snapshot?: DoctorHealthSnapshot | null;
  history: DoctorHistoryItem[];
  archives: DoctorArchiveItem[];
}

export interface DoctorDashboardData {
  user: {
    id: string;
    email: string;
    name: string | null;
    legal_name?: string | null;
    preferred_name?: string | null;
    address?: string | null;
  };
  doctor: {
    id: number;
    created_at: string | null;
    specialization: string | null;
    slmc_number: string | null;
  };
  stats: {
    scheduled_today: number;
    patients_seen_today: number;
    pending_reports: number;
    recorded_encounters: number;
    active_affiliations: number;
  };
  active_patient: DoctorActivePatient | null;
  schedule: DoctorScheduleItem[];
  affiliations: DoctorAffiliation[];
}

export interface DoctorAffiliation {
  id: number;
  status: string;
  created_at?: string | null;
  organisation: {
    id: number | null;
    name: string;
    type: string | null;
  };
}

export interface DoctorAffiliationHospitalOption {
  id: number;
  name: string;
  type: string | null;
  status: string | null;
  current_affiliation_id: number | null;
  current_status: string | null;
  can_request: boolean;
}

export interface DoctorAssistantReply {
  answer: string;
  source: "gemini_edge" | "doctor_fallback";
}

export interface DoctorAvailabilitySlot {
  id: number;
  doctor_id: number;
  hospital_id?: number | null;
  start_time: string;
  end_time: string;
  is_booked?: boolean;
}

export interface DoctorMedicineCatalogItem {
  id: number;
  name: string;
  unit: string | null;
  retail_price: number | null;
  wholesale_price: number | null;
}

export interface DoctorDiseaseCatalogItem {
  id: number;
  code: string | null;
  name: string;
  domain?: string | null;
}
