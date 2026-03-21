import { z } from "zod";
import { calculateAge } from "./utils";

const userRoleSchema = z.enum([
  "PATIENT",
  "DOCTOR",
  "HEALTH_MINISTRY_ADMIN",
  "HOSPITAL_ADMIN",
  "PHARMACIST",
  "PHARMACY_ADMIN",
]);

const nicSchema = z
  .string()
  .trim()
  .regex(
    /^(?:\d{9}[VvXx]|\d{12})$/,
    "Enter a valid NIC (9 digits + V/X or 12 digits).",
  );

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

export const registrationSchema = z
  .object({
    fullName: z.string().trim().min(3, "Name must be at least 3 characters."),
    email: z.string().trim().email("Enter a valid email."),
    role: userRoleSchema,
    nic: nicSchema,
    dob: z
      .string()
      .min(1, "Date of birth is required.")
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: "Enter a valid date.",
      })
      .refine((value) => new Date(value) <= new Date(), {
        message: "Date of birth cannot be in the future.",
      }),
    parentNic: z.string().trim().optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .regex(/[A-Za-z]/, "Password must include letters.")
      .regex(/\d/, "Password must include numbers."),
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

    const age = calculateAge(values.dob);
    if (values.role === "PATIENT" && age !== null && age < 18) {
      if (!values.parentNic) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentNic"],
          message: "Parent NIC is required for underage patients.",
        });
        return;
      }

      const nicResult = nicSchema.safeParse(values.parentNic);
      if (!nicResult.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentNic"],
          message: "Parent NIC format is invalid.",
        });
      }
    }
  });
