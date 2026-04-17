import { Inbox } from "lucide-react";
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
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <Inbox size={20} />
      </div>
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}
