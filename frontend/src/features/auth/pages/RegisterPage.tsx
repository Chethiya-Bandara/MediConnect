import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  AlertCircle,
  Building2,
  ChevronLeft,
  IdCard,
  Lock,
  Mail,
  Pill,
  Shield,
  User,
} from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { roleOptions } from "../data/roles";
import { useAuth } from "../context/AuthContext";
import { registrationSchema } from "../schemas";
import type { RegisterFormValues, UserRole } from "../types";
import { calculateAge } from "../utils";

const roleIconMap = {
  PATIENT: User,
  DOCTOR: Activity,
  PHARMACIST: Pill,
  HOSPITAL_ADMIN: Building2,
  PHARMACY_ADMIN: Pill,
  HEALTH_MINISTRY_ADMIN: Shield,
} as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [submitMessage, setSubmitMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const {
    register,
    setValue,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      fullName: "",
      email: "",
      role: "PATIENT",
      nic: "",
      dob: "",
      parentNic: "",
      password: "",
      confirmPassword: "",
    },
  });

  const selectedRole = watch("role");
  const selectedDob = watch("dob");

  const selectedRoleMeta = roleOptions.find((role) => role.value === selectedRole);

  const showParentNic = useMemo(() => {
    const age = calculateAge(selectedDob);
    return selectedRole === "PATIENT" && age !== null && age < 18;
  }, [selectedDob, selectedRole]);

  const chooseRole = (role: UserRole) => {
    setValue("role", role, { shouldValidate: true });
    setStep(2);
  };

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
      text: result.message ?? "Registration successful.",
    });
    window.setTimeout(() => navigate("/login"), 1200);
  };

  return (
    <section className="auth-view">
      {step === 1 && (
        <>
          <header className="auth-view-header">
            <h2>Create Account</h2>
            <p>Step 1: Select your role</p>
          </header>

          <div className="role-grid">
            {roleOptions.map((role) => {
              const Icon = roleIconMap[role.value];
              return (
                <button
                  key={role.value}
                  type="button"
                  className="role-card"
                  onClick={() => chooseRole(role.value)}
                >
                  <span className="role-card-icon">
                    <Icon size={20} />
                  </span>
                  <span className="role-card-body">
                    <strong>{role.label}</strong>
                    <small>{role.description}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="auth-footer-text">
            Already have an account? <Link to="/login">Back to login</Link>
          </p>
        </>
      )}

      {step === 2 && (
        <>
          <header className="auth-view-header auth-view-header-row">
            <button type="button" className="back-btn" onClick={() => setStep(1)}>
              <ChevronLeft size={18} />
            </button>
            <div>
              <h2>Register as {selectedRoleMeta?.label ?? "User"}</h2>
              <p>Step 2: Enter your details</p>
            </div>
          </header>

          <form className="form-grid" onSubmit={handleSubmit(onSubmit)} noValidate>
            {submitMessage && (
              <AlertMessage type={submitMessage.type} message={submitMessage.text} />
            )}

            <InputField
              id="fullName"
              label="Full Name"
              placeholder="John Doe"
              leadingIcon={<User size={18} />}
              error={errors.fullName?.message}
              {...register("fullName")}
            />

            <InputField
              id="email"
              type="email"
              label="Email Address"
              placeholder="name@example.com"
              leadingIcon={<Mail size={18} />}
              error={errors.email?.message}
              {...register("email")}
            />

            <InputField
              id="nic"
              label="NIC Number"
              placeholder="200112345678 or 123456789V"
              leadingIcon={<IdCard size={18} />}
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

            {selectedRole === "PATIENT" && (
              <p className="minor-note">
                <AlertCircle size={14} />
                If patient is under 18, parent/guardian NIC is required.
              </p>
            )}

            {showParentNic && (
              <InputField
                id="parentNic"
                label="Parent/Guardian NIC"
                placeholder="Required for underage registration"
                leadingIcon={<IdCard size={18} />}
                error={errors.parentNic?.message}
                {...register("parentNic")}
              />
            )}

            <InputField
              id="password"
              type="password"
              label="Password"
              placeholder="Minimum 8 chars, letters + numbers"
              leadingIcon={<Lock size={18} />}
              error={errors.password?.message}
              {...register("password")}
            />

            <InputField
              id="confirmPassword"
              type="password"
              label="Confirm Password"
              placeholder="Re-enter password"
              leadingIcon={<Lock size={18} />}
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />

            <Button type="submit" className="auth-submit" isLoading={isSubmitting}>
              Complete Registration
            </Button>
          </form>

          <p className="auth-footer-text">
            Already have an account? <Link to="/login">Back to login</Link>
          </p>
        </>
      )}
    </section>
  );
}
