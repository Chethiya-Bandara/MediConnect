import { Navigate, useRoutes, type RouteObject } from "react-router-dom";
import type { UserRole } from "../../types/auth";
import { DashboardShell } from "../../components/layout/DashboardShell";
import { resolveDashboardRole } from "../../lib/auth/roleRedirect";
import { useAuth } from "../providers/AuthProvider";
import { authRoutes } from "./AuthRoutes";
import { doctorRoutes } from "./DoctorRoutes";
import { healthMinistryAdminRoutes } from "./HealthMinistryAdminRoutes";
import { hospitalAdminRoutes } from "./HospitalAdminRoutes";
import { patientRoutes } from "./PatientRoutes";
import { pharmacistRoutes } from "./PharmacistRoutes";
import { pharmacyAdminRoutes } from "./PharmacyAdminRoutes";
import { ProtectedRoute } from "./ProtectedRoute";

const dashboardRoutesByRole: Record<UserRole, RouteObject[]> = {
  PATIENT: patientRoutes,
  DOCTOR: doctorRoutes,
  PHARMACIST: pharmacistRoutes,
  PHARMACY_ADMIN: pharmacyAdminRoutes,
  HOSPITAL_ADMIN: hospitalAdminRoutes,
  HEALTH_MINISTRY_ADMIN: healthMinistryAdminRoutes,
};

export function AppRouter() {
  const { user } = useAuth();
  const role = resolveDashboardRole(user?.role);

  return useRoutes([
    ...authRoutes,
    {
      path: "/dashboard",
      element: (
        <ProtectedRoute>
          <DashboardShell />
        </ProtectedRoute>
      ),
      children: dashboardRoutesByRole[role],
    },
    {
      path: "/",
      element: <Navigate to="/login" replace />,
    },
    {
      path: "*",
      element: <Navigate to="/login" replace />,
    },
  ]);
}
