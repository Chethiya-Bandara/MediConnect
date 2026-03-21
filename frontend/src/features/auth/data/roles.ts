import type { UserRole } from "../types";

interface RoleOption {
  value: UserRole;
  label: string;
  description: string;
}

export const roleOptions: RoleOption[] = [
  {
    value: "PATIENT",
    label: "Patient",
    description: "Access your medical records and appointment booking.",
  },
  {
    value: "DOCTOR",
    label: "Doctor",
    description: "Manage consultations, encounters, and ePrescriptions.",
  },
  {
    value: "PHARMACIST",
    label: "Pharmacist",
    description: "Dispense medicine and update prescription status.",
  },
  {
    value: "HOSPITAL_ADMIN",
    label: "Hospital Admin",
    description: "Manage affiliations, schedules, and doctor operations.",
  },
  {
    value: "PHARMACY_ADMIN",
    label: "Pharmacy Admin",
    description: "Control stock, medicine pricing, and inventory workflow.",
  },
  {
    value: "HEALTH_MINISTRY_ADMIN",
    label: "Health Ministry Admin",
    description: "Oversee approvals, analytics, and governance metrics.",
  },
];
