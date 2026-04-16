import type { UserRole } from "../../types/auth";

export function resolveDashboardRole(role?: UserRole | null): UserRole {
  return role ?? "PATIENT";
}

export function getRoleLandingPath(_role?: UserRole | null) {
  return "/dashboard";
}
