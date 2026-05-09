import { useState } from "react";
import { Shield, ShieldAlert } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { GovernanceAction, GovernanceTargetType } from "../types";

interface UsersSectionProps {
  message: string | null;
  isSubmitting: boolean;
  onSubmit: (
    targetId: string,
    targetType: GovernanceTargetType,
    action: GovernanceAction,
  ) => Promise<boolean>;
}

export function UsersSection({ message, isSubmitting, onSubmit }: UsersSectionProps) {
  const [targetId, setTargetId] = useState("");
  const [targetType, setTargetType] = useState<GovernanceTargetType>("USER");
  const [action, setAction] = useState<GovernanceAction>("SUSPEND");

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr,0.8fr]">
      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <Shield className="mt-1 text-primary dark:text-blue-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Account Governance
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Suspend or reactivate users and organisations using the existing governance endpoint.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Target ID
            </span>
            <input
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="Enter user or organisation ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Target type
            </span>
            <select
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as GovernanceTargetType)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="USER">User</option>
              <option value="ORGANIZATION">Organization</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Action
            </span>
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as GovernanceAction)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="SUSPEND">Suspend</option>
              <option value="ACTIVATE">Activate</option>
            </select>
          </label>
        </div>

        <Button
          type="button"
          isLoading={isSubmitting}
          disabled={!targetId.trim()}
          onClick={() => void onSubmit(targetId.trim(), targetType, action)}
          className="mt-5 w-full bg-slate-900 py-3 text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Apply Governance Action
        </Button>

        {message ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {message}
          </div>
        ) : null}
      </article>

      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-1 text-amber-600 dark:text-amber-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Audit Expectations
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Proposal-side expectations the governance console should eventually enforce end to
              end.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            Every sensitive governance action should map to a user, role, organisation, timestamp,
            and action type.
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            Export and scoped audit views are in the proposal, but the current backend still needs
            more plumbing before that becomes trustworthy.
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            This screen focuses on safe account governance actions without inventing fantasy
            moderation features.
          </div>
        </div>
      </article>
    </section>
  );
}
