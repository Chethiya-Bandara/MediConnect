import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { useAuth } from "../context/AuthContext";
import { loginSchema } from "../schemas";
import type { LoginFormValues } from "../types";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
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

    if (result.success) {
      navigate("/dashboard");
      return;
    }

    setSubmitError(result.message ?? "Login failed. Please try again.");
  };

  return (
    <section className="auth-view">
      <header className="auth-view-header">
        <h2>Welcome Back</h2>
        <p>Log in to your MediConnect account.</p>
      </header>

      <form className="form-grid" onSubmit={handleSubmit(onSubmit)} noValidate>
        {submitError && <AlertMessage type="error" message={submitError} />}

        <InputField
          id="email"
          type="email"
          label="Email Address"
          placeholder="name@example.com"
          leadingIcon={<Mail size={18} />}
          error={errors.email?.message}
          {...register("email")}
        />

        <div className="field-inline-head">
          <span>Password</span>
          <button type="button">Forgot Password?</button>
        </div>

        <InputField
          id="password"
          type="password"
          label=""
          aria-label="Password"
          placeholder="••••••••"
          leadingIcon={<Lock size={18} />}
          error={errors.password?.message}
          {...register("password")}
        />

        <Button type="submit" className="auth-submit" isLoading={isSubmitting}>
          <span>Sign In</span>
          {!isSubmitting && <ArrowRight size={16} />}
        </Button>
      </form>

      <div className="auth-demo-box">
        <p>Quick demo accounts:</p>
        <ul>
          <li>patient@mediconnect.lk / Patient123</li>
          <li>doctor@mediconnect.lk / Doctor123</li>
          <li>admin@mediconnect.lk / Admin123</li>
        </ul>
      </div>

      <p className="auth-footer-text">
        No account yet? <Link to="/register">Register now</Link>
      </p>
    </section>
  );
}
