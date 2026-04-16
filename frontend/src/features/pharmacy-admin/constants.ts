import {
  ClipboardList,
  ReceiptText,
  Settings,
  Boxes,
} from "lucide-react";
import type { ComponentType } from "react";
import type { PharmacyAdminSection } from "./types";

export const lowStockThreshold = 10;

export const pharmacyAdminSectionTabs: Array<{
  id: PharmacyAdminSection;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "prescriptions", label: "Prescriptions", icon: ClipboardList },
  { id: "billing", label: "Billing", icon: ReceiptText },
  { id: "settings", label: "Settings", icon: Settings },
];

export const pharmacyAdminComplianceNotes = [
  "Pharmacy admins manage stock, unit pricing, and operational readiness without touching diagnosis notes or encounter history.",
  "Final billing should be itemised and server-driven, not hand-typed by whoever happens to be clicking around.",
  "If the backend inventory routes are not mounted yet, this dashboard shows clean error states instead of fake success theatre.",
];

export const pharmacyAdminOperationalNotes = [
  "Inventory CRUD is the only known pharmacy-admin backend capability at the moment.",
  "Prescription oversight and billing readiness are shown here as admin-facing operational views, not invented backend workflows.",
  "Low stock and missing prices can block dispensing long before the queue reaches the pharmacist.",
];
