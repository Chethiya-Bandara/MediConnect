import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Building2,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Pill,
  X,
  ShieldPlus,
  Stethoscope,
  Upload,
  UserRound,
} from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { useAuth } from "../context/AuthContext";
import { PortalFooter, PortalTopNav } from "../components";
import { roleOptions } from "../data/roles";
import { registrationSchema } from "../schemas/registerSchema";
import type { RegisterFormValues } from "../types";
import { calculateAge } from "../utils";

const ROLE_FIELD_ORDER: Record<string, string[]> = {
  PATIENT: ["role", "fullName", "email", "nic", "dob", "gender", "parentNic", "password", "confirmPassword"],
  DOCTOR: [
    "role",
    "fullName",
    "email",
    "nic",
    "dob",
    "gender",
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
    "gender",
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
    "gender",
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
    "gender",
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
    "gender",
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

const ROLE_ICONS = {
  PATIENT: UserRound,
  DOCTOR: Stethoscope,
  PHARMACIST: Pill,
  HOSPITAL_ADMIN: Building2,
  PHARMACY_ADMIN: ShieldPlus,
  HEALTH_MINISTRY_ADMIN: Building2,
} as const;

const PASSWORD_RULES = [
  {
    id: "length",
    label: "At least 10 characters",
    test: (value: string) => value.length >= 10,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (value: string) => /[A-Z]/.test(value),
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    test: (value: string) => /[a-z]/.test(value),
  },
  {
    id: "number",
    label: "One number",
    test: (value: string) => /\d/.test(value),
  },
  {
    id: "special",
    label: "One special character",
    test: (value: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value),
  },
  {
    id: "spaces",
    label: "No spaces",
    test: (value: string) => !/\s/.test(value),
  },
] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const roleSelectRef = useRef<HTMLDivElement | null>(null);
  const genderSelectRef = useRef<HTMLDivElement | null>(null);
  const [submitMessage, setSubmitMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isGenderMenuOpen, setIsGenderMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  const {
    register,
    watch,
    handleSubmit,
    clearErrors,
    resetField,
    setValue,
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
      gender: "",
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
  const selectedGender = watch("gender");
  const passwordValue = watch("password");
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
  const isVerificationStage = submitMessage?.type === "success";
  const passwordRuleStates = PASSWORD_RULES.map((rule) => ({
    ...rule,
    passed: rule.test(passwordValue ?? ""),
  }));

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

  useEffect(() => {
    setIsRoleMenuOpen(false);
  }, [selectedRole]);

  useEffect(() => {
    setIsGenderMenuOpen(false);
  }, [selectedGender]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!roleSelectRef.current?.contains(event.target as Node)) {
        setIsRoleMenuOpen(false);
      }
      if (!genderSelectRef.current?.contains(event.target as Node)) {
        setIsGenderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
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
              <h2>Secure Health Identity</h2>
              <p>
                Join the centralized national framework for seamless healthcare
                delivery. One ID, a lifetime of care.
              </p>
            </div>
          </aside>

          <section className="register-form-wrap">
            <div className="step-strip">
              <div className={isVerificationStage ? "step-strip__step" : "step-strip__step active"}>
                1 Account Setup
              </div>
              <div className="line" />
              <div className={isVerificationStage ? "step-strip__step active step-strip__step--verification" : "step-strip__step"}>
                2 Verification
              </div>
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
                <input type="hidden" {...register("role")} />
                <div
                  ref={roleSelectRef}
                  className={`custom-select ${errors.role ? "custom-select--error" : ""} ${
                    isRoleMenuOpen ? "custom-select--open" : ""
                  }`}
                >
                  <button
                    id="role"
                    name="role"
                    type="button"
                    className="custom-select__trigger"
                    aria-haspopup="listbox"
                    aria-expanded={isRoleMenuOpen}
                    onClick={() => setIsRoleMenuOpen((current) => !current)}
                  >
                    <span>{selectedRoleOption?.label ?? "Select role"}</span>
                    <ChevronDown
                      size={18}
                      className={`custom-select__chevron ${
                        isRoleMenuOpen ? "custom-select__chevron--open" : ""
                      }`}
                    />
                  </button>

                  {isRoleMenuOpen && (
                    <div className="custom-select__menu" role="listbox" aria-labelledby="role">
                      {roleOptions.map((role) => (
                        (() => {
                          const RoleIcon = ROLE_ICONS[role.value];

                          return (
                            <button
                              key={role.value}
                              type="button"
                              role="option"
                              aria-selected={selectedRole === role.value}
                              className={`custom-select__option custom-select__option--compact ${
                                selectedRole === role.value ? "custom-select__option--selected" : ""
                              }`}
                              onClick={() => {
                                setValue("role", role.value, {
                                  shouldDirty: true,
                                  shouldTouch: true,
                                  shouldValidate: true,
                                });
                                setIsRoleMenuOpen(false);
                              }}
                            >
                              <span className="custom-select__option-row">
                                <span className="custom-select__option-icon">
                                  <RoleIcon size={16} />
                                </span>
                                <span className="custom-select__option-label">{role.label}</span>
                              </span>
                            </button>
                          );
                        })()
                      ))}
                    </div>
                  )}
                </div>
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

                {!showParentNic ? (
                  <InputField
                    id="nic"
                    label="NIC"
                    {...register("nic")}
                    error={errors.nic?.message}
                  />
                ) : (
                  <InputField
                    id="parentNic"
                    label="Guardian NIC"
                    {...register("parentNic")}
                    error={errors.parentNic?.message}
                  />
                )}

                <InputField
                  id="dob"
                  type="date"
                  label="Date of Birth"
                  {...register("dob")}
                  error={errors.dob?.message}
                />

                <label className="field-wrapper" htmlFor="gender">
                  <span className="field-label">Gender</span>
                  <input type="hidden" {...register("gender")} />
                  <div
                    ref={genderSelectRef}
                    className={`custom-select ${errors.gender ? "custom-select--error" : ""} ${
                      isGenderMenuOpen ? "custom-select--open" : ""
                    }`}
                  >
                    <button
                      id="gender"
                      name="gender"
                      type="button"
                      className="custom-select__trigger"
                      aria-haspopup="listbox"
                      aria-expanded={isGenderMenuOpen}
                      onClick={() => setIsGenderMenuOpen((current) => !current)}
                    >
                      <span>
                        {selectedGender === "MALE"
                          ? "Male"
                          : selectedGender === "FEMALE"
                            ? "Female"
                            : "Select gender"}
                      </span>
                      <ChevronDown
                        size={18}
                        className={`custom-select__chevron ${
                          isGenderMenuOpen ? "custom-select__chevron--open" : ""
                        }`}
                      />
                    </button>

                    {isGenderMenuOpen && (
                      <div className="custom-select__menu" role="listbox" aria-labelledby="gender">
                        {[
                          { value: "MALE", label: "Male" },
                          { value: "FEMALE", label: "Female" },
                        ].map((gender) => (
                          <button
                            key={gender.value}
                            type="button"
                            role="option"
                            aria-selected={selectedGender === gender.value}
                            className={`custom-select__option custom-select__option--compact ${
                              selectedGender === gender.value ? "custom-select__option--selected" : ""
                            }`}
                            onClick={() => {
                              setValue("gender", gender.value, {
                                shouldDirty: true,
                                shouldTouch: true,
                                shouldValidate: true,
                              });
                              setIsGenderMenuOpen(false);
                            }}
                          >
                            <span className="custom-select__option-label">{gender.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.gender?.message && (
                    <span className="field-error">{errors.gender.message}</span>
                  )}
                </label>

                {selectedRole === "PATIENT" && showParentNic && (
                  <div className="grid-full">
                    <span className="field-helper">{ROLE_HELPERS.PATIENT.nic}</span>
                  </div>
                )}

                {showParentNic && (
                  <div className="grid-full">
                    <span className="field-helper">
                      Required for patients under 18 years old.
                    </span>
                  </div>
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

              </div>

              <section className="password-section">
                <div className="password-section__grid">
                  <label className="field-wrapper" htmlFor="password">
                    <span className="field-label">Password</span>
                    <div className="field-control">
                      <span className="field-icon">
                        <Lock size={18} />
                      </span>
                      <input
                        id="password"
                        className={`field-input field-input--with-icon field-input--with-toggle ${
                          errors.password ? "field-input--error" : ""
                        }`}
                        type={showPassword ? "text" : "password"}
                        placeholder="Create a strong password"
                        {...register("password")}
                      />
                      <button
                        className="password-toggle"
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {errors.password?.message && (
                      <span className="field-error">{errors.password.message}</span>
                    )}
                  </label>

                  <label className="field-wrapper" htmlFor="confirmPassword">
                    <span className="field-label">Confirm Password</span>
                    <div className="field-control">
                      <span className="field-icon">
                        <Lock size={18} />
                      </span>
                      <input
                        id="confirmPassword"
                        className={`field-input field-input--with-icon field-input--with-toggle ${
                          errors.confirmPassword ? "field-input--error" : ""
                        }`}
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Re-enter your password"
                        {...register("confirmPassword")}
                      />
                      <button
                        className="password-toggle"
                        type="button"
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowConfirmPassword((current) => !current)}
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {errors.confirmPassword?.message && (
                      <span className="field-error">{errors.confirmPassword.message}</span>
                    )}
                  </label>
                </div>

                <ul className="password-requirements">
                  {passwordRuleStates.map((rule) => (
                    <li
                      key={rule.id}
                      className={rule.passed ? "password-requirements__item is-met" : "password-requirements__item"}
                    >
                      <span className="password-requirements__icon" aria-hidden="true">
                        {rule.passed ? <Check size={14} /> : <X size={14} />}
                      </span>
                      <span>{rule.label}</span>
                    </li>
                  ))}
                </ul>
              </section>

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
