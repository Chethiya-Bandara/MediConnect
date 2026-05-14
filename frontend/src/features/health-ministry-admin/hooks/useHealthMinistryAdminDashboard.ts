import { useEffect, useMemo, useState } from "react";
import {
  approveDoctor,
  approveOrganization,
  createManagedOrganisation,
  createManagedMedicine,
  deleteManagedMedicine,
  generateMonthlyReport,
  getDiseaseIncidence,
  getHealthMinistryDashboard,
  getManagedMedicines,
  getManagedOrganisations,
  getTopDiagnoses,
  searchPatientRegistry,
  suspendEntity,
  updatePatientRegistryStatus,
  updateAdminUserStatus,
  updateManagedMedicine,
} from "../api/healthMinistryAdminApi";
import {
  approveDeletionRequest,
  cancelDeletionRequest,
  createDeletionRequest,
  getDoctorsRegistry,
  getHospitalAdminsRegistry,
  getPatientsRegistry,
  getPharmacistsRegistry,
  listDeletionRequests,
} from "../api/deletionRequestsApi";
import type {
  AnalyticsFilters,
  ApprovalStatus,
  DeletionEntityType,
  DeletionRequest,
  DiagnosisMetric,
  GovernanceAction,
  GovernanceTargetType,
  HealthMinistryAuditLog,
  HealthMinistryDashboardStats,
  HealthMinistryOverviewStats,
  ManagedMedicineItem,
  ManagedMedicinePayload,
  ManagedOrganisationItem,
  PatientRegistryItem,
  PatientRegistryStatus,
  PendingAdminItem,
  PendingDoctorItem,
  PendingOrganisationItem,
  RegistryPersonItem,
} from "../types";

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createDefaultFilters(): AnalyticsFilters {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);

  return {
    startDate: formatInputDate(startDate),
    endDate: formatInputDate(endDate),
    district: "",
  };
}

function createEmptyStats(): HealthMinistryDashboardStats {
  return {
    totalOrganisations: 0,
    pendingOrganisations: 0,
    totalDoctors: 0,
    pendingDoctors: 0,
    pendingAdmins: 0,
    totalPatients: 0,
    auditEvents24h: 0,
  };
}

function buildOverviewStats(
  dashboardStats: HealthMinistryDashboardStats,
  topDiagnoses: DiagnosisMetric[],
  report: string | null,
): HealthMinistryOverviewStats {
  return {
    totalIncidence: dashboardStats.totalPatients,
    trackedDiagnoses: dashboardStats.totalOrganisations,
    leadingDiagnosis: topDiagnoses[0]?.code ?? "No diagnosis feed yet",
    reportReady: Boolean(report),
  };
}

