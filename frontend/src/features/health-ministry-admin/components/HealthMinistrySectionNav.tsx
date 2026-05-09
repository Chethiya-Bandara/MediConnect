import { cn } from "../../../lib/utils/cn";
import { healthMinistrySectionTabs } from "../constants";
import type { HealthMinistryAdminSection } from "../types";

interface HealthMinistrySectionNavProps {
  value: HealthMinistryAdminSection;
  onChange: (section: HealthMinistryAdminSection) => void;
}

export function HealthMinistrySectionNav({ value, onChange }: HealthMinistrySectionNavProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {healthMinistrySectionTabs.map((item) => {
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
