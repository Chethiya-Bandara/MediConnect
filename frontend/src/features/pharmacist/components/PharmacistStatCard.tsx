import { cn } from "../../../lib/utils/cn";

interface PharmacistStatCardProps {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}

export function PharmacistStatCard({
  label,
  value,
  hint,
  className,
}: PharmacistStatCardProps) {
  return (
    <article
      className={cn(
        "rounded-[1.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 font-headline text-3xl font-extrabold text-slate-900 dark:text-slate-100">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </article>
  );
}
