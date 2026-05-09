import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { AuthUser } from "../../../types/auth";
import { healthMinistryGovernanceNotes } from "../constants";

interface SettingsSectionProps {
  user: AuthUser | null;
  onLogout: () => void;
}

export function SettingsSection({ user, onLogout }: SettingsSectionProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[0.8fr,1.2fr]">
      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <UserRound className="mt-1 text-primary dark:text-blue-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Ministry Identity
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Signed-in government operator details from the auth provider.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Name</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {user?.name ?? "Unknown administrator"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              Email
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {user?.email ?? "No email loaded"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Role</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {user?.role ?? "Unknown"}
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={onLogout}
          className="mt-6 inline-flex items-center gap-2 bg-slate-900 px-5 py-3 text-white dark:bg-slate-100 dark:text-slate-900"
        >
          <LogOut size={16} />
          Sign Out
        </Button>
      </article>

      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Policy Notes</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Proposal-driven privacy and governance reminders for this admin role.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {healthMinistryGovernanceNotes.map((note) => (
            <div
              key={note}
              className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
            >
              {note}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
