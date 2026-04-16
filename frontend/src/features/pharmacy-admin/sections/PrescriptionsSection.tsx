import { AlertTriangle, ClipboardList, ShieldCheck } from "lucide-react";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { pharmacyAdminComplianceNotes } from "../constants";
import type { PharmacyInventoryItem, PharmacyInventoryStats } from "../types";

const prescriptionStatuses = [
  "ISSUED",
  "PARTIALLY_DISPENSED",
  "DISPENSED",
  "CANCELLED",
  "EXPIRED",
];

interface PrescriptionsSectionProps {
  activePharmacyId: string | null;
  inventory: PharmacyInventoryItem[];
  stats: PharmacyInventoryStats;
}

export function PrescriptionsSection({
  activePharmacyId,
  inventory,
  stats,
}: PrescriptionsSectionProps) {
  const blockers = inventory.filter((item) => (item.stockQuantity ?? 0) <= 0);
  const warnings = inventory.filter((item) => {
    const quantity = item.stockQuantity ?? 0;
    return quantity > 0 && quantity <= 10;
  });

  return (
    <section className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Prescription Operations
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Pharmacy admin is mostly about pricing and inventory readiness. Dispensing itself belongs to pharmacist workflows.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {prescriptionStatuses.map((status) => (
              <div
                key={status}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                {status}
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            {pharmacyAdminComplianceNotes.map((note) => (
              <div
                key={note}
                className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {note}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Fulfilment Readiness
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Pharmacy {activePharmacyId ?? "not loaded"} currently has {stats.outOfStockItems} stock blockers and {stats.lowStockItems} warning items.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Stock blockers
              </p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {blockers.length}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Warning lines
              </p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {warnings.length}
              </p>
            </div>
          </div>
        </article>
      </div>

      {!activePharmacyId ? (
        <EmptyState
          title="Load a pharmacy first"
          description="Inventory readiness depends on the current pharmacy catalog, so load that before using this section."
        />
      ) : blockers.length === 0 && warnings.length === 0 ? (
        <EmptyState
          title="Catalog looks ready"
          description="No immediate stock blockers or low-stock warnings were found in the current inventory view."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Stock Blockers
            </h3>
            <div className="mt-5 space-y-3">
              {blockers.length === 0 ? (
                <EmptyState
                  title="No blocked items"
                  description="Nothing is completely out of stock right now."
                />
              ) : (
                blockers.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                      <div>
                        <strong className="block">{item.medicineName}</strong>
                        Inventory ID {item.id} is at zero stock and can block prescription fulfilment.
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Low Stock Warnings
            </h3>
            <div className="mt-5 space-y-3">
              {warnings.length === 0 ? (
                <EmptyState
                  title="No low-stock warnings"
                  description="Nothing is hovering in the danger zone right now."
                />
              ) : (
                warnings.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    <strong className="block">{item.medicineName}</strong>
                    Only {item.stockQuantity ?? 0} units remain. That is not catastrophic yet, but it is definitely not cute.
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
