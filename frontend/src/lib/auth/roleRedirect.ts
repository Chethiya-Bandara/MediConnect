import type { UserRole } from "../../types/auth";

const rolePathMap: Record<UserRole, string> = {
  PATIENT: "/dashboard/patient",
  DOCTOR: "/dashboard/doctor",
  PHARMACIST: "/dashboard/pharmacist",
  PHARMACY_ADMIN: "/dashboard/pharmacy-admin",
  HOSPITAL_ADMIN: "/dashboard/hospital-admin",
  HEALTH_MINISTRY_ADMIN: "/dashboard/health-ministry-admin",
};

export function resolveDashboardRole(role?: UserRole | null): UserRole {
  return role ?? "PATIENT";
}

export function getRoleLandingPath(role?: UserRole | null) {
  return rolePathMap[resolveDashboardRole(role)];
}
