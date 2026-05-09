import { AlertTriangle } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
}

export function ErrorState({ title = "Something went wrong", message }: ErrorStateProps) {
  return (
    <div className="rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-900/40 dark:bg-slate-900">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300">
        <AlertTriangle size={22} />
      </div>
      <h2 className="text-xl font-bold text-red-700 dark:text-red-300">{title}</h2>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>
    </div>
  );
}
