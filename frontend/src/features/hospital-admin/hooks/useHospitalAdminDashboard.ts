import { useEffect, useMemo, useState } from "react";
import {
  cancelBookedAvailabilitySlot,
  createAvailabilitySlot,
  deleteAvailabilitySlot,
  decideAffiliation,
  getDoctorAvailability,
  getHospitalAdminDashboard,
  inviteDoctor,
  revokeAffiliation,
  updateAvailabilitySlot,
} from "../api/hospitalAdminApi";
import type {
  ActiveStaffMember,
  AffiliationDecisionStatus,
  CreateAvailabilityPayload,
  HospitalAuditLog,
  HospitalAvailabilitySlot,
  HospitalDashboardStats,
  HospitalOverviewStats,
  InviteDoctorPayload,
  PendingAffiliationItem,
  PendingInvitationItem,
  UpdateAvailabilityPayload,
} from "../types";

function createEmptyStats(): HospitalDashboardStats {
  return {
    activeDoctors: 0,
    pendingAffiliations: 0,
    pendingInvitations: 0,
    appointmentsToday: 0,
    capacityLoad: 0,
    totalSlotsToday: 0,
    bookedSlotsToday: 0,
  };
}

function buildOverviewStats(
  slots: HospitalAvailabilitySlot[],
  activeDoctorId: string | null,
  hasHospitalScope: boolean,
): HospitalOverviewStats {
  return {
    availabilitySlots: slots.length,
    coveredDays: new Set(slots.map((slot) => slot.dayOfWeek).filter(Boolean)).size,
    activeDoctorLoaded: Boolean(activeDoctorId),
    invitationReady: hasHospitalScope,
  };
}

