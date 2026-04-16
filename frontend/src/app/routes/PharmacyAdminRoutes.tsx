import type { RouteObject } from "react-router-dom";
import { PharmacyAdminDashboardPage } from "../../features/pharmacy-admin/pages/PharmacyAdminDashboardPage";

export const pharmacyAdminRoutes: RouteObject[] = [
  {
    index: true,
    element: <PharmacyAdminDashboardPage />,
  },
];
