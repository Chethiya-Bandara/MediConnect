import { useEffect, useMemo, useState } from "react";
import {
  approveDoctor,
  approveOrganization,
  createManagedOrganisation,
  generateMonthlyReport,
  getDiseaseIncidence,
  getHealthMinistryDashboard,
  getManagedOrganisations,
  getTopDiagnoses,
  suspendEntity,
} from "../api/healthMinistryAdminApi";
import type {
  AnalyticsFilters,
  ApprovalStatus,
  DiagnosisMetric,
  GovernanceAction,
  GovernanceTargetType,
  HealthMinistryAuditLog,
  HealthMinistryDashboardStats,
  HealthMinistryOverviewStats,
  ManagedOrganisationItem,
  PendingDoctorItem,
  PendingOrganisationItem,
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
  const [dashboardStats, setDashboardStats] = useState<HealthMinistryDashboardStats>(createEmptyStats);
  const [pendingOrganisations, setPendingOrganisations] = useState<PendingOrganisationItem[]>([]);
  const [pendingDoctors, setPendingDoctors] = useState<PendingDoctorItem[]>([]);
  const [managedOrganisations, setManagedOrganisations] = useState<ManagedOrganisationItem[]>([]);
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
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isSubmittingUserAction, setIsSubmittingUserAction] = useState(false);
  const [isCreatingOrganisation, setIsCreatingOrganisation] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

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
      setAuditLogs(dashboardResponse.auditLogs);
      setManagedOrganisations(organisationResponse);
      return true;
    } catch (error) {
      setDashboardStats(createEmptyStats());
      setPendingOrganisations([]);
      setPendingDoctors([]);
      setManagedOrganisations([]);
      setAuditLogs([]);
      setDashboardError(
        error instanceof Error
          ? error.message
          : "Health ministry dashboard could not be loaded.",
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
        error instanceof Error
          ? error.message
          : "Government analytics could not be loaded.",
      );
      return false;
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    void Promise.all([refreshDashboard(), refreshAnalytics()]);
  }, []);

  const overviewStats = useMemo(
    () => buildOverviewStats(dashboardStats, topDiagnoses, report),
    [dashboardStats, topDiagnoses, report],
  );

  const submitOrganizationApproval = async (
    organizationId: string,
    status: ApprovalStatus,
  ) => {
    setIsSubmittingApproval(true);
    setApprovalsMessage(null);

    try {
      const response = await approveOrganization(organizationId, status);
      setApprovalsMessage(response.message ?? `Organisation ${status}.`);
      await refreshDashboard();
      return true;
    } catch (error) {
      setApprovalsMessage(
        error instanceof Error ? error.message : "Organisation approval failed.",
      );
      return false;
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const submitDoctorApproval = async (doctorId: string, status: ApprovalStatus) => {
    setIsSubmittingApproval(true);
    setApprovalsMessage(null);

    try {
      const response = await approveDoctor(doctorId, status);
      setApprovalsMessage(response.message ?? `Doctor ${status}.`);
      await refreshDashboard();
      return true;
    } catch (error) {
      setApprovalsMessage(
        error instanceof Error ? error.message : "Doctor approval failed.",
      );
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
      setUsersMessage(
        error instanceof Error ? error.message : "User governance action failed.",
      );
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
      setReportMessage(
        error instanceof Error ? error.message : "Monthly report failed.",
      );
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
    managedOrganisations,
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
    reportMessage,
    isLoadingDashboard,
    isLoadingAnalytics,
    isSubmittingApproval,
    isSubmittingUserAction,
    isCreatingOrganisation,
    isGeneratingReport,
    setFilters,
    refreshDashboard,
    refreshAnalytics,
    submitOrganizationApproval,
    submitDoctorApproval,
    submitUserAction,
    submitOrganisationCreate,
    requestMonthlyReport,
  };
}
