import { useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../../components/layout/PageHeader";
import { useAuth } from "../../auth/context/AuthContext";
import { formatDate } from "../../../lib/utils/formatDate";
import { PharmacyAdminSectionNav } from "../components/PharmacyAdminSectionNav";
import { usePharmacyAdminDashboard } from "../hooks/usePharmacyAdminDashboard";
import { BillingSection } from "../sections/BillingSection";
import { InventorySection } from "../sections/InventorySection";
import { PrescriptionsSection } from "../sections/PrescriptionsSection";
import { SettingsSection } from "../sections/SettingsSection";
import type { PharmacyAdminSection } from "../types";

export function PharmacyAdminDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<PharmacyAdminSection>("inventory");
  const dashboard = usePharmacyAdminDashboard();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-surface px-6 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 via-emerald-700 to-teal-600 px-6 py-8 text-white shadow-2xl shadow-emerald-900/20 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-emerald-100">
                <Boxes size={14} />
                MediConnect Pharmacy Operations
              </div>
              <PageHeader
                title="Pharmacy Admin Control Desk"
                description={`Proposal-aligned workspace for inventory, price control, operational prescription readiness, and billing oversight. Last checked ${formatDate(new Date())}.`}
                className="mt-4 [&_h1]:text-white [&_p]:text-emerald-100/80"
              />
            </div>

            <button
              type="button"
              onClick={() => void dashboard.loadInventory()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <RefreshCw size={16} />
              Refresh Inventory
            </button>
          </div>
        </section>

        <PharmacyAdminSectionNav value={section} onChange={setSection} />

        {section === "inventory" ? (
          <InventorySection
            pharmacyIdInput={dashboard.pharmacyIdInput}
            activePharmacyId={dashboard.activePharmacyId}
            filteredInventory={dashboard.filteredInventory}
            selectedItem={dashboard.selectedItem}
            selectedItemId={dashboard.selectedItemId}
            stats={dashboard.stats}
            searchQuery={dashboard.searchQuery}
            error={dashboard.error}
            actionMessage={dashboard.actionMessage}
            isLoading={dashboard.isLoadingInventory}
            isMutating={dashboard.isMutatingInventory}
            onPharmacyIdChange={dashboard.setPharmacyIdInput}
            onSearchChange={dashboard.setSearchQuery}
            onSelectItem={dashboard.setSelectedItemId}
            onLoadInventory={dashboard.loadInventory}
            onCreateMedicine={dashboard.createMedicine}
            onUpdateMedicine={dashboard.updateMedicine}
            onDeleteMedicine={dashboard.removeMedicine}
          />
        ) : null}

        {section === "prescriptions" ? (
          <PrescriptionsSection
            activePharmacyId={dashboard.activePharmacyId}
            inventory={dashboard.inventory}
            stats={dashboard.stats}
          />
        ) : null}

        {section === "billing" ? (
          <BillingSection inventory={dashboard.inventory} stats={dashboard.stats} />
        ) : null}

        {section === "settings" ? (
          <SettingsSection
            user={user}
            activePharmacyId={dashboard.activePharmacyId}
            onLogout={handleLogout}
          />
        ) : null}
      </div>
    </div>
  );
}
