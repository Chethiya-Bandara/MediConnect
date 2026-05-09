import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Wallet } from "lucide-react";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { InventoryMetricCard } from "../components/InventoryMetricCard";
import { pharmacyAdminOperationalNotes } from "../constants";
import type { PharmacyInventoryItem, PharmacyInventoryStats } from "../types";

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

interface BillingSectionProps {
  inventory: PharmacyInventoryItem[];
  stats: PharmacyInventoryStats;
}

export function BillingSection({ inventory, stats }: BillingSectionProps) {
  const [estimateItemId, setEstimateItemId] = useState<string>("");
  const [estimateQuantity, setEstimateQuantity] = useState("1");

  useEffect(() => {
    setEstimateItemId(inventory[0]?.id ?? "");
  }, [inventory]);

  const selectedEstimateItem = inventory.find((item) => item.id === estimateItemId) ?? null;

  const missingPrices = inventory.filter((item) => item.unitPrice === null).length;
  const estimateTotal = useMemo(() => {
    if (!selectedEstimateItem || selectedEstimateItem.unitPrice === null) {
      return null;
    }

    const quantity = Number(estimateQuantity);
    return Number.isFinite(quantity) ? selectedEstimateItem.unitPrice * quantity : null;
  }, [selectedEstimateItem, estimateQuantity]);

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InventoryMetricCard
          label="Priced Items"
          value={String(stats.pricedItems)}
          hint="Catalog entries that already have unit pricing."
        />
        <InventoryMetricCard
          label="Missing Prices"
          value={String(missingPrices)}
          hint="Items that still cannot contribute to an itemised bill."
        />
        <InventoryMetricCard
          label="Average Unit Price"
          value={formatLkr(stats.averageUnitPrice)}
          hint="Average across priced inventory items."
        />
        <InventoryMetricCard
          label="Stock Value"
          value={formatLkr(stats.totalStockValue)}
          hint="Current inventory value estimate from loaded stock."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ReceiptText className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Pricing Oversight
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Pharmacy admin owns the price list. Final billing still belongs server-side once
                dispensing is processed.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {pharmacyAdminOperationalNotes.map((note) => (
              <div
                key={note}
                className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {note}
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            {inventory.length === 0 ? (
              <EmptyState
                title="No price list yet"
                description="Load inventory first to review or estimate billing readiness."
              />
            ) : (
              inventory.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {item.medicineName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Qty {item.stockQuantity ?? "N/A"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {formatLkr(item.unitPrice)}
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
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Local Estimate
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Quick admin-side estimate only. The real itemised bill must come from backend
                dispensing logic.
              </p>
            </div>
          </div>

          {inventory.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No inventory available"
                description="Load inventory to estimate catalog pricing."
              />
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                  Medicine
                </span>
                <select
                  value={estimateItemId}
                  onChange={(event) => setEstimateItemId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.medicineName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                  Quantity
                </span>
                <input
                  type="number"
                  min="1"
                  value={estimateQuantity}
                  onChange={(event) => setEstimateQuantity(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>

              <div className="rounded-2xl bg-slate-50 px-5 py-4 dark:bg-slate-800/60">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                  Estimated charge
                </p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
                  {formatLkr(estimateTotal)}
                </p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Based on the current catalog unit price for{" "}
                  {selectedEstimateItem?.medicineName ?? "the selected item"}.
                </p>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
