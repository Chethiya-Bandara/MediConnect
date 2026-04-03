import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Upload } from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { useAuth } from "../context/AuthContext";
import { PortalFooter, PortalTopNav } from "../components";
import { roleOptions } from "../data/roles";
import { registrationSchema } from "../schemas";
import type { RegisterFormValues } from "../types";
import { calculateAge } from "../utils";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [submitMessage, setSubmitMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const {
    register,
    watch,
    handleSubmit,
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
  const age = calculateAge(selectedDob);
  const showParentNic =
    selectedRole === "PATIENT" && age !== null && age < 18;
  const showCredentialUpload = selectedRole !== "PATIENT";
  const credentialLabel =
    selectedRole === "PHARMACIST" || selectedRole === "PHARMACY_ADMIN"
      ? "Upload Pharmacy Credential"
      : "Upload License / Credential";

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
      text: result.message ?? "Account created successfully.",
    });
    window.setTimeout(() => navigate("/login"), 1200);
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
              onSubmit={handleSubmit(onSubmit)}
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
                    error={errors.parentNic?.message}
                  />
                )}

                {selectedRole === "DOCTOR" && (
                  <>
                    <InputField
                      id="specialization"
                      label="Specialization"
                      {...register("specialization")}
                      error={errors.specialization?.message}
                    />

                    <InputField
                      id="licenseNumber"
                      label="License Number"
                      {...register("licenseNumber")}
                      error={errors.licenseNumber?.message}
                    />
                  </>
                )}

                {selectedRole === "PHARMACIST" && (
                  <InputField
                    id="pharmacyId"
                    label="Pharmacy ID"
                    {...register("pharmacyId")}
                    error={errors.pharmacyId?.message}
                  />
                )}

                {["HOSPITAL_ADMIN", "PHARMACY_ADMIN", "HEALTH_MINISTRY_ADMIN"].includes(selectedRole) && (
                  <InputField
                    id="organizationId"
                    label="Organization ID"
                    {...register("organisationId")}
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
                  <label className="upload-drop">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      {...register("credentialFile")}
                    />
                    <span>{credentialLabel}</span>
                    <small>Max 5MB • PDF, JPG, PNG</small>
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
                >
                  Create Digital Health ID
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
