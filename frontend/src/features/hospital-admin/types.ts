export type HospitalAdminSection = "overview" | "doctors" | "affiliations" | "settings";

export type AffiliationDecisionStatus = "approved" | "rejected";

export interface HospitalAvailabilitySlot {
  id: string;
  doctorId: string | null;
  hospitalId: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string | null;
  isBooked: boolean;
}

export interface HospitalOverviewStats {
  availabilitySlots: number;
  coveredDays: number;
  activeDoctorLoaded: boolean;
  invitationReady: boolean;
}

export interface CreateAvailabilityPayload {
  doctorId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
}

export interface UpdateAvailabilityPayload {
  slotId: string;
  startTime: string;
  endTime: string;
}

export interface InviteDoctorPayload {
  doctorEmail: string;
  hospitalId: string;
}

export interface HospitalDashboardStats {
  activeDoctors: number;
  pendingAffiliations: number;
  pendingInvitations: number;
  appointmentsToday: number;
  capacityLoad: number;
  totalSlotsToday: number;
  bookedSlotsToday: number;
}

export interface PendingAffiliationItem {
  affiliationId: string;
  doctorId: string;
  doctorName: string | null;
  doctorEmail: string | null;
  specialization: string | null;
  slmcNumber: string | null;
  status: string | null;
  requestedAt: string | null;
}

export interface PendingInvitationItem {
  id: string;
  doctorEmail: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface ActiveStaffMember {
  affiliationId: string;
  doctorId: string;
  doctorName: string | null;
  doctorEmail: string | null;
  specialization: string | null;
  slmcNumber: string | null;
  status: string | null;
  joinedAt: string | null;
}

export interface HospitalAuditLog {
  id: number | string | null;
  timestamp: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string | null;
  details: string | null;
}
