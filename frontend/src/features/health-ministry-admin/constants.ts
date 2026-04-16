import {
  BarChart3,
  ClipboardCheck,
  Landmark,
  Settings,
  Shield,
} from "lucide-react";
import type { ComponentType } from "react";
import type { HealthMinistryAdminSection } from "./types";

export const healthMinistrySectionTabs: Array<{
  id: HealthMinistryAdminSection;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: Landmark },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "users", label: "User Actions", icon: Shield },
  { id: "settings", label: "Settings", icon: Settings },
];

export const healthMinistryGovernanceNotes = [
  "Organisation and doctor approvals sit behind health ministry review, not random self-service shortcuts.",
  "Government analytics should stay aggregated and anonymised. No patient-identifiable data belongs here.",
  "Audit export is part of the proposal, but the current running backend still needs more wiring before that gets real teeth.",
];

export const healthMinistryOperationalNotes = [
  "The live backend currently exposes analytics and governance-style write endpoints, but approval contract mismatches may still trigger server errors.",
  "This dashboard uses only known backend routes and shows clean failure states instead of pretending ghost data is real.",
  "Health ministry oversight is designed around district trends, doctor approval review, and organisation governance.",
];
