import { useState } from "react";
import { Link2, ShieldX } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { AffiliationDecisionStatus } from "../types";

interface AffiliationsSectionProps {
  message: string | null;
  isSubmitting: boolean;
  onDecideAffiliation: (
    affiliationId: string,
    status: AffiliationDecisionStatus,
  ) => Promise<boolean>;
  onRevokeAffiliation: (affiliationId: string) => Promise<boolean>;
}

export function AffiliationsSection({
  message,
  isSubmitting,
  onDecideAffiliation,
  onRevokeAffiliation,
}: AffiliationsSectionProps) {
  const [decisionAffiliationId, setDecisionAffiliationId] = useState("");
  const [decisionStatus, setDecisionStatus] = useState<AffiliationDecisionStatus>("approved");
  const [revokeAffiliationId, setRevokeAffiliationId] = useState("");

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <Link2 className="mt-1 text-primary dark:text-blue-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Affiliation Decision
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Approve or reject doctor-hospital affiliation requests using the current backend
              contract.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Affiliation ID
            </span>
            <input
              value={decisionAffiliationId}
              onChange={(event) => setDecisionAffiliationId(event.target.value)}
              placeholder="Enter affiliation ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Decision
            </span>
            <select
              value={decisionStatus}
              onChange={(event) =>
                setDecisionStatus(event.target.value as AffiliationDecisionStatus)
              }
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </select>
          </label>

          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={!decisionAffiliationId.trim()}
            onClick={() => void onDecideAffiliation(decisionAffiliationId.trim(), decisionStatus)}
            className="w-full bg-primary py-3 text-white dark:bg-blue-600"
          >
            Submit Affiliation Decision
          </Button>
        </div>
      </article>

      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <ShieldX className="mt-1 text-amber-600 dark:text-amber-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Revoke Affiliation
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Revoke an existing doctor affiliation when the hospital relationship needs to be cut
              cleanly.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Affiliation ID
            </span>
            <input
              value={revokeAffiliationId}
              onChange={(event) => setRevokeAffiliationId(event.target.value)}
              placeholder="Enter affiliation ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={!revokeAffiliationId.trim()}
            onClick={() => void onRevokeAffiliation(revokeAffiliationId.trim())}
            className="w-full bg-amber-600 py-3 text-white hover:bg-amber-700"
          >
            Revoke Affiliation
          </Button>
        </div>
      </article>

      {message ? (
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {message}
        </div>
      ) : null}
    </section>
  );
}
