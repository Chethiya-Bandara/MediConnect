import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout";
import { ForgotPasswordPage } from "../features/auth/pages/ForgotPasswordPage";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { RegisterPage } from "../features/auth/pages/RegisterPage";
import { DashboardHomePage } from "../features/dashboard/pages/DashboardHomePage";
import { DoctorDashboardPage } from "../features/doctor/pages/DoctorDashboardPage";
import { useAuth } from "../features/auth/context/AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

export function AppRouter() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={user?.role === "DOCTOR" ? <DoctorDashboardPage /> : <DashboardHomePage />}
        />
      </Route>

      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
