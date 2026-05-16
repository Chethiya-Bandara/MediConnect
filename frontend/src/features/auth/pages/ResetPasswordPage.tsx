import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Lock } from "lucide-react";
import { z } from "zod";
import { AlertMessage, Button } from "../../../components/ui";
import { PortalFooter, PortalTopNav } from "../components";
import { useAuth } from "../context/AuthContext";

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Password must be at least 10 characters.")
      .max(128, "Password must not exceed 128 characters.")
      .regex(/[A-Z]/, "Must include at least one uppercase letter.")
      .regex(/[a-z]/, "Must include at least one lowercase letter.")
      .regex(/\d/, "Must include at least one number.")
      .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "Must include a special character.")
      .refine((value) => !/\s/.test(value), "Must not contain spaces"),
    confirmPassword: z.string().min(1, "Please confirm password."),
  })
  .superRefine((values, context) => {
    if (values.password !== values.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

function resolveRecoveryToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token =
    hashParams.get("access_token") ||
    searchParams.get("access_token") ||
    hashParams.get("token") ||
    searchParams.get("token");
  const type = hashParams.get("type") || searchParams.get("type");
  const errorDescription =
    hashParams.get("error_description") ||
    searchParams.get("error_description") ||
    hashParams.get("error") ||
    searchParams.get("error");

  return {
    token: token?.trim() || null,
    type: type?.trim().toLowerCase() || null,
    errorDescription: errorDescription?.trim() || null,
  };
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { confirmPasswordReset } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const recovery = useMemo(() => resolveRecoveryToken(), []);
  const recoveryToken = recovery?.token ?? null;
  const hasRecoveryError =
    Boolean(recovery?.errorDescription) ||
    !recoveryToken ||
    (recovery !== null && recovery.type !== null && recovery.type !== "recovery");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (!recovery) {
      return;
    }

    if (recovery.errorDescription) {
      setSubmitMessage({
        type: "error",
        text: decodeURIComponent(recovery.errorDescription),
      });
      return;
    }

    if (!recovery.token || (recovery.type !== null && recovery.type !== "recovery")) {
      setSubmitMessage({
        type: "error",
        text: "This password reset link is invalid or expired. Request a fresh link and try again.",
      });
    }
  }, [recovery]);

  const onSubmit = async (values: ResetPasswordValues) => {
    if (!recoveryToken) {
      setSubmitMessage({
        type: "error",
        text: "This password reset link is invalid or expired. Request a fresh link and try again.",
      });
      return;
    }

    setSubmitMessage(null);
    const result = await confirmPasswordReset(recoveryToken, values);
    setSubmitMessage({
      type: result.success ? "success" : "error",
      text:
        result.message ??
        (result.success ? "Password reset successful." : "Password reset request failed."),
    });

    if (result.success) {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, "/reset-password");
      }
      window.setTimeout(() => navigate("/login"), 1500);
    }
  };

  return (
    <div className="portal-page">
      <PortalTopNav brandVariant="mediconnect" />

      <main className="auth-main login-layout">
        <section className="login-hero">
          <p className="hero-kicker">Password Recovery</p>
          <h1>Set a new password and get back into the portal.</h1>
          <p>
            Use a strong new password for your National Health Portal account. This recovery link
            works only for password reset and expires after a certain time period.
          </p>
        </section>

        <section className="auth-card">
          <header>
            <h2>Reset Password</h2>
            <p>Enter a new password for your account.</p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            {submitMessage ? (
              <AlertMessage type={submitMessage.type} message={submitMessage.text} />
            ) : null}

            <div className="password-wrap">
              <div className="password-row">
                <span>New Password</span>
              </div>
              <div className="field-block">
                <div className="field-control">
                  <span className="field-icon">
                    <Lock size={18} />
                  </span>
                  <input
                    id="password"
                    className={`field-input field-input--with-icon field-input--with-toggle ${
                      errors.password ? "field-input--error" : ""
                    }`}
                    placeholder="Enter your new password"
                    type={showPassword ? "text" : "password"}
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
                {errors.password?.message ? (
                  <span className="field-error">{errors.password.message}</span>
                ) : (
                  <span className="field-helper">
                    Minimum 10 characters with uppercase, lowercase, number, and special character.
                  </span>
                )}
              </div>
            </div>

            <div className="password-wrap">
              <div className="password-row">
                <span>Confirm Password</span>
              </div>
              <div className="field-block">
                <div className="field-control">
                  <span className="field-icon">
                    <Lock size={18} />
                  </span>
                  <input
                    id="confirmPassword"
                    className={`field-input field-input--with-icon field-input--with-toggle ${
                      errors.confirmPassword ? "field-input--error" : ""
                    }`}
                    placeholder="Confirm your new password"
                    type={showConfirmPassword ? "text" : "password"}
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
                {errors.confirmPassword?.message ? (
                  <span className="field-error">{errors.confirmPassword.message}</span>
                ) : null}
              </div>
            </div>

            <Button
              type="submit"
              className="primary-button"
              isLoading={isSubmitting}
              disabled={hasRecoveryError}
            >
              Reset Password
            </Button>

            <p className="switch-row">
              Back to portal access
              <Link to="/login">Return to login</Link>
            </p>
          </form>
        </section>
      </main>

      <PortalFooter />
    </div>
  );
}
