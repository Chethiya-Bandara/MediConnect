import type { UserRole } from "../../../types/auth";

interface RoleOption {
  value: UserRole;
  label: string;
  description: string;
}

export const roleOptions: RoleOption[] = [
  {
    value: "PATIENT",
    label: "Patient",
    description: "",
  },
  {
    value: "DOCTOR",
    label: "Doctor",
    description: "",
  },
  {
    value: "PHARMACIST",
    label: "Pharmacist",
    description: "",
  },
  {
    value: "HOSPITAL_ADMIN",
    label: "Hospital Admin",
    description: "",
  },
  {
    value: "PHARMACY_ADMIN",
    label: "Pharmacy Admin",
    description: "",
  },
  {
    value: "HEALTH_MINISTRY_ADMIN",
    label: "Health Ministry Admin",
    description: "",
  },
];
