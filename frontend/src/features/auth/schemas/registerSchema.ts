import { z } from "zod";
import { calculateAge, parseSriLankanNic } from "../utils";

const slmcLicensePattern = /^SLMC-\d{5}$/;
const pharmacyLicensePattern = /^PH-\d{5}$/;

const userRoleSchema = z.enum([
  "PATIENT",
  "DOCTOR",
  "HEALTH_MINISTRY_ADMIN",
  "HOSPITAL_ADMIN",
  "PHARMACIST",
  "PHARMACY_ADMIN",
]);

const genderSchema = z
  .string()
  .min(1, "Select a gender.")
  .refine((value) => value === "MALE" || value === "FEMALE", {
    message: "Select a valid gender.",
  });

const nicSchema = z.string().trim();

export const registrationSchema = z
  .object({
    fullName: z.string().trim().min(3, "Name must be at least 3 characters."),
    preferredName: z.string().trim().min(2, "Preferred name must be at least 2 characters."),
    email: z.string().trim().email("Enter a valid email."),
    role: userRoleSchema,
    nic: z.string().trim(),
    dob: z
      .string()
      .min(1, "Date of birth is required.")
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: "Enter a valid date.",
      })
      .refine((value) => new Date(value) <= new Date(), {
        message: "Date of birth cannot be in the future.",
      }),
    gender: genderSchema,
    address: z.string().trim().min(8, "Address must be at least 8 characters."),
    parentNic: z.string().trim().optional(),
    specialization: z.string().trim().optional(),
    licenseNumber: z.string().trim().optional(),
    organisationId: z.string().trim().optional(),
    nicImage: z.custom<FileList | undefined>().optional(),
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

    const nicImage = values.nicImage?.item(0);
    if (!nicImage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nicImage"],
        message: "NIC image is required.",
      });
    } else {
      const allowedTypes = new Set(["image/jpeg", "image/png"]);
      if (!allowedTypes.has(nicImage.type)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nicImage"],
          message: "Upload a JPG or PNG NIC image.",
        });
      }
      if (nicImage.size > 5 * 1024 * 1024) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nicImage"],
          message: "NIC image must be 5MB or smaller.",
        });
      }
    }

    const age = calculateAge(values.dob);
    if (values.role === "PATIENT" && age !== null && age < 18) {
      if (!values.parentNic?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentNic"],
          message: "Guardian NIC is required for underage patients.",
        });
      }
      return;
    }

    if (!values.nic.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nic"],
        message: "NIC is required.",
      });
      return;
    }

    const nicResult = nicSchema
      .refine((value) => /^(?:\d{9}[VvXx]|\d{12})$/.test(value), {
        message: "Enter a valid NIC (9 digits + V/X or 12 digits).",
      })
      .safeParse(values.nic);

    if (!nicResult.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nic"],
        message: "Enter a valid NIC (9 digits + V/X or 12 digits).",
      });
      return;
    }

    const nicDetails = parseSriLankanNic(values.nic);
    if (!nicDetails) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nic"],
        message: "NIC contains an invalid birth-date sequence.",
      });
      return;
    }

    if (nicDetails.birthDate !== values.dob) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nic"],
        message: "NIC does not match the selected date of birth.",
      });
    }

    if (nicDetails.gender !== values.gender) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gender"],
        message: "Gender does not match the selected NIC.",
      });
    }

    if (values.role === "DOCTOR") {
      if (!values.specialization?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["specialization"],
          message: "Specialization is required for doctors.",
        });
      }

      if (!values.licenseNumber?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "License number is required for doctors.",
        });
      } else if (!slmcLicensePattern.test(values.licenseNumber.trim().toUpperCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "Doctor license number must match SLMC-12345 format.",
        });
      }
    }

    if (
      ["PHARMACIST", "HOSPITAL_ADMIN", "PHARMACY_ADMIN"].includes(values.role) &&
      !values.organisationId?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["organisationId"],
        message: "Organization ID is required for this role.",
      });
    }

    if (values.role === "PHARMACIST") {
      if (!values.licenseNumber?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "Pharmacy license number is required for pharmacists.",
        });
      } else if (!pharmacyLicensePattern.test(values.licenseNumber.trim().toUpperCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "Pharmacy license number must match PH-12345 format.",
        });
      }
    }

    if (values.role === "PHARMACY_ADMIN") {
      if (!values.licenseNumber?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "Pharmacy license number is required for pharmacy admins.",
        });
      } else if (!pharmacyLicensePattern.test(values.licenseNumber.trim().toUpperCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseNumber"],
          message: "Pharmacy license number must match PH-12345 format.",
        });
      }
    }
  });
