import { AlertTriangle, Pill, Wallet } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { PrescriptionStatusBadge } from "../components/PrescriptionStatusBadge";
import type { PharmacistPrescriptionDetail } from "../types";

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

function getEffectiveUnitPrice(
  item: Pick<PharmacistPrescriptionDetail["items"][number], "unitPrice" | "catalogUnit" | "medicineName">,
) {
  if (item.unitPrice === null) {
    return null;
  }

  const candidates = [item.catalogUnit ?? "", item.medicineName ?? ""].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    const packMatch = normalized.match(
      /(\d+)\s*(?:x|×|\*)\s*(\d+)(?:\s*(?:x|×|\*)\s*(\d+))?/i,
    );
    if (packMatch) {
      const factors = packMatch
        .slice(1)
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10));
      if (factors.length > 1 && factors.every((value) => Number.isFinite(value) && value > 0)) {
        return item.unitPrice / factors.reduce((product, value) => product * value, 1);
      }
    }

    const match =
      normalized.match(/(\d+)\s*(t|tabs?|tablets?|c|caps?|capsules?)\b/i) ??
      normalized.match(/\b(\d+)(t|c)\b/i);

    if (!match) {
      continue;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return item.unitPrice / parsed;
    }
  }

  return item.unitPrice;
}

interface DispensingSectionProps {
  detail: PharmacistPrescriptionDetail | null;
  isLoading: boolean;
  error: string | null;
  isDispensing: boolean;
  actionMessage: string | null;
  onDispense: () => void;
}

export function DispensingSection({
  detail,
  isLoading,
  error,
  isDispensing,
  actionMessage,
  onDispense,
}: DispensingSectionProps) {
  if (isLoading) {
    return <LoadingState message="Loading prescription detail..." />;
  }

  if (error) {
    return <ErrorState title="Dispensing detail unavailable" message={error} />;
  }

  if (!detail) {
    return (
      <EmptyState
        title="Select a prescription"
        description="Pick a queued prescription first, then we can review line items and process dispensing."
      />
    );
  }

  const estimatedTotal = detail.items.every(
    (item) => item.unitPrice !== null && item.quantity !== null,
  )
    ? detail.items.reduce(
        (sum, item) => sum + ((getEffectiveUnitPrice(item) ?? 0) * (item.quantity ?? 0)),
        0,
      )
    : null;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">
            Dispensing Target
          </p>
          <h2 className="mt-2 font-headline text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            {detail.prescription.id}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            DHID: {detail.prescription.patientDhid ?? "Not supplied by backend"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PrescriptionStatusBadge status={detail.prescription.status} />
          <Button
            type="button"
            onClick={onDispense}
            isLoading={isDispensing}
            disabled={detail.prescription.status === "DISPENSED"}
            className="bg-primary px-5 py-3 text-white dark:bg-blue-600"
          >
            {detail.prescription.status === "DISPENSED"
              ? "Already Dispensed"
              : "Dispense Prescription"}
          </Button>
        </div>
      </div>

      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          {actionMessage}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.3fr,0.7fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-start gap-3">
            <Pill className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Dispensing Line Items
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Keep this strictly medicine-level. Diagnosis detail does not belong here.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {detail.items.length === 0 ? (
              <EmptyState
                title="No line items returned"
                description="The prescription detail loaded, but the backend did not attach medicine items."
              />
            ) : (
              detail.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl bg-slate-50 px-5 py-4 dark:bg-slate-800/60"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {item.medicineName}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {item.dosage ?? "Dosage not provided"} • Qty {item.quantity ?? "N/A"}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                        Unit Price
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {formatLkr(getEffectiveUnitPrice(item))}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    {item.instructions ?? "No extra instructions provided."}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <Wallet className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Billing Summary
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Proposal says billing should be itemised and server-driven.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Selected Items
              </p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {detail.items.length}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Estimated Total
              </p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {formatLkr(estimatedTotal)}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                <span>
                  Partial dispensing is in the proposal, but the current backend endpoint only
                  performs full dispense.
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
