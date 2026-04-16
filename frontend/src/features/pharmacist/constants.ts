import {
  Activity,
  ClipboardList,
  Pill,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";
import type { PharmacistSection } from "./types";

export const pharmacistSectionTabs: Array<{
  id: PharmacistSection;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "lookup", label: "Prescription Lookup", icon: ClipboardList },
  { id: "dispensing", label: "Dispensing", icon: Pill },
  { id: "settings", label: "Settings", icon: Settings },
];

export const pharmacistPrivacyRules = [
  "Use DHID and prescription identifiers only. NIC and diagnosis notes stay off-limits.",
  "Dispensing must never expose encounter history or clinical notes.",
  "Unit pricing should come from server-side data, not hand-typed guesses.",
];

export const pharmacistOperationalNotes = [
  "DHID and QR-based verification are in-scope for the project vision.",
  "Partial dispensing is part of the proposal, but the current backend endpoint only supports full dispense.",
  "If the pharmacist routes are not mounted in the backend yet, this dashboard will show honest error states instead of fake success.",
];
