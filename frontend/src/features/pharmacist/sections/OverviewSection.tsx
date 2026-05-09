import { AlertTriangle, ClipboardList, ShieldCheck } from "lucide-react";
import { PharmacistStatCard } from "../components/PharmacistStatCard";
import { pharmacistOperationalNotes, pharmacistPrivacyRules } from "../constants";
import type { PharmacistOverviewStats } from "../types";

function formatLkr(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(value);
}

interface OverviewSectionProps {
  stats: PharmacistOverviewStats;
}

export function OverviewSection({ stats }: OverviewSectionProps) {
  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PharmacistStatCard
          label="Pending Prescriptions"
          value={String(stats.pendingPrescriptions)}
          hint="Queue waiting for dispensing review."
        />
        <PharmacistStatCard
          label="Dispensed Today"
          value={String(stats.dispensedToday)}
          hint="Based on the prescription data currently available."
        />
        <PharmacistStatCard
          label="Queued Line Items"
          value={String(stats.queuedItems)}
          hint="Total medicine lines across visible prescriptions."
        />
        <PharmacistStatCard
          label="Estimated Bill Value"
          value={formatLkr(stats.estimatedValue)}
          hint="Only calculated when unit price data exists."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <article className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Pharmacy Privacy Guardrails
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                The proposal is strict here: pharmacist flows should verify and dispense
                prescriptions, not snoop around diagnosis notes like a nosy auntie.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {pharmacistPrivacyRules.map((rule) => (
              <div
                key={rule}
                className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {rule}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.7rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Operational Notes
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Proposal-aligned reminders for the pharmacy flow we are wiring now.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {pharmacistOperationalNotes.map((note) => (
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
