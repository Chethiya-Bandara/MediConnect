import { AlertTriangle, Building2, ShieldCheck } from "lucide-react";
import { HospitalMetricCard } from "../components/HospitalMetricCard";
import {
  hospitalAdminGovernanceNotes,
  hospitalAdminOperationalNotes,
} from "../constants";
import type { HospitalOverviewStats } from "../types";

interface OverviewSectionProps {
  stats: HospitalOverviewStats;
  activeDoctorId: string | null;
}

export function OverviewSection({
  stats,
  activeDoctorId,
}: OverviewSectionProps) {
  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HospitalMetricCard
          label="Loaded Slots"
          value={String(stats.availabilitySlots)}
          hint="Availability windows loaded for the currently selected doctor."
        />
        <HospitalMetricCard
          label="Covered Days"
          value={String(stats.coveredDays)}
          hint="Distinct weekdays with availability coverage."
        />
        <HospitalMetricCard
          label="Doctor Context"
          value={stats.activeDoctorLoaded ? "Loaded" : "Pending"}
          hint="Whether a doctor schedule has been loaded into the dashboard."
        />
        <HospitalMetricCard
          label="Invite Readiness"
          value={stats.invitationReady ? "Ready" : "Pending"}
          hint="Hospital ID context available for sending doctor invitations."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <article className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Governance Guardrails
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Hospital admins coordinate affiliations and slots inside the hospital boundary, not random patient data fishing trips.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {hospitalAdminGovernanceNotes.map((note) => (
              <div
                key={note}
                className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {note}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <Building2 className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Active Scope
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Current doctor context and honest operational caveats.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <strong className="block text-slate-900 dark:text-slate-100">Loaded doctor</strong>
              {activeDoctorId ?? "No doctor schedule loaded yet"}
            </div>
            {hospitalAdminOperationalNotes.map((note) => (
              <div
                key={note}
                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                  <span>{note}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
