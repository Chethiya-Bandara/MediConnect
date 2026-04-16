import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { getRoleLandingPath } from "../../../lib/auth/roleRedirect";
import { PortalFooter, PortalTopNav } from "../components";
import { loginSchema } from "../schemas/loginSchema";
import type { LoginFormValues } from "../types";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    const result = await login(values);

    if (!result.success) {
      setSubmitError(result.message ?? "Login failed.");
      return;
    }

    navigate(getRoleLandingPath());
  };

  return (
    <div className="portal-page">
      <PortalTopNav />

      <main className="auth-main login-layout">
        <section className="login-hero">
          <p className="hero-kicker">Clinical Portal Access</p>
          <h1>
            Securing National Health Data with Clinical Precision.
          </h1>
          <p>
            Access your unified health record, manage clinical appointments,
            and connect with healthcare providers across the nation.
          </p>

          <div className="hero-cards">
            <article>
              <ShieldCheck size={18} color="#0f3970" />
              <h3>Encrypted Vault</h3>
              <p>
                AES-256 bit healthcare-grade security for records and identity
                exchange.
              </p>
            </article>
            <article>
              <ShieldCheck size={18} color="#0f3970" />
              <h3>Verified ID</h3>
              <p>
                Seamless integration with trusted national identity workflows.
              </p>
            </article>
          </div>
        </section>

        <section className="auth-card">
          <header>
            <h2>Welcome Back</h2>
            <p>Please enter your clinical credentials to continue.</p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            {submitError && <AlertMessage type="error" message={submitError} />}

            <InputField
              id="email"
              type="email"
              label="Email Address"
              placeholder="name@healthcare.gov"
              leadingIcon={<Mail size={18} />}
              {...register("email")}
              error={errors.email?.message}
            />

            <div className="password-wrap">
              <div className="password-row">
                <span>Password</span>
                <Link to="/forgot-password">Forgot Password?</Link>
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
                    placeholder="Enter your password"
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
                {errors.password?.message && (
                  <span className="field-error">{errors.password.message}</span>
                )}
              </div>
            </div>

            <label className="remember-row">
              <input type="checkbox" />
              <span>Remember this device</span>
            </label>

            <Button
              type="submit"
              className="primary-button"
              isLoading={isSubmitting}
            >
              Login to Portal
            </Button>

            <p className="switch-row">
              New to the National Health Portal?
              <Link to="/register">Create an Account</Link>
            </p>
          </form>
        </section>
      </main>

      <PortalFooter />
    </div>
  );
}
