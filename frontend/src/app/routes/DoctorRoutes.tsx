import type { RouteObject } from "react-router-dom";
import { DoctorDashboardPage } from "../../features/doctor/pages/DoctorDashboardPage";

export const doctorRoutes: RouteObject[] = [
  {
    index: true,
    element: <DoctorDashboardPage />,
  },
];
