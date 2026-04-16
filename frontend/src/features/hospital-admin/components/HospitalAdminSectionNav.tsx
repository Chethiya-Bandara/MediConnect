import { cn } from "../../../lib/utils/cn";
import { hospitalAdminSectionTabs } from "../constants";
import type { HospitalAdminSection } from "../types";

interface HospitalAdminSectionNavProps {
  value: HospitalAdminSection;
  onChange: (section: HospitalAdminSection) => void;
}

export function HospitalAdminSectionNav({
  value,
  onChange,
}: HospitalAdminSectionNavProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {hospitalAdminSectionTabs.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              active
                ? "border-primary bg-primary text-white shadow-md dark:border-blue-500 dark:bg-blue-600"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <Icon size={16} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
