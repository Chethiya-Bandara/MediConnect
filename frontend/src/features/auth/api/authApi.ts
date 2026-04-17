import type {
  AuthActionResult,
  AuthUser,
  LoginFormValues,
  RegisterFormValues,
} from "../../../types/auth";
import { apiRequest } from "../../../lib/api/client";
import { endpoints } from "../../../lib/api/endpoints";
import { buildRegisterPayload } from "../utils/registerPayload";

export async function loginRequest(payload: LoginFormValues) {
  return apiRequest<{ access_token: string }>(endpoints.auth.login, {
    method: "POST",
    body: JSON.stringify(payload),
  }, {
    auth: false,
  });
}

export async function getCurrentUser(token: string) {
  return apiRequest<
    AuthUser & {
      role: string;
      organisation_id?: number | null;
      admin_role?: string | null;
      doctor_id?: number | null;
      patient_id?: number | null;
      dhid?: string | null;
    }
  >(endpoints.auth.me, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }, {
    auth: false,
  });
}

export async function registerRequest(
  payload: RegisterFormValues,
): Promise<AuthActionResult> {
  const registerPayload = buildRegisterPayload(payload);

  const response = await apiRequest<{ message?: string }>(endpoints.auth.register, {
    method: "POST",
    body: JSON.stringify(registerPayload),
  }, {
    auth: false,
  });

  return {
    success: true,
    message: response.message || "Registration successful",
  };
}

export async function requestPasswordReset(
  email: string,
): Promise<AuthActionResult> {
  const response = await apiRequest<{ message?: string }>(endpoints.auth.forgotPassword, {
    method: "POST",
    body: JSON.stringify({ email }),
  }, {
    auth: false,
  });

  return {
    success: true,
    message: response.message || "Reset link request sent",
  };
}
