import type {
  AuthActionResult,
  AuthUser,
  LoginFormValues,
  RegisterFormValues,
} from "../../../types/auth";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";

export async function loginRequest(payload: LoginFormValues) {
  return apiRequest<{ access_token: string }>(
    endpoints.auth.login,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      auth: false,
    },
  );
}

export async function getCurrentUser(token: string) {
  return apiRequest<
    AuthUser & {
      role: string;
      preferred_name?: string | null;
      legal_name?: string | null;
      address?: string | null;
      status?: string | null;
      organisation_id?: number | null;
      organisation_name?: string | null;
      organisation_type?: string | null;
      organisation_status?: string | null;
      admin_role?: string | null;
      doctor_id?: number | null;
      patient_id?: number | null;
      dhid?: string | null;
      license_number?: string | null;
    }
  >(
    endpoints.auth.me,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    {
      auth: false,
    },
  );
}

export async function registerRequest(payload: RegisterFormValues): Promise<AuthActionResult> {
  const nicImage = payload.nicImage?.item(0);
  if (!nicImage) {
    return {
      success: false,
      message: "NIC image is required.",
    };
  }

  const formData = new FormData();
  formData.set("email", payload.email.trim());
  formData.set("password", payload.password);
  formData.set("role", payload.role);
  formData.set("fullName", payload.fullName.trim());
  formData.set("preferredName", payload.preferredName.trim());
  formData.set("nic", payload.nic.trim());
  formData.set("dob", payload.dob.trim());
  formData.set("gender", payload.gender);
  formData.set("address", payload.address.trim());
  formData.set("nicImage", nicImage);

  if (payload.parentNic?.trim()) {
    formData.set("parentNic", payload.parentNic.trim());
  }
  if (payload.specialization?.trim()) {
    formData.set("specialization", payload.specialization.trim());
  }
  if (payload.licenseNumber?.trim()) {
    formData.set("licenseNumber", payload.licenseNumber.trim());
  }
  if (payload.organisationId?.trim()) {
    formData.set("organisationId", payload.organisationId.trim());
  }

  const response = await apiRequest<{ message?: string }>(
    endpoints.auth.register,
    {
      method: "POST",
      body: formData,
    },
    {
      auth: false,
    },
  );

  return {
    success: true,
    message: response.message || "Registration successful",
  };
}

export async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  const response = await apiRequest<{ message?: string }>(
    endpoints.auth.forgotPassword,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
    {
      auth: false,
    },
  );

  return {
    success: true,
    message: response.message || "Reset link request sent",
  };
}