export function useHealthMinistryAdminDashboard() {
  const [filters, setFilters] = useState<AnalyticsFilters>(createDefaultFilters);
  const [dashboardStats, setDashboardStats] =
    useState<HealthMinistryDashboardStats>(createEmptyStats);
  const [pendingOrganisations, setPendingOrganisations] = useState<PendingOrganisationItem[]>([]);
  const [pendingDoctors, setPendingDoctors] = useState<PendingDoctorItem[]>([]);
  const [pendingAdmins, setPendingAdmins] = useState<PendingAdminItem[]>([]);
  const [managedOrganisations, setManagedOrganisations] = useState<ManagedOrganisationItem[]>([]);
  const [managedMedicines, setManagedMedicines] = useState<ManagedMedicineItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<HealthMinistryAuditLog[]>([]);
  const [incidence, setIncidence] = useState<DiagnosisMetric[]>([]);
  const [topDiagnoses, setTopDiagnoses] = useState<DiagnosisMetric[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [approvalsMessage, setApprovalsMessage] = useState<string | null>(null);
  const [usersMessage, setUsersMessage] = useState<string | null>(null);
  const [organisationMessage, setOrganisationMessage] = useState<string | null>(null);
  const [medicineMessage, setMedicineMessage] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [isLoadingMedicines, setIsLoadingMedicines] = useState(true);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isSubmittingUserAction, setIsSubmittingUserAction] = useState(false);
  const [isCreatingOrganisation, setIsCreatingOrganisation] = useState(false);
  const [isSubmittingMedicine, setIsSubmittingMedicine] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // ── Deletion Requests ──────────────────────────────────────────────────────
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [deletionMessage, setDeletionMessage] = useState<string | null>(null);
  const [isLoadingDeletions, setIsLoadingDeletions] = useState(false);
  const [isSubmittingDeletion, setIsSubmittingDeletion] = useState(false);

  // ── People Registries ──────────────────────────────────────────────────────
  const [patientsRegistry, setPatientsRegistry] = useState<RegistryPersonItem[]>([]);
  const [doctorsRegistry, setDoctorsRegistry] = useState<RegistryPersonItem[]>([]);
  const [pharmacistsRegistry, setPharmacistsRegistry] = useState<RegistryPersonItem[]>([]);
  const [hospitalAdminsRegistry, setHospitalAdminsRegistry] = useState<RegistryPersonItem[]>([]);
  const [isLoadingRegistry, setIsLoadingRegistry] = useState(false);
  const [patientRegistryResults, setPatientRegistryResults] = useState<PatientRegistryItem[]>([]);
  const [patientRegistryMessage, setPatientRegistryMessage] = useState<string | null>(null);
  const [isSearchingPatientRegistry, setIsSearchingPatientRegistry] = useState(false);
  const [isSubmittingPatientRegistry, setIsSubmittingPatientRegistry] = useState(false);

  const refreshDashboard = async () => {
    setIsLoadingDashboard(true);
    setDashboardError(null);

    try {
      const [dashboardResponse, organisationResponse] = await Promise.all([
        getHealthMinistryDashboard(),
        getManagedOrganisations(),
      ]);
      setDashboardStats(dashboardResponse.stats);
      setPendingOrganisations(dashboardResponse.pendingOrganisations);
      setPendingDoctors(dashboardResponse.pendingDoctors);
      setPendingAdmins(dashboardResponse.pendingAdmins);
      setAuditLogs(dashboardResponse.auditLogs);
      setManagedOrganisations(organisationResponse);
      return true;
    } catch (error) {
      setDashboardStats(createEmptyStats());
      setPendingOrganisations([]);
      setPendingDoctors([]);
      setPendingAdmins([]);
      setManagedOrganisations([]);
      setAuditLogs([]);
      setDashboardError(
        error instanceof Error ? error.message : "Health ministry dashboard could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  const refreshAnalytics = async (nextFilters: AnalyticsFilters = filters) => {
    setIsLoadingAnalytics(true);
    setAnalyticsError(null);

    try {
      const [incidenceResponse, topDiagnosesResponse] = await Promise.all([
        getDiseaseIncidence(nextFilters),
        getTopDiagnoses(),
      ]);
      setIncidence(incidenceResponse);
      setTopDiagnoses(topDiagnosesResponse);
      return true;
    } catch (error) {
      setIncidence([]);
      setTopDiagnoses([]);
      setAnalyticsError(
        error instanceof Error ? error.message : "Government analytics could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const refreshMedicines = async (search = "") => {
    setIsLoadingMedicines(true);

    try {
      const response = await getManagedMedicines(search);
      setManagedMedicines(response);
      setMedicineMessage(null);
      return true;
    } catch (error) {
      setManagedMedicines([]);
      setMedicineMessage(
        error instanceof Error ? error.message : "Medicine registry could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingMedicines(false);
    }
  };

  useEffect(() => {
    void Promise.all([refreshDashboard(), refreshAnalytics(), refreshMedicines()]);
  }, []);

  const overviewStats = useMemo(
    () => buildOverviewStats(dashboardStats, topDiagnoses, report),
    [dashboardStats, topDiagnoses, report],
  );

  const submitOrganizationApproval = async (organizationId: string, status: ApprovalStatus) => {
    setIsSubmittingApproval(true);
    setApprovalsMessage(null);

    try {
      const response = await approveOrganization(organizationId, status);
      setApprovalsMessage(response.message ?? `Organisation ${status}.`);
      await refreshDashboard();
      return true;
    } catch (error) {
      setApprovalsMessage(error instanceof Error ? error.message : "Organisation approval failed.");
      return false;
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const submitDoctorApproval = async (doctorId: string, status: ApprovalStatus) => {
    setIsSubmittingApproval(true);
    setApprovalsMessage(null);
    setUsersMessage(null);

    try {
      const response = await approveDoctor(doctorId, status);
      const message = response.message ?? `Doctor ${status}.`;
      setApprovalsMessage(message);
      setUsersMessage(message);
      await Promise.all([refreshDashboard(), refreshPeopleRegistries()]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Doctor approval failed.";
      setApprovalsMessage(message);
      setUsersMessage(message);
      return false;
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const submitAdminApproval = async (userId: string, status: ApprovalStatus) => {
    setIsSubmittingApproval(true);
    setApprovalsMessage(null);
    setUsersMessage(null);

    try {
      const response = await updateAdminUserStatus(userId, status);
      const message = response.message ?? `Admin user ${status}.`;
      setApprovalsMessage(message);
      setUsersMessage(message);
      await Promise.all([refreshDashboard(), refreshPeopleRegistries()]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Admin approval failed.";
      setApprovalsMessage(message);
      setUsersMessage(message);
      return false;
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const submitUserAction = async (
    targetId: string,
    targetType: GovernanceTargetType,
    action: GovernanceAction,
  ) => {
    setIsSubmittingUserAction(true);
    setUsersMessage(null);
    setOrganisationMessage(null);

    try {
      const response = await suspendEntity(targetId, targetType, action);
      const message = response.message ?? `${targetType} updated.`;
      setUsersMessage(message);
      if (targetType === "ORGANIZATION") {
        setOrganisationMessage(message);
      }
      await refreshDashboard();
      return true;
    } catch (error) {
      setUsersMessage(error instanceof Error ? error.message : "User governance action failed.");
      return false;
    } finally {
      setIsSubmittingUserAction(false);
    }
  };

  const submitOrganisationCreate = async (payload: {
    name: string;
    type: string;
    status: string;
  }) => {
    setIsCreatingOrganisation(true);
    setOrganisationMessage(null);

    try {
      const response = await createManagedOrganisation(payload);
      setOrganisationMessage(response.message ?? "Organisation created.");
      await refreshDashboard();
      return true;
    } catch (error) {
      setOrganisationMessage(
        error instanceof Error ? error.message : "Organisation creation failed.",
      );
      return false;
    } finally {
      setIsCreatingOrganisation(false);
    }
  };

  const submitMedicineCreate = async (payload: ManagedMedicinePayload) => {
    setIsSubmittingMedicine(true);
    setMedicineMessage(null);

    try {
      const response = await createManagedMedicine(payload);
      setMedicineMessage(response.message ?? "Medicine created.");
      await refreshMedicines();
      return true;
    } catch (error) {
      setMedicineMessage(error instanceof Error ? error.message : "Medicine creation failed.");
      return false;
    } finally {
      setIsSubmittingMedicine(false);
    }
  };

  const submitMedicineUpdate = async (medicineId: string, payload: ManagedMedicinePayload) => {
    setIsSubmittingMedicine(true);
    setMedicineMessage(null);

    try {
      const response = await updateManagedMedicine(medicineId, payload);
      setMedicineMessage(response.message ?? "Medicine updated.");
      await refreshMedicines();
      return true;
    } catch (error) {
      setMedicineMessage(error instanceof Error ? error.message : "Medicine update failed.");
      return false;
    } finally {
      setIsSubmittingMedicine(false);
    }
  };

  const submitMedicineDelete = async (medicineId: string) => {
    setIsSubmittingMedicine(true);
    setMedicineMessage(null);

    try {
      const response = await deleteManagedMedicine(medicineId);
      setMedicineMessage(response.message ?? "Medicine removed.");
      await refreshMedicines();
      return true;
    } catch (error) {
      setMedicineMessage(error instanceof Error ? error.message : "Medicine removal failed.");
      return false;
    } finally {
      setIsSubmittingMedicine(false);
    }
  };

  const refreshDeletionRequests = async () => {
    setIsLoadingDeletions(true);
    setDeletionMessage(null);
    try {
      const items = await listDeletionRequests();
      setDeletionRequests(items);
      return true;
    } catch (error) {
      setDeletionRequests([]);
      setDeletionMessage(
        error instanceof Error ? error.message : "Deletion requests could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingDeletions(false);
    }
  };

  const refreshPeopleRegistries = async () => {
    setIsLoadingRegistry(true);
    try {
      const [patients, doctors, pharmacists, hospitalAdmins] = await Promise.all([
        getPatientsRegistry(),
        getDoctorsRegistry(),
        getPharmacistsRegistry(),
        getHospitalAdminsRegistry(),
      ]);
      setPatientsRegistry(patients);
      setDoctorsRegistry(doctors);
      setPharmacistsRegistry(pharmacists);
      setHospitalAdminsRegistry(hospitalAdmins);
    } catch {
      // silently fail — individual lists degrade gracefully
    } finally {
      setIsLoadingRegistry(false);
    }
  };

  const submitDeletionRequest = async (payload: {
    entityType: DeletionEntityType;
    entityId: string;
    entityDisplayName?: string;
    reason?: string;
  }) => {
    setIsSubmittingDeletion(true);
    setDeletionMessage(null);
    try {
      const response = await createDeletionRequest(payload);
      setDeletionMessage(response.message ?? "Deletion request submitted.");
      await refreshDeletionRequests();
      return true;
    } catch (error) {
      setDeletionMessage(error instanceof Error ? error.message : "Deletion request failed.");
      return false;
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  const submitDeletionApproval = async (requestId: string) => {
    setIsSubmittingDeletion(true);
    setDeletionMessage(null);
    try {
      const response = await approveDeletionRequest(requestId);
      setDeletionMessage(response.message ?? "Entity deactivated successfully.");
      await refreshDeletionRequests();
      return true;
    } catch (error) {
      setDeletionMessage(error instanceof Error ? error.message : "Approval failed.");
      return false;
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  const submitDeletionCancel = async (requestId: string) => {
    setIsSubmittingDeletion(true);
    setDeletionMessage(null);
    try {
      const response = await cancelDeletionRequest(requestId);
      setDeletionMessage(response.message ?? "Request cancelled.");
      await refreshDeletionRequests();
      return true;
    } catch (error) {
      setDeletionMessage(error instanceof Error ? error.message : "Cancellation failed.");
      return false;
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  const lookupPatientRegistry = async (query: string) => {
    setIsSearchingPatientRegistry(true);
    setPatientRegistryMessage(null);

    try {
      const items = await searchPatientRegistry(query);
      setPatientRegistryResults(items);
      if (items.length === 0) {
        setPatientRegistryMessage("No patient matched that full DHID or NIC.");
      }
      return items;
    } catch (error) {
      setPatientRegistryResults([]);
      setPatientRegistryMessage(
        error instanceof Error ? error.message : "Patient registry search failed.",
      );
      return [];
    } finally {
      setIsSearchingPatientRegistry(false);
    }
  };

  const submitPatientRegistryStatus = async (
    userId: string,
    status: PatientRegistryStatus,
    query: string,
  ) => {
    setIsSubmittingPatientRegistry(true);
    setPatientRegistryMessage(null);

    try {
      const response = await updatePatientRegistryStatus(userId, status);
      setPatientRegistryMessage(response.message ?? `Patient marked as ${status}.`);
      await lookupPatientRegistry(query);
      return true;
    } catch (error) {
      setPatientRegistryMessage(
        error instanceof Error ? error.message : "Patient status update failed.",
      );
      return false;
    } finally {
      setIsSubmittingPatientRegistry(false);
    }
  };

  const requestMonthlyReport = async () => {
    setIsGeneratingReport(true);
    setReportMessage(null);

    try {
      const response = await generateMonthlyReport();
      setReport(response.report);
      setReportGeneratedAt(response.generatedAt);
      setReportMessage("Monthly report generated.");
      return true;
    } catch (error) {
      setReport(null);
      setReportGeneratedAt(null);
      setReportMessage(error instanceof Error ? error.message : "Monthly report failed.");
      return false;
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return {
    filters,
    dashboardStats,
    pendingOrganisations,
    pendingDoctors,
    pendingAdmins,
    managedOrganisations,
    managedMedicines,
    auditLogs,
    incidence,
    topDiagnoses,
    report,
    reportGeneratedAt,
    overviewStats,
    analyticsError,
    dashboardError,
    approvalsMessage,
    usersMessage,
    organisationMessage,
    medicineMessage,
    reportMessage,
    isLoadingDashboard,
    isLoadingAnalytics,
    isLoadingMedicines,
    isSubmittingApproval,
    isSubmittingUserAction,
    isCreatingOrganisation,
    isSubmittingMedicine,
    isGeneratingReport,
    // deletion requests
    deletionRequests,
    deletionMessage,
    isLoadingDeletions,
    isSubmittingDeletion,
    // people registries
    patientsRegistry,
    doctorsRegistry,
    pharmacistsRegistry,
    hospitalAdminsRegistry,
    isLoadingRegistry,
    patientRegistryResults,
    patientRegistryMessage,
    isSearchingPatientRegistry,
    isSubmittingPatientRegistry,
    setFilters,
    refreshDashboard,
    refreshAnalytics,
    refreshMedicines,
    refreshDeletionRequests,
    refreshPeopleRegistries,
    lookupPatientRegistry,
    submitOrganizationApproval,
    submitDoctorApproval,
    submitAdminApproval,
    submitPatientRegistryStatus,
    submitUserAction,
    submitOrganisationCreate,
    submitMedicineCreate,
    submitMedicineUpdate,
    submitMedicineDelete,
    submitDeletionRequest,
    submitDeletionApproval,
    submitDeletionCancel,
    requestMonthlyReport,
  };
}
