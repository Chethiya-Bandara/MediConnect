import type { RouteObject } from "react-router-dom";
import { PharmacistDashboardPage } from "../../features/pharmacist/pages/PharmacistDashboardPage";

export const pharmacistRoutes: RouteObject[] = [
  {
    index: true,
    element: <PharmacistDashboardPage />,
  },
];
