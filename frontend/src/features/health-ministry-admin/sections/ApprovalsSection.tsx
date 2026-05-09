import { useState } from "react";
import { BadgeCheck, Building2, Stethoscope } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { ApprovalStatus } from "../types";

interface ApprovalsSectionProps {
  message: string | null;
  isSubmitting: boolean;
  onApproveOrganization: (organizationId: string, status: ApprovalStatus) => Promise<boolean>;
  onApproveDoctor: (doctorId: string, status: ApprovalStatus) => Promise<boolean>;
}

export function ApprovalsSection({
  message,
  isSubmitting,
  onApproveOrganization,
  onApproveDoctor,
}: ApprovalsSectionProps) {
  const [organizationId, setOrganizationId] = useState("");
  const [organizationStatus, setOrganizationStatus] = useState<ApprovalStatus>("approved");
  const [doctorId, setDoctorId] = useState("");
  const [doctorStatus, setDoctorStatus] = useState<ApprovalStatus>("approved");

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <Building2 className="mt-1 text-primary dark:text-blue-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Organisation Approval
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Review hospital or pharmacy onboarding by organisation ID. This matches the current
              backend more than a fancy table would.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Organisation ID
            </span>
            <input
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              placeholder="Enter organisation ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Decision
            </span>
            <select
              value={organizationStatus}
              onChange={(event) => setOrganizationStatus(event.target.value as ApprovalStatus)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </select>
          </label>

          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={!organizationId.trim()}
            onClick={() => void onApproveOrganization(organizationId.trim(), organizationStatus)}
            className="w-full bg-primary py-3 text-white dark:bg-blue-600"
          >
            Submit Organisation Review
          </Button>
        </div>
      </article>

      <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <Stethoscope className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Doctor Approval
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Approve or reject doctor registration review using the backend’s current doctor
              approval endpoint.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Doctor ID
            </span>
            <input
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              placeholder="Enter doctor ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Decision
            </span>
            <select
              value={doctorStatus}
              onChange={(event) => setDoctorStatus(event.target.value as ApprovalStatus)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </select>
          </label>

          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={!doctorId.trim()}
            onClick={() => void onApproveDoctor(doctorId.trim(), doctorStatus)}
            className="w-full bg-emerald-600 py-3 text-white hover:bg-emerald-700"
          >
            Submit Doctor Review
          </Button>
        </div>
      </article>

      {message ? (
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          <div className="flex items-start gap-2">
            <BadgeCheck className="mt-0.5 shrink-0" size={16} />
            <span>{message}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
