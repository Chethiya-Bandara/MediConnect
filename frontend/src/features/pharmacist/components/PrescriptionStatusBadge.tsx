import { cn } from "../../../lib/utils/cn";

interface PrescriptionStatusBadgeProps {
  status: string;
}

export function PrescriptionStatusBadge({
  status,
}: PrescriptionStatusBadgeProps) {
  const normalized = status.trim().toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]",
        normalized === "DISPENSED" &&
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
        normalized === "PARTIALLY_DISPENSED" &&
          "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
        normalized === "PENDING" &&
          "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
        normalized !== "DISPENSED" &&
          normalized !== "PARTIALLY_DISPENSED" &&
          normalized !== "PENDING" &&
          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {normalized.replaceAll("_", " ")}
    </span>
  );
}
