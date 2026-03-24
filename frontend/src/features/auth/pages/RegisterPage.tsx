import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Upload } from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { useAuth } from "../context/AuthContext";
import { roleOptions } from "../data/roles";
import { registrationSchema } from "../schemas";
import type { RegisterFormValues } from "../types";
import { calculateAge } from "../utils";
import { PortalFooter, PortalTopNav } from "../components";

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
      password: "",
      confirmPassword: "",
    },
  });

  const selectedRole = watch("role");
  const selectedDob = watch("dob");
  const showParentNic = useMemo(() => {
    const age = calculateAge(selectedDob);
    return selectedRole === "PATIENT" && age !== null && age < 18;
  }, [selectedRole, selectedDob]);

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
            <p className="side-kicker">Vitalis Nexus</p>
            <h2>Secure Health Identity</h2>
            <p>
              Join the centralized national framework for seamless healthcare
              delivery. One ID, a lifetime of care.
            </p>

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

            <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
              {submitMessage && (
                <AlertMessage type={submitMessage.type} message={submitMessage.text} />
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
                  placeholder="As per identity document"
                  error={errors.fullName?.message}
                  {...register("fullName")}
                />

                <InputField
                  id="email"
                  type="email"
                  label="Primary Email"
                  placeholder="name@domain.gov"
                  error={errors.email?.message}
                  {...register("email")}
                />

                <InputField
                  id="nic"
                  label="National Identity Card (NIC)"
                  placeholder="200112345678 or 901234567V"
                  error={errors.nic?.message}
                  {...register("nic")}
                />

                <InputField
                  id="dob"
                  type="date"
                  label="Date of Birth"
                  error={errors.dob?.message}
                  {...register("dob")}
                />

                {showParentNic && (
                  <InputField
                    id="parentNic"
                    label="Guardian NIC (For Minors)"
                    placeholder="Guardian NIC required"
                    error={errors.parentNic?.message}
                    {...register("parentNic")}
                  />
                )}

                <InputField
                  id="password"
                  type="password"
                  label="Password"
                  placeholder="Minimum 8 chars"
                  error={errors.password?.message}
                  {...register("password")}
                />

                <InputField
                  id="confirmPassword"
                  type="password"
                  label="Confirm Password"
                  placeholder="Repeat password"
                  error={errors.confirmPassword?.message}
                  {...register("confirmPassword")}
                />
              </div>

              <section className="upload-box">
                <div className="upload-head">
                  <Upload size={18} />
                  <h3>Professional Verification</h3>
                </div>
                <label className="upload-drop">
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" />
                  <span>Upload License / Credential</span>
                  <small>Max 5MB • PDF, JPG, PNG</small>
                </label>
              </section>

              <div className="register-actions">
                <p>
                  By continuing, you agree to the National Health Data Sovereignty
                  Protocol.
                </p>
                <Button type="submit" className="primary-button" isLoading={isSubmitting}>
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
