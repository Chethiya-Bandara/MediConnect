import type { RouteObject } from "react-router-dom";
import { HospitalAdminDashboardPage } from "../../features/hospital-admin/pages/HospitalAdminDashboardPage";

export const hospitalAdminRoutes: RouteObject[] = [
  {
    index: true,
    element: <HospitalAdminDashboardPage />,
  },
];
