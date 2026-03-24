import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { loginSchema } from "../schemas";
import type { LoginFormValues } from "../types";
import { useAuth } from "../context/AuthContext";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { PortalFooter, PortalTopNav } from "../components";

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

    navigate("/dashboard");
  };

  return (
    <div className="portal-page">
      <PortalTopNav />

      <main className="auth-main login-layout">
        <section className="login-hero">
          <p className="hero-kicker">Clinical Portal Access</p>
          <h1>
            Securing National Health Data
            <br />
            with Clinical Precision.
          </h1>
          <p>
            Access unified health records, manage appointments, and collaborate
            across Sri Lanka's digital healthcare network.
          </p>

          <div className="hero-cards">
            <article>
              <ShieldCheck size={18} />
              <h3>Encrypted Vault</h3>
              <p>AES-grade protection for every patient record.</p>
            </article>
            <article>
              <ShieldCheck size={18} />
              <h3>Verified ID</h3>
              <p>National identity verification integrated in flow.</p>
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
              error={errors.email?.message}
              {...register("email")}
            />

            <div className="password-row">
              <span>Password</span>
              <button type="button">Forgot Password?</button>
            </div>

            <div className="password-wrap">
              <InputField
                id="password"
                type={showPassword ? "text" : "password"}
                label=""
                aria-label="Password"
                placeholder="••••••••"
                leadingIcon={<Lock size={18} />}
                error={errors.password?.message}
                {...register("password")}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <Button type="submit" className="primary-button" isLoading={isSubmitting}>
              <span>Login to Portal</span>
              {!isSubmitting && <ArrowRight size={18} />}
            </Button>
          </form>

          <p className="switch-row">
            New to the National Health Portal?
            <Link to="/register">Create an Account</Link>
          </p>
        </section>
      </main>

      <PortalFooter />
    </div>
  );
}
