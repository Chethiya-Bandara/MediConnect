interface InventoryMetricCardProps {
  label: string;
  value: string;
  hint: string;
}

export function InventoryMetricCard({ label, value, hint }: InventoryMetricCardProps) {
  return (
    <article className="rounded-[1.7rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-3 font-headline text-3xl font-extrabold text-slate-900 dark:text-slate-100">
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
    </article>
  );
}
