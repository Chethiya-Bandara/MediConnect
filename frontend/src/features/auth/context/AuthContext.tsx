import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  type AuthActionResult,
  type AuthUser,
  type LoginFormValues,
  type RegisterFormValues,
} from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (payload: LoginFormValues) => Promise<AuthActionResult>;
  register: (payload: RegisterFormValues) => Promise<AuthActionResult>;
  logout: () => void;
}

interface RegisteredAccount {
  user: AuthUser;
  password: string;
}

const STORAGE_KEY = "mediconnect.frontend.current-user";
const REGISTERED_STORAGE_KEY = "mediconnect.frontend.registered-users";

const mockUsers = [
  {
    email: "patient@mediconnect.lk",
    password: "Patient123",
    user: {
      id: "U-001",
      name: "Demo Patient",
      email: "patient@mediconnect.lk",
      role: "PATIENT",
      nic: "200112345678",
      dob: "2001-04-10",
    } as AuthUser,
  },
  {
    email: "doctor@mediconnect.lk",
    password: "Doctor123",
    user: {
      id: "U-002",
      name: "Demo Doctor",
      email: "doctor@mediconnect.lk",
      role: "DOCTOR",
      nic: "199912345678",
      dob: "1999-02-12",
    } as AuthUser,
  },
  {
    email: "admin@mediconnect.lk",
    password: "Admin123",
    user: {
      id: "U-003",
      name: "Demo Ministry Admin",
      email: "admin@mediconnect.lk",
      role: "HEALTH_MINISTRY_ADMIN",
      nic: "198512345678",
      dob: "1985-07-19",
    } as AuthUser,
  },
];

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function readRegisteredAccounts(): RegisteredAccount[] {
  const raw = localStorage.getItem(REGISTERED_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as RegisteredAccount[];
  } catch {
    localStorage.removeItem(REGISTERED_STORAGE_KEY);
    return [];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [registeredAccounts, setRegisteredAccounts] = useState<RegisteredAccount[]>(
    () => readRegisteredAccounts(),
  );

  const login = async (payload: LoginFormValues): Promise<AuthActionResult> => {
    const matchedMockUser = mockUsers.find(
      (mockUser) =>
        mockUser.email.toLowerCase() === payload.email.toLowerCase() &&
        mockUser.password === payload.password,
    );

    const matchedRegisteredAccount = registeredAccounts.find(
      (registeredAccount) =>
        registeredAccount.user.email.toLowerCase() ===
          payload.email.toLowerCase() &&
        registeredAccount.password === payload.password,
    );

    const loggedInUser = matchedMockUser?.user ?? matchedRegisteredAccount?.user;

    if (loggedInUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedInUser));
      setUser(loggedInUser);
      return { success: true };
    }

    return {
      success: false,
      message: "Invalid credentials. Check your email/password and try again.",
    };
  };

  const register = async (
    payload: RegisterFormValues,
  ): Promise<AuthActionResult> => {
    const alreadyExists =
      mockUsers.some(
        (mockUser) =>
          mockUser.email.toLowerCase() === payload.email.toLowerCase(),
      ) ||
      registeredAccounts.some(
        (registeredAccount) =>
          registeredAccount.user.email.toLowerCase() ===
          payload.email.toLowerCase(),
      );

    if (alreadyExists) {
      return {
        success: false,
        message: "An account with this email already exists.",
      };
    }

    const newUser: AuthUser = {
      id: `U-${Date.now()}`,
      name: payload.fullName,
      email: payload.email,
      role: payload.role,
      nic: payload.nic,
      dob: payload.dob,
    };

    const newAccount: RegisteredAccount = {
      user: newUser,
      password: payload.password,
    };

    setRegisteredAccounts((currentAccounts) => {
      const updatedAccounts = [...currentAccounts, newAccount];
      localStorage.setItem(
        REGISTERED_STORAGE_KEY,
        JSON.stringify(updatedAccounts),
      );
      return updatedAccounts;
    });

    return {
      success: true,
      message: "Registration successful. You can log in now.",
    };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
    }),
    [user, registeredAccounts],
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
