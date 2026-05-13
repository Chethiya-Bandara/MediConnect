export type UserRole =
  | "PATIENT"
  | "DOCTOR"
  | "HEALTH_MINISTRY_ADMIN"
  | "HOSPITAL_ADMIN"
  | "PHARMACIST"
  | "PHARMACY_ADMIN";

export type Gender = "MALE" | "FEMALE";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status?: string | null;
  preferredName?: string | null;
  legalName?: string | null;
  address?: string | null;
  nic?: string;
  dob?: string;
  gender?: Gender;
  organisationId?: number | null;
  organisationName?: string | null;
  organisationType?: string | null;
  organisationStatus?: string | null;
  adminRole?: string | null;
  doctorId?: number | null;
  patientId?: number | null;
  dhid?: string | null;
  licenseNumber?: string | null;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues {
  fullName: string;
  preferredName: string;
  email: string;
  role: UserRole;
  nic: string;
  dob: string;
  gender: string;
  address: string;
  parentNic?: string | undefined;
  password: string;
  confirmPassword: string;
  specialization?: string | undefined;
  licenseNumber?: string | undefined;
  organisationId?: string | undefined;
  nicImage?: FileList;
}

export interface AuthActionResult {
  success: boolean;
  message?: string;
  role?: UserRole;
}
