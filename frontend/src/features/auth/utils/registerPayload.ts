import type { RegisterFormValues, UserRole } from "../../../types/auth";

type RegisterRequestPayload = {
  email: string;
  password: string;
  role: UserRole;
  fullName: string;
  nic: string;
  dob: string;
  parentNic?: string;
  specialization?: string;
  licenseNumber?: string;
  pharmacyId?: string;
  organisationId?: string;
  credentialFileName?: string;
  credentialFileSize?: number;
  credentialFileType?: string;
};

function trimToUndefined(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeDob(value: string) {
  return value.trim();
}

export function buildRegisterPayload(
  payload: RegisterFormValues,
): RegisterRequestPayload {
  const credentialFile = payload.credentialFile?.item(0);
  const role = payload.role;

  const registerPayload: RegisterRequestPayload = {
    email: payload.email.trim(),
    password: payload.password,
    role,
    fullName: payload.fullName.trim(),
    nic: payload.nic.trim(),
    dob: normalizeDob(payload.dob),
  };

  if (role === "PATIENT") {
    const parentNic = trimToUndefined(payload.parentNic);
    if (parentNic) {
      registerPayload.parentNic = parentNic;
    }
  }

  if (role === "DOCTOR") {
    const specialization = trimToUndefined(payload.specialization);
    const licenseNumber = trimToUndefined(payload.licenseNumber);

    if (specialization) {
      registerPayload.specialization = specialization;
    }

    if (licenseNumber) {
      registerPayload.licenseNumber = licenseNumber;
    }
  }

  if (role === "PHARMACIST") {
    const pharmacyId = trimToUndefined(payload.pharmacyId);
    if (pharmacyId) {
      registerPayload.pharmacyId = pharmacyId;
    }
  }

  if (role === "HOSPITAL_ADMIN" || role === "PHARMACY_ADMIN") {
    const organisationId = trimToUndefined(payload.organisationId);
    if (organisationId) {
      registerPayload.organisationId = organisationId;
    }
  }

  if (role !== "PATIENT" && credentialFile) {
    registerPayload.credentialFileName = credentialFile.name;
    registerPayload.credentialFileSize = credentialFile.size;
    registerPayload.credentialFileType = credentialFile.type;
  }

  return registerPayload;
}
