export type UserRole =
  | "PATIENT"
  | "DOCTOR"
  | "HEALTH_MINISTRY_ADMIN"
  | "HOSPITAL_ADMIN"
  | "PHARMACIST"
  | "PHARMACY_ADMIN";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  nic: string;
  dob: string;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues {
  fullName: string;
  email: string;
  role: UserRole;
  nic: string;
  dob: string;
  parentNic?: string;
  password: string;
  confirmPassword: string;
}

export interface AuthActionResult {
  success: boolean;
  message?: string;
}
