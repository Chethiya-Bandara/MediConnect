import type { RouteObject } from "react-router-dom";
import { HealthMinistryAdminDashboardPage } from "../../features/health-ministry-admin/pages/HealthMinistryAdminDashboardPage";

export const healthMinistryAdminRoutes: RouteObject[] = [
  {
    index: true,
    element: <HealthMinistryAdminDashboardPage />,
  },
];
