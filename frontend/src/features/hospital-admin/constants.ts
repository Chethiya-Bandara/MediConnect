import {
  Building2,
  CalendarDays,
  Link2,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";
import type { HospitalAdminSection } from "./types";

export const hospitalAdminSectionTabs: Array<{
  id: HospitalAdminSection;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: Building2 },
  { id: "doctors", label: "Doctors", icon: CalendarDays },
  { id: "affiliations", label: "Affiliations", icon: Link2 },
  { id: "settings", label: "Settings", icon: Settings },
];

export const hospitalAdminGovernanceNotes = [
  "Hospital admins manage doctor affiliations, invitation flows, and slot availability within the hospital boundary.",
  "This role should coordinate access and scheduling, not rummage through patient clinical records.",
  "Affiliation decisions and revocations should remain traceable and role-bound even when the UI keeps things simple.",
];

export const hospitalAdminOperationalNotes = [
  "The known backend currently supports doctor invite, availability create/view, affiliation decision, and affiliation revoke.",
  "If hospital-admin routes are still not mounted in the running backend, this dashboard will show clean errors instead of fake green lights.",
  "Hospital scheduling is proposal-aligned here, but not every surrounding admin list endpoint exists yet.",
];

export const weekdayOptions = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
