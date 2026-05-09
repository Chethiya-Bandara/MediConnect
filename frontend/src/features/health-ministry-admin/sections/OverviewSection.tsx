import { AlertTriangle, Landmark, ShieldCheck } from "lucide-react";
import { GovernanceStatCard } from "../components/GovernanceStatCard";
import { healthMinistryGovernanceNotes, healthMinistryOperationalNotes } from "../constants";
import type { AnalyticsFilters, HealthMinistryOverviewStats } from "../types";

interface OverviewSectionProps {
  stats: HealthMinistryOverviewStats;
  filters: AnalyticsFilters;
}

export function OverviewSection({ stats, filters }: OverviewSectionProps) {
  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GovernanceStatCard
          label="Incidence Count"
          value={String(stats.totalIncidence)}
          hint="Aggregate diagnoses in the selected date window."
        />
        <GovernanceStatCard
          label="Tracked Diagnoses"
          value={String(stats.trackedDiagnoses)}
          hint="Distinct diagnosis codes returned by analytics."
        />
        <GovernanceStatCard
          label="Leading Diagnosis"
          value={stats.leadingDiagnosis}
          hint="Top diagnosis code from the current ranking endpoint."
        />
        <GovernanceStatCard
          label="Report Status"
          value={stats.reportReady ? "Ready" : "Pending"}
          hint="Monthly AI report generation status."
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
                This role is supposed to approve, supervise, and aggregate, not poke around in
                patient-level secrets like a bored neighbourhood uncle.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {healthMinistryGovernanceNotes.map((note) => (
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
            <Landmark className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Active Scope</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Current analytics window and honest operational caveats.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <strong className="block text-slate-900 dark:text-slate-100">Date window</strong>
              {filters.startDate} to {filters.endDate}
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <strong className="block text-slate-900 dark:text-slate-100">District filter</strong>
              {filters.district || "All districts"}
            </div>
            {healthMinistryOperationalNotes.map((note) => (
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
