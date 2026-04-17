import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Upload } from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { useAuth } from "../context/AuthContext";
import { PortalFooter, PortalTopNav } from "../components";
import { roleOptions } from "../data/roles";
import { registrationSchema } from "../schemas/registerSchema";
import type { RegisterFormValues } from "../types";
import { calculateAge } from "../utils";

const ROLE_FIELD_ORDER: Record<string, string[]> = {
  PATIENT: ["role", "fullName", "email", "nic", "dob", "parentNic", "password", "confirmPassword"],
  DOCTOR: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "specialization",
    "licenseNumber",
    "password",
    "confirmPassword",
    "credentialFile",
  ],
  PHARMACIST: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "pharmacyId",
    "password",
    "confirmPassword",
    "credentialFile",
  ],
  HOSPITAL_ADMIN: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "organisationId",
    "password",
    "confirmPassword",
    "credentialFile",
  ],
  PHARMACY_ADMIN: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "organisationId",
    "password",
    "confirmPassword",
    "credentialFile",
  ],
  HEALTH_MINISTRY_ADMIN: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "password",
    "confirmPassword",
    "credentialFile",
  ],
};

const ROLE_HELPERS = {
  PATIENT: {
    nic: "Use the patient NIC. Underage patients must also provide a guardian NIC.",
  },
  DOCTOR: {
    specialization: "Use the specialty label you want displayed in the portal.",
    licenseNumber: "Enter the SLMC or professional registration number exactly as issued.",
  },
  PHARMACIST: {
    pharmacyId: "Enter the pharmacy organisation ID assigned to your branch.",
  },
  HOSPITAL_ADMIN: {
    organisationId: "Enter the hospital organisation ID already created in the system.",
  },
  PHARMACY_ADMIN: {
    organisationId: "Enter the pharmacy organisation ID already registered in the system.",
  },
  HEALTH_MINISTRY_ADMIN: {
    credential: "Ministry admin accounts are centrally governed, so no organisation ID is needed here.",
  },
} as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [submitMessage, setSubmitMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const redirectTimeoutRef = useRef<number | null>(null);

  const {
    register,
    watch,
    handleSubmit,
    clearErrors,
    resetField,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      role: "PATIENT",
      fullName: "",
      email: "",
      nic: "",
      dob: "",
      parentNic: "",
      specialization: "",
      licenseNumber: "",
      pharmacyId: "",
      password: "",
      confirmPassword: "",
    },
  });

  const selectedRole = watch("role");
  const selectedDob = watch("dob");
  const credentialFiles = watch("credentialFile");
  const age = calculateAge(selectedDob);
  const showParentNic =
    selectedRole === "PATIENT" && age !== null && age < 18;
  const showCredentialUpload = selectedRole !== "PATIENT";
  const showOrganisationId =
    selectedRole === "HOSPITAL_ADMIN" || selectedRole === "PHARMACY_ADMIN";
  const credentialLabel =
    selectedRole === "PHARMACIST" || selectedRole === "PHARMACY_ADMIN"
      ? "Upload Pharmacy Credential"
      : "Upload License / Credential";
  const selectedRoleOption = useMemo(
    () => roleOptions.find((role) => role.value === selectedRole),
    [selectedRole],
  );
  const selectedCredentialName = credentialFiles?.item(0)?.name;

  useEffect(() => {
    setSubmitMessage(null);
    clearErrors();

    if (selectedRole !== "PATIENT") {
      resetField("parentNic", { defaultValue: "" });
    }

    if (selectedRole !== "DOCTOR") {
      resetField("specialization", { defaultValue: "" });
      resetField("licenseNumber", { defaultValue: "" });
    }

    if (selectedRole !== "PHARMACIST") {
      resetField("pharmacyId", { defaultValue: "" });
    }

    if (selectedRole !== "HOSPITAL_ADMIN" && selectedRole !== "PHARMACY_ADMIN") {
      resetField("organisationId", { defaultValue: "" });
    }

    if (selectedRole === "PATIENT") {
      resetField("credentialFile");
    }
  }, [clearErrors, resetField, selectedRole]);

  useEffect(() => () => {
    if (redirectTimeoutRef.current) {
      window.clearTimeout(redirectTimeoutRef.current);
    }
  }, []);

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitMessage(null);
    const result = await registerUser(values);

    if (!result.success) {
      setSubmitMessage({
        type: "error",
        text: result.message ?? "Registration failed.",
      });
      return;
    }

    setSubmitMessage({
      type: "success",
      text: result.message ?? "Account created successfully. Redirecting to login...",
    });
    redirectTimeoutRef.current = window.setTimeout(() => navigate("/login"), 1500);
  };

  const onInvalid = () => {
    const fieldOrder = ROLE_FIELD_ORDER[selectedRole] ?? ROLE_FIELD_ORDER.PATIENT;
    const firstInvalidField = fieldOrder.find((fieldName) => fieldName in errors);

    if (!firstInvalidField) {
      return;
    }

    if (firstInvalidField !== "credentialFile") {
      setFocus(firstInvalidField as keyof RegisterFormValues);
    }

    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[name="${firstInvalidField}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus();
    });
  };

  return (
    <div className="portal-page">
      <PortalTopNav />

      <main className="auth-main register-layout">
        <section className="register-card">
          <aside className="register-side">
            <div>
              <p className="side-kicker">Vitalis Nexus</p>
              <h2>Secure Health Identity</h2>
              <p>
                Join the centralized national framework for seamless healthcare
                delivery. One ID, a lifetime of care.
              </p>
            </div>

            <div className="side-badge">
              <BadgeCheck size={18} />
              <div>
                <strong>Encrypted Vault</strong>
                <small>Healthcare-grade compliance workflow.</small>
              </div>
            </div>
          </aside>

          <section className="register-form-wrap">
            <div className="step-strip">
              <div className="active">1 Account Setup</div>
              <div className="line" />
              <div>2 Verification</div>
            </div>

            <form
              className="auth-form"
              onSubmit={handleSubmit(onSubmit, onInvalid)}
              noValidate
            >
              {submitMessage && (
                <AlertMessage
                  type={submitMessage.type}
                  message={submitMessage.text}
                />
              )}

              <label className="field-wrapper">
                <span className="field-label">Portal Role</span>
                <select className="field-input field-select" {...register("role")}>
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                {errors.role?.message && (
                  <span className="field-error">{errors.role.message}</span>
                )}
                {!errors.role?.message && selectedRoleOption?.description && (
                  <span className="field-helper">{selectedRoleOption.description}</span>
                )}
              </label>

              <div className="grid-two">
                <InputField
                  id="fullName"
                  label="Legal Full Name"
                  {...register("fullName")}
                  error={errors.fullName?.message}
                />

                <InputField
                  id="email"
                  type="email"
                  label="Primary Email"
                  {...register("email")}
                  error={errors.email?.message}
                />

                <InputField
                  id="nic"
                  label="NIC"
                  {...register("nic")}
                  helperText={ROLE_HELPERS.PATIENT.nic}
                  error={errors.nic?.message}
                />

                <InputField
                  id="dob"
                  type="date"
                  label="Date of Birth"
                  {...register("dob")}
                  error={errors.dob?.message}
                />

                {showParentNic && (
                  <InputField
                    id="parentNic"
                    label="Guardian NIC"
                    {...register("parentNic")}
                    helperText="Required only when the patient is under 18 years old."
                    error={errors.parentNic?.message}
                  />
                )}

                {selectedRole === "DOCTOR" && (
                  <>
                    <InputField
                      id="specialization"
                      label="Specialization"
                      {...register("specialization")}
                      helperText={ROLE_HELPERS.DOCTOR.specialization}
                      error={errors.specialization?.message}
                    />

                    <InputField
                      id="licenseNumber"
                      label="License Number"
                      {...register("licenseNumber")}
                      helperText={ROLE_HELPERS.DOCTOR.licenseNumber}
                      error={errors.licenseNumber?.message}
                    />
                  </>
                )}

                {selectedRole === "PHARMACIST" && (
                  <InputField
                    id="pharmacyId"
                    label="Pharmacy ID"
                    {...register("pharmacyId")}
                    helperText={ROLE_HELPERS.PHARMACIST.pharmacyId}
                    error={errors.pharmacyId?.message}
                  />
                )}

                {showOrganisationId && (
                  <InputField
                    id="organizationId"
                    label="Organization ID"
                    {...register("organisationId")}
                    helperText={
                      selectedRole === "HOSPITAL_ADMIN"
                        ? ROLE_HELPERS.HOSPITAL_ADMIN.organisationId
                        : ROLE_HELPERS.PHARMACY_ADMIN.organisationId
                    }
                    error={errors.organisationId?.message}
                  />
                )}

                <InputField
                  id="password"
                  type="password"
                  label="Password"
                  {...register("password")}
                  error={errors.password?.message}
                />

                <InputField
                  id="confirmPassword"
                  type="password"
                  label="Confirm Password"
                  {...register("confirmPassword")}
                  error={errors.confirmPassword?.message}
                />
              </div>

              {showCredentialUpload && (
                <section className="upload-box">
                  <div className="upload-head">
                    <Upload size={18} />
                    <h3>Professional Verification</h3>
                  </div>
                  {selectedRole === "HEALTH_MINISTRY_ADMIN" && (
                    <p className="field-helper upload-helper">
                      {ROLE_HELPERS.HEALTH_MINISTRY_ADMIN.credential}
                    </p>
                  )}
                  <label className="upload-drop">
                    <input
                      key={selectedRole}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      {...register("credentialFile")}
                    />
                    <span>{selectedCredentialName ?? credentialLabel}</span>
                    <small>
                      {selectedCredentialName
                        ? "Selected file is ready to be submitted with this request."
                        : "Max 5MB • PDF, JPG, PNG"}
                    </small>
                  </label>
                </section>
              )}

              <div className="register-actions">
                <p>
                  By continuing, you agree to the National Health Data
                  Sovereignty Protocol.
                </p>
                <Button
                  type="submit"
                  className="primary-button"
                  isLoading={isSubmitting}
                  disabled={submitMessage?.type === "success"}
                >
                  {submitMessage?.type === "success"
                    ? "Redirecting..."
                    : "Create Digital Health ID"}
                </Button>
              </div>

              <p className="switch-row">
                Already have an account?
                <Link to="/login">Back to login</Link>
              </p>
            </form>
          </section>
        </section>
      </main>

      <PortalFooter />
    </div>
  );
}
