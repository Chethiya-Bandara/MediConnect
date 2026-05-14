import type { RouteObject } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { ForgotPasswordPage } from "../../features/auth/pages/ForgotPasswordPage";
import { LoginPage } from "../../features/auth/pages/LoginPage";
import { RegisterPage } from "../../features/auth/pages/RegisterPage";
import { ResetPasswordPage } from "../../features/auth/pages/ResetPasswordPage";

export const authRoutes: RouteObject[] = [
  {
    element: <AuthLayout />,
    children: [
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "/register",
        element: <RegisterPage />,
      },
      {
        path: "/forgot-password",
        element: <ForgotPasswordPage />,
      },
      {
        path: "/reset-password",
        element: <ResetPasswordPage />,
      },
    ],
  },
];
