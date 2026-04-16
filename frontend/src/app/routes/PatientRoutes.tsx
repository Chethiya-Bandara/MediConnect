import type { RouteObject } from "react-router-dom";
import { PatientDashboardPage } from "../../features/patient/pages/PatientDashboardPage";

export const patientRoutes: RouteObject[] = [
  {
    index: true,
    element: <PatientDashboardPage />,
  },
];
