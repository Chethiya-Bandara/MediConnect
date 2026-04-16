import { useEffect, useState } from "react";
import { PackagePlus, Search, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { InventoryMetricCard } from "../components/InventoryMetricCard";
import type {
  PharmacyInventoryItem,
  PharmacyInventoryMutationPayload,
  PharmacyInventoryStats,
  PharmacyInventoryUpdatePayload,
} from "../types";

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

interface InventorySectionProps {
  pharmacyIdInput: string;
  activePharmacyId: string | null;
  filteredInventory: PharmacyInventoryItem[];
  selectedItem: PharmacyInventoryItem | null;
  selectedItemId: string | null;
  stats: PharmacyInventoryStats;
  searchQuery: string;
  error: string | null;
  actionMessage: string | null;
  isLoading: boolean;
  isMutating: boolean;
  onPharmacyIdChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectItem: (itemId: string) => void;
  onLoadInventory: () => Promise<boolean>;
  onCreateMedicine: (payload: PharmacyInventoryMutationPayload) => Promise<boolean>;
  onUpdateMedicine: (payload: PharmacyInventoryUpdatePayload) => Promise<boolean>;
  onDeleteMedicine: (itemId: string) => Promise<boolean>;
}

export function InventorySection({
  pharmacyIdInput,
  activePharmacyId,
  filteredInventory,
  selectedItem,
  selectedItemId,
  stats,
  searchQuery,
  error,
  actionMessage,
  isLoading,
  isMutating,
  onPharmacyIdChange,
  onSearchChange,
  onSelectItem,
  onLoadInventory,
  onCreateMedicine,
  onUpdateMedicine,
  onDeleteMedicine,
}: InventorySectionProps) {
  const [medicineName, setMedicineName] = useState("");
  const [newStockQuantity, setNewStockQuantity] = useState("0");
  const [newUnitPrice, setNewUnitPrice] = useState("0");
  const [editStockQuantity, setEditStockQuantity] = useState("0");
  const [editUnitPrice, setEditUnitPrice] = useState("0");

  useEffect(() => {
    setEditStockQuantity(String(selectedItem?.stockQuantity ?? 0));
    setEditUnitPrice(String(selectedItem?.unitPrice ?? 0));
  }, [selectedItem]);

  const handleCreateMedicine = async () => {
    const payload = {
      pharmacyId: pharmacyIdInput.trim(),
      medicineName: medicineName.trim(),
      stockQuantity: Number(newStockQuantity),
      unitPrice: Number(newUnitPrice),
    };

    if (!payload.pharmacyId || !payload.medicineName) {
      return;
    }

    const success = await onCreateMedicine(payload);
    if (success) {
      setMedicineName("");
      setNewStockQuantity("0");
      setNewUnitPrice("0");
    }
  };

  const handleUpdateMedicine = async () => {
    if (!selectedItem) {
      return;
    }

    await onUpdateMedicine({
      itemId: selectedItem.id,
      stockQuantity: Number(editStockQuantity),
      unitPrice: Number(editUnitPrice),
    });
  };

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InventoryMetricCard
          label="Inventory Lines"
          value={String(stats.totalItems)}
          hint="Unique medicine records loaded for the selected pharmacy."
        />
        <InventoryMetricCard
          label="Low Stock"
          value={String(stats.lowStockItems)}
          hint="Items that may soon choke dispensing operations."
        />
        <InventoryMetricCard
          label="Out Of Stock"
          value={String(stats.outOfStockItems)}
          hint="Immediate blockers for prescriptions needing fulfilment."
        />
        <InventoryMetricCard
          label="Catalog Value"
          value={formatLkr(stats.totalStockValue)}
          hint="Rough stock value based on loaded quantities and unit prices."
        />
      </div>

      <div className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Inventory Control
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Load a pharmacy inventory, add medicines, and update pricing or stock without touching clinical notes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.2fr,0.8fr] xl:min-w-[36rem]">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Pharmacy ID
              </span>
              <input
                value={pharmacyIdInput}
                onChange={(event) => onPharmacyIdChange(event.target.value)}
                placeholder="Enter pharmacy ID"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <Button
              type="button"
              isLoading={isLoading}
              onClick={() => void onLoadInventory()}
              className="bg-primary px-5 py-3 text-white dark:bg-blue-600"
            >
              Load Inventory
            </Button>
          </div>
        </div>

        {actionMessage ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {actionMessage}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <PackagePlus className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Add Medicine
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Create a new inventory item for the active pharmacy catalog.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Medicine Name
              </span>
              <input
                value={medicineName}
                onChange={(event) => setMedicineName(event.target.value)}
                placeholder="Paracetamol 500mg"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Stock Quantity
              </span>
              <input
                type="number"
                min="0"
                value={newStockQuantity}
                onChange={(event) => setNewStockQuantity(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Unit Price (LKR)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newUnitPrice}
                onChange={(event) => setNewUnitPrice(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>

          <Button
            type="button"
            isLoading={isMutating}
            disabled={!pharmacyIdInput.trim() || !medicineName.trim()}
            onClick={() => void handleCreateMedicine()}
            className="mt-5 w-full bg-primary py-3 text-white dark:bg-blue-600"
          >
            Add To Inventory
          </Button>
        </article>

        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <Search className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Inventory Search
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Current context: {activePharmacyId ?? "No pharmacy loaded yet"}.
              </p>
            </div>
          </div>

          <label className="mt-6 block space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Search catalog
            </span>
            <input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search medicine, inventory ID, pharmacy ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            Load inventory first, then select an item below to update its quantity or pricing.
          </div>
        </article>
      </div>

      {isLoading ? <LoadingState message="Loading pharmacy inventory..." /> : null}
      {error ? <ErrorState title="Inventory unavailable" message={error} /> : null}

      {!isLoading && !error ? (
        filteredInventory.length === 0 ? (
          <EmptyState
            title="No inventory loaded"
            description="Load a pharmacy ID or add the first medicine entry to start managing stock."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
            <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Inventory Catalog
              </h3>
              <div className="mt-5 space-y-3">
                {filteredInventory.map((item) => {
                  const active = item.id === selectedItemId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectItem(item.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        active
                          ? "border-primary bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.medicineName}
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Inventory ID {item.id}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Qty {item.stockQuantity ?? "N/A"}
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {formatLkr(item.unitPrice)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </article>

            <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Update Selected Item
              </h3>
              {selectedItem ? (
                <>
                  <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {selectedItem.medicineName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Pharmacy {selectedItem.pharmacyId ?? "Unknown"} • {selectedItem.id}
                    </p>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                        Stock Quantity
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={editStockQuantity}
                        onChange={(event) => setEditStockQuantity(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                        Unit Price (LKR)
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editUnitPrice}
                        onChange={(event) => setEditUnitPrice(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <Button
                      type="button"
                      isLoading={isMutating}
                      onClick={() => void handleUpdateMedicine()}
                      className="bg-primary py-3 text-white dark:bg-blue-600"
                    >
                      Update Inventory
                    </Button>
                    <Button
                      type="button"
                      isLoading={isMutating}
                      onClick={() => void onDeleteMedicine(selectedItem.id)}
                      className="inline-flex items-center justify-center gap-2 bg-red-600 py-3 text-white hover:bg-red-700"
                    >
                      <Trash2 size={16} />
                      Delete Item
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState
                  title="Select an inventory item"
                  description="Pick a medicine from the loaded catalog to update stock levels or pricing."
                />
              )}
            </article>
          </div>
        )
      ) : null}
    </section>
  );
}