export function useHospitalAdminDashboard() {
  const [hospital, setHospital] = useState<{
    id: string | null;
    name: string | null;
    type: string | null;
    status: string | null;
  }>({
    id: null,
    name: null,
    type: null,
    status: null,
  });
  const [dashboardStats, setDashboardStats] = useState<HospitalDashboardStats>(createEmptyStats);
  const [pendingAffiliations, setPendingAffiliations] = useState<PendingAffiliationItem[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitationItem[]>([]);
  const [activeStaff, setActiveStaff] = useState<ActiveStaffMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<HospitalAuditLog[]>([]);
  const [availabilityDoctorIdInput, setAvailabilityDoctorIdInput] = useState("");
  const [activeDoctorId, setActiveDoctorId] = useState<string | null>(null);
  const [availabilitySlots, setAvailabilitySlots] = useState<HospitalAvailabilitySlot[]>([]);
  const [doctorsMessage, setDoctorsMessage] = useState<string | null>(null);
  const [affiliationsMessage, setAffiliationsMessage] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSubmittingDoctorAction, setIsSubmittingDoctorAction] = useState(false);
  const [isSubmittingAffiliationAction, setIsSubmittingAffiliationAction] = useState(false);

  const refreshDashboard = async () => {
    setIsLoadingDashboard(true);
    setDashboardError(null);

    try {
      const response = await getHospitalAdminDashboard();
      setHospital(response.hospital);
      setDashboardStats(response.stats);
      setPendingAffiliations(response.pendingAffiliations);
      setPendingInvitations(response.pendingInvitations);
      setActiveStaff(response.activeStaff);
      setAuditLogs(response.auditLogs);
      return true;
    } catch (dashboardLoadError) {
      setHospital({ id: null, name: null, type: null, status: null });
      setDashboardStats(createEmptyStats());
      setPendingAffiliations([]);
      setPendingInvitations([]);
      setActiveStaff([]);
      setAuditLogs([]);
      setDashboardError(
        dashboardLoadError instanceof Error
          ? dashboardLoadError.message
          : "Hospital admin dashboard could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  const loadAvailability = async (
    doctorId = availabilityDoctorIdInput.trim(),
    slotDate?: string,
  ) => {
    if (!doctorId) {
      setError("Enter a doctor ID before loading availability.");
      setAvailabilitySlots([]);
      setActiveDoctorId(null);
      return false;
    }

    setIsLoadingAvailability(true);
    setError(null);
    setDoctorsMessage(null);

    try {
      const slots = await getDoctorAvailability(doctorId, slotDate);
      setAvailabilitySlots(slots);
      setActiveDoctorId(doctorId);
      setDoctorsMessage(
        slotDate
          ? slots.length > 0
            ? `Loaded ${slots.length} slot(s) for ${slotDate}.`
            : `No slots found for ${slotDate} yet.`
          : slots.length > 0
            ? `Loaded ${slots.length} slot(s).`
            : "No slots found yet.",
      );
      return true;
    } catch (loadError) {
      setAvailabilitySlots([]);
      setActiveDoctorId(doctorId);
      setError(
        loadError instanceof Error ? loadError.message : "Doctor availability could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  useEffect(() => {
    void refreshDashboard();
  }, []);

  const addAvailability = async (payload: CreateAvailabilityPayload) => {
    setIsSubmittingDoctorAction(true);
    setDoctorsMessage(null);

    try {
      const response = await createAvailabilitySlot(payload);
      setDoctorsMessage(
        response.message ?? `Created ${response.created_count ?? 0} availability slot(s).`,
      );
      await Promise.all([loadAvailability(payload.doctorId, payload.slotDate), refreshDashboard()]);
      return true;
    } catch (availabilityError) {
      setDoctorsMessage(
        availabilityError instanceof Error
          ? availabilityError.message
          : "Availability creation failed.",
      );
      return false;
    } finally {
      setIsSubmittingDoctorAction(false);
    }
  };

  const editAvailability = async (
    payload: UpdateAvailabilityPayload,
    doctorId = activeDoctorId,
    slotDate?: string,
  ) => {
    setIsSubmittingDoctorAction(true);
    setDoctorsMessage(null);

    try {
      await updateAvailabilitySlot(payload);
      setDoctorsMessage("Availability slot updated.");
      if (doctorId) {
        await loadAvailability(doctorId, slotDate);
      }
      await refreshDashboard();
      return true;
    } catch (availabilityError) {
      setDoctorsMessage(
        availabilityError instanceof Error
          ? availabilityError.message
          : "Availability update failed.",
      );
      return false;
    } finally {
      setIsSubmittingDoctorAction(false);
    }
  };

  const removeAvailability = async (
    slotId: string,
    doctorId = activeDoctorId,
    slotDate?: string,
  ) => {
    setIsSubmittingDoctorAction(true);
    setDoctorsMessage(null);

    try {
      await deleteAvailabilitySlot(slotId);
      setDoctorsMessage("Availability slot deleted.");
      if (doctorId) {
        await loadAvailability(doctorId, slotDate);
      }
      await refreshDashboard();
      return true;
    } catch (availabilityError) {
      setDoctorsMessage(
        availabilityError instanceof Error
          ? availabilityError.message
          : "Availability delete failed.",
      );
      return false;
    } finally {
      setIsSubmittingDoctorAction(false);
    }
  };

  const cancelBookedAvailability = async (
    slotId: string,
    doctorId = activeDoctorId,
    slotDate?: string,
  ) => {
    setIsSubmittingDoctorAction(true);
    setDoctorsMessage(null);

    try {
      const response = await cancelBookedAvailabilitySlot(slotId);
      setDoctorsMessage(response.message ?? "Booked appointment cancelled and slot reopened.");
      if (doctorId) {
        await loadAvailability(doctorId, slotDate);
      }
      await refreshDashboard();
      return true;
    } catch (availabilityError) {
      setDoctorsMessage(
        availabilityError instanceof Error
          ? availabilityError.message
          : "Booked appointment cancellation failed.",
      );
      return false;
    } finally {
      setIsSubmittingDoctorAction(false);
    }
  };

  const sendInvite = async (payload: InviteDoctorPayload) => {
    setIsSubmittingDoctorAction(true);
    setDoctorsMessage(null);

    try {
      const response = await inviteDoctor(payload);
      setDoctorsMessage(response.message ?? "Doctor invitation sent.");
      await refreshDashboard();
      return true;
    } catch (inviteError) {
      setDoctorsMessage(
        inviteError instanceof Error ? inviteError.message : "Doctor invitation failed.",
      );
      return false;
    } finally {
      setIsSubmittingDoctorAction(false);
    }
  };

  const submitAffiliationDecision = async (
    affiliationId: string,
    status: AffiliationDecisionStatus,
  ) => {
    setIsSubmittingAffiliationAction(true);
    setAffiliationsMessage(null);

    try {
      const response = await decideAffiliation(affiliationId, status);
      setAffiliationsMessage(response.message ?? `Affiliation ${status}.`);
      await refreshDashboard();
      return true;
    } catch (decisionError) {
      setAffiliationsMessage(
        decisionError instanceof Error ? decisionError.message : "Affiliation decision failed.",
      );
      return false;
    } finally {
      setIsSubmittingAffiliationAction(false);
    }
  };

  const submitAffiliationRevoke = async (affiliationId: string) => {
    setIsSubmittingAffiliationAction(true);
    setAffiliationsMessage(null);

    try {
      const response = await revokeAffiliation(affiliationId);
      setAffiliationsMessage(response.message ?? "Affiliation revoked.");
      await refreshDashboard();
      return true;
    } catch (revokeError) {
      setAffiliationsMessage(
        revokeError instanceof Error ? revokeError.message : "Affiliation revoke failed.",
      );
      return false;
    } finally {
      setIsSubmittingAffiliationAction(false);
    }
  };

  const overviewStats = useMemo(
    () => buildOverviewStats(availabilitySlots, activeDoctorId, Boolean(hospital.id)),
    [availabilitySlots, activeDoctorId, hospital.id],
  );

  return {
    hospital,
    dashboardStats,
    pendingAffiliations,
    pendingInvitations,
    activeStaff,
    auditLogs,
    availabilityDoctorIdInput,
    activeDoctorId,
    availabilitySlots,
    overviewStats,
    doctorsMessage,
    affiliationsMessage,
    dashboardError,
    error,
    isLoadingDashboard,
    isLoadingAvailability,
    isSubmittingDoctorAction,
    isSubmittingAffiliationAction,
    setAvailabilityDoctorIdInput,
    refreshDashboard,
    loadAvailability,
    addAvailability,
    editAvailability,
    removeAvailability,
    cancelBookedAvailability,
    sendInvite,
    submitAffiliationDecision,
    submitAffiliationRevoke,
  };
}
