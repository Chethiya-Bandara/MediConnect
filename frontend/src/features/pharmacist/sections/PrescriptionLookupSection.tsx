import { Search } from "lucide-react";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { formatDate } from "../../../lib/utils/formatDate";
import { PrescriptionStatusBadge } from "../components/PrescriptionStatusBadge";
import type { PharmacistPrescriptionSummary } from "../types";

interface PrescriptionLookupSectionProps {
  prescriptions: PharmacistPrescriptionSummary[];
  selectedPrescriptionId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelect: (prescriptionId: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function PrescriptionLookupSection({
  prescriptions,
  selectedPrescriptionId,
  searchQuery,
  onSearchChange,
  onSelect,
  isLoading,
  error,
}: PrescriptionLookupSectionProps) {
  if (isLoading) {
    return <LoadingState message="Loading pharmacist queue..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Pharmacist queue unavailable"
        message={`${error} The UI is ready, but the backend route may still be sleeping on the job.`}
      />
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Prescription Lookup
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Search by DHID, prescription ID, patient name, or doctor name. NIC stays out of this screen on purpose.
          </p>
        </div>

        <div className="relative w-full lg:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search DHID, prescription ID, patient..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      {prescriptions.length === 0 ? (
        <EmptyState
          title="No prescriptions found"
          description="Nothing is waiting in the pharmacist queue right now, or the backend returned an empty list."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {prescriptions.map((item) => {
            const active = item.id === selectedPrescriptionId;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`rounded-[1.7rem] border p-6 text-left shadow-sm transition-all ${
                  active
                    ? "border-primary bg-blue-50 shadow-lg dark:border-blue-500 dark:bg-blue-950/30"
                    : "border-slate-100 bg-white hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">
                      Prescription ID
                    </p>
                    <p className="mt-2 font-headline text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                      {item.id}
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {item.patientDhid ?? "DHID not included by backend yet"}
                    </p>
                  </div>
                  <PrescriptionStatusBadge status={item.status} />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      Patient
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {item.patientName ?? "Name hidden or unavailable"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      Doctor
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {item.doctorName ?? "Not provided"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      Issued
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {item.issuedAt ? formatDate(item.issuedAt) : "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      Items
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {item.totalItems ?? "N/A"}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
