import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { z } from "zod";
import { AlertMessage, Button, InputField } from "../../../components/ui";
import { PortalFooter, PortalTopNav } from "../components";
import { useAuth } from "../context/AuthContext";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [submitMessage, setSubmitMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (values: ForgotPasswordValues) => {
    setSubmitMessage(null);
    const result = await requestPasswordReset(values.email);
    setSubmitMessage({
      type: result.success ? "success" : "error",
      text:
        result.message ?? (result.success ? "Reset link sent." : "Password reset request failed."),
    });
  };

  return (
    <div className="portal-page">
      <PortalTopNav brandVariant="mediconnect" />

      <main className="auth-main login-layout">
        <section className="login-hero">
          <p className="hero-kicker">Credential Recovery</p>
          <h1>Reset your portal access without the usual circus.</h1>
          <p>
            Enter the email linked to your account and we will trigger the password recovery flow
            through the secure auth service.
          </p>
        </section>

        <section className="auth-card">
          <header>
            <h2>Forgot Password</h2>
            <p>Request a reset link for your National Health Portal account.</p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            {submitMessage ? (
              <AlertMessage type={submitMessage.type} message={submitMessage.text} />
            ) : null}

            <InputField
              id="email"
              type="email"
              label="Email Address"
              placeholder="name@healthcare.gov"
              leadingIcon={<Mail size={18} />}
              {...register("email")}
              error={errors.email?.message}
              helperText="Use the same email you used during registration."
            />

            <Button type="submit" className="primary-button" isLoading={isSubmitting}>
              Send Reset Link
            </Button>

            <p className="switch-row">
              Remembered your password?
              <Link to="/login">Back to login</Link>
            </p>
          </form>
        </section>
      </main>

      <PortalFooter />
    </div>
  );
}
