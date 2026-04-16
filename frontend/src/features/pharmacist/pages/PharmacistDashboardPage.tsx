import { useState } from "react";
import { Pill, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../../components/layout/PageHeader";
import { useAuth } from "../../auth/context/AuthContext";
import { formatDate } from "../../../lib/utils/formatDate";
import { PharmacistSectionNav } from "../components/PharmacistSectionNav";
import { OverviewSection } from "../sections/OverviewSection";
import { PrescriptionLookupSection } from "../sections/PrescriptionLookupSection";
import { DispensingSection } from "../sections/DispensingSection";
import { SettingsSection } from "../sections/SettingsSection";
import { usePharmacistDashboard } from "../hooks/usePharmacistDashboard";
import type { PharmacistSection } from "../types";

export function PharmacistDashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<PharmacistSection>("overview");
  const dashboard = usePharmacistDashboard(user?.id);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-surface px-6 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-blue-700 to-slate-900 px-6 py-8 text-white shadow-2xl shadow-blue-900/20 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-blue-100">
                <Pill size={14} />
                MediConnect Pharmacist Console
              </div>
              <PageHeader
                title="Pharmacy Dispensing Workspace"
                description={`Proposal-aligned queue for prescription lookup, dispense actions, and pharmacy-safe billing review. Last checked ${formatDate(new Date())}.`}
                className="mt-4 [&_h1]:text-white [&_p]:text-blue-100/80"
              />
            </div>

            <button
              type="button"
              onClick={() => void dashboard.refresh()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <RefreshCw size={16} />
              Refresh Queue
            </button>
          </div>
        </section>

        <PharmacistSectionNav value={section} onChange={setSection} />

        {section === "overview" ? (
          <OverviewSection stats={dashboard.stats} />
        ) : null}

        {section === "lookup" ? (
          <PrescriptionLookupSection
            prescriptions={dashboard.filteredPrescriptions}
            selectedPrescriptionId={dashboard.selectedPrescriptionId}
            searchQuery={dashboard.searchQuery}
            onSearchChange={dashboard.setSearchQuery}
            onSelect={dashboard.setSelectedPrescriptionId}
            isLoading={dashboard.isLoadingList}
            error={dashboard.error}
          />
        ) : null}

        {section === "dispensing" ? (
          <DispensingSection
            detail={dashboard.selectedDetail}
            isLoading={dashboard.isLoadingDetail}
            error={dashboard.detailError}
            isDispensing={dashboard.isDispensing}
            actionMessage={dashboard.actionMessage}
            onDispense={() => void dashboard.dispenseSelected()}
          />
        ) : null}

        {section === "settings" ? (
          <SettingsSection user={user} onLogout={handleLogout} />
        ) : null}
      </div>
    </div>
  );
}
