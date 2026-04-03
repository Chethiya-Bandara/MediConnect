import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AuthActionResult,
  AuthUser,
  LoginFormValues,
  RegisterFormValues,
} from "../types";

const API_URL = "http://localhost:8000";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (payload: LoginFormValues) => Promise<AuthActionResult>;
  register: (payload: RegisterFormValues) => Promise<AuthActionResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

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

      console.log("TOKEN:", token);

      // FETCH USER
      const userRes = await fetch(`${API_URL}/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      console.log("ME RESPONSE STATUS:", userRes.status);

      const userData = await userRes.json();
      console.log("ME DATA:", userData);

      const loggedUser: AuthUser = {
        id: userData.id,
        name: userData.email || "User",
        email: userData.email,
        role: userData.role, // REAL ROLE FROM DB
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
      const res = await fetch(`${API_URL}/register`, {
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