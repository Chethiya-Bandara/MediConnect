import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AuthActionResult,
  AuthUser,
  LoginFormValues,
  RegisterFormValues,
  UserRole,
} from "../types";

const API_URL = "http://localhost:8000";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (payload: LoginFormValues) => Promise<AuthActionResult>;
  register: (payload: RegisterFormValues) => Promise<AuthActionResult>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeRole(role: unknown): UserRole {
  const normalized = String(role ?? "PATIENT").trim().toUpperCase();
  const allowedRoles: UserRole[] = [
    "PATIENT",
    "DOCTOR",
    "HEALTH_MINISTRY_ADMIN",
    "HOSPITAL_ADMIN",
    "PHARMACIST",
    "PHARMACY_ADMIN",
  ];

  return allowedRoles.includes(normalized as UserRole)
    ? (normalized as UserRole)
    : "PATIENT";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored) as AuthUser;
      return {
        ...parsed,
        role: normalizeRole(parsed.role),
      };
    } catch {
      localStorage.removeItem("user");
      return null;
    }
  });

  // LOGIN (calls FastAPI)
  const login = async (
    payload: LoginFormValues,
  ): Promise<AuthActionResult> => {
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        return {
          success: false,
          message: json.detail || "Login failed",
        };
      }

      // store token
      const token = json.access_token;
      localStorage.setItem("token", token);

      const userRes = await fetch(`${API_URL}/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const userData = await userRes.json();

      const loggedUser: AuthUser = {
        id: userData.id,
        name: userData.name || userData.email || "User",
        email: userData.email,
        role: normalizeRole(userData.role),
      };

      setUser(loggedUser);
      localStorage.setItem("user", JSON.stringify(loggedUser));

      return { success: true };
    } catch (error) {
      return { success: false, message: "Server error" };
    }
  };

  // REGISTER (calls FastAPI)
  const register = async (
    payload: RegisterFormValues,
  ): Promise<AuthActionResult> => {
    try {
      const credentialFile = payload.credentialFile?.item(0);
      const registerPayload = {
        email: payload.email,
        password: payload.password,
        role: payload.role,
        fullName: payload.fullName,
        nic: payload.nic,
        dob: payload.dob,
        parentNic: payload.parentNic,
        specialization: payload.specialization,
        licenseNumber: payload.licenseNumber,
        pharmacyId: payload.pharmacyId,
        organisationId: payload.organisationId,
        credentialFileName: credentialFile?.name,
        credentialFileSize: credentialFile?.size,
        credentialFileType: credentialFile?.type,
      };

      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registerPayload),
      });

      const json = await res.json();

      if (!res.ok) {
        return {
          success: false,
          message: json.detail || "Registration failed",
        };
      }

      return {
        success: true,
        message: json.message || "Registration successful",
      };
    } catch (error) {
      return { success: false, message: "Server error" };
    }
  };

  const requestPasswordReset = async (
    email: string,
  ): Promise<AuthActionResult> => {
    try {
      const res = await fetch(`${API_URL}/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const json = await res.json();

      if (!res.ok) {
        return {
          success: false,
          message: json.detail || "Password reset request failed",
        };
      }

      return {
        success: true,
        message: json.message || "Reset link request sent",
      };
    } catch {
      return { success: false, message: "Server error" };
    }
  };

  // 🚪 LOGOUT
  const logout = () => {
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login,
      register,
      requestPasswordReset,
      logout,
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
