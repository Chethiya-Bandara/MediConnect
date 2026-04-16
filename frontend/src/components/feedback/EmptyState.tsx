import { cn } from "../../lib/utils/cn";

interface EmptyStateProps {
  title: string;
  description: string;
  className?: string;
}

export function EmptyState({
  title,
  description,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}
