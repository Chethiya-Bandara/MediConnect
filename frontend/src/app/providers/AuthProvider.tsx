import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  getCurrentUser,
  loginRequest,
  registerRequest,
  requestPasswordReset as requestPasswordResetApi,
} from "../../features/auth/api/authApi";
import type {
  AuthActionResult,
  AuthUser,
  LoginFormValues,
  RegisterFormValues,
  UserRole,
} from "../../types/auth";
import {
  getStoredToken,
  getStoredJson,
  removeStoredToken,
  removeStoredValue,
  setStoredJson,
  setStoredToken,
} from "../../lib/utils/storage";

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

function shouldClearSession(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.trim().toLowerCase();
  return [
    "missing authorization token. please log in.",
    "missing token",
    "invalid token",
    "invalid or expired token. please log in again.",
    "user profile not found",
    "user profile not found.",
  ].includes(normalized);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = getStoredJson<AuthUser>("user");
    if (!stored) {
      return null;
    }

    return {
      ...stored,
      role: normalizeRole(stored.role),
    };
  });

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      return;
    }

    let isCancelled = false;

    const syncUser = async () => {
      try {
        const userData = await getCurrentUser(token);
        if (isCancelled) {
          return;
        }

        const nextUser: AuthUser = {
          id: userData.id,
          name: userData.name || userData.email || "User",
          email: userData.email,
          role: normalizeRole(userData.role),
          organisationId: userData.organisation_id ?? null,
          adminRole: userData.admin_role ?? null,
          doctorId: userData.doctor_id ?? null,
          patientId: userData.patient_id ?? null,
          dhid: userData.dhid ?? null,
        };

        setUser(nextUser);
        setStoredJson("user", nextUser);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (shouldClearSession(error)) {
          setUser(null);
          removeStoredToken();
          removeStoredValue("user");
        }
      }
    };

    void syncUser();

    return () => {
      isCancelled = true;
    };
  }, []);

  const login = async (
    payload: LoginFormValues,
  ): Promise<AuthActionResult> => {
    try {
      const { access_token: token } = await loginRequest(payload);
      setStoredToken(token);
      const userData = await getCurrentUser(token);

      const loggedUser: AuthUser = {
        id: userData.id,
        name: userData.name || userData.email || "User",
        email: userData.email,
        role: normalizeRole(userData.role),
        organisationId: userData.organisation_id ?? null,
        adminRole: userData.admin_role ?? null,
        doctorId: userData.doctor_id ?? null,
        patientId: userData.patient_id ?? null,
        dhid: userData.dhid ?? null,
      };

      setUser(loggedUser);
      setStoredJson("user", loggedUser);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      };
    }
  };

  const register = async (
    payload: RegisterFormValues,
  ): Promise<AuthActionResult> => {
    try {
      return await registerRequest(payload);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      };
    }
  };

  const requestPasswordReset = async (
    email: string,
  ): Promise<AuthActionResult> => {
    try {
      return await requestPasswordResetApi(email);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      };
    }
  };

  const logout = () => {
    setUser(null);
    removeStoredToken();
    removeStoredValue("user");
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
