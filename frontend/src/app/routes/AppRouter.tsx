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

const dashboardPathByRole: Record<UserRole, string> = {
  PATIENT: "patient",
  DOCTOR: "doctor",
  PHARMACIST: "pharmacist",
  PHARMACY_ADMIN: "pharmacy-admin",
  HOSPITAL_ADMIN: "hospital-admin",
  HEALTH_MINISTRY_ADMIN: "health-ministry-admin",
};

const dashboardRoutesByRole: Record<UserRole, RouteObject> = {
  PATIENT: { path: dashboardPathByRole.PATIENT, children: patientRoutes },
  DOCTOR: { path: dashboardPathByRole.DOCTOR, children: doctorRoutes },
  PHARMACIST: { path: dashboardPathByRole.PHARMACIST, children: pharmacistRoutes },
  PHARMACY_ADMIN: { path: dashboardPathByRole.PHARMACY_ADMIN, children: pharmacyAdminRoutes },
  HOSPITAL_ADMIN: { path: dashboardPathByRole.HOSPITAL_ADMIN, children: hospitalAdminRoutes },
  HEALTH_MINISTRY_ADMIN: {
    path: dashboardPathByRole.HEALTH_MINISTRY_ADMIN,
    children: healthMinistryAdminRoutes,
  },
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
      children: [
        {
          index: true,
          element: <Navigate to={dashboardPathByRole[role]} replace />,
        },
        ...Object.values(dashboardRoutesByRole),
      ],
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
