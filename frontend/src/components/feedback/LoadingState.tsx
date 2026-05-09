import { LoaderCircle } from "lucide-react";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
        <LoaderCircle className="animate-spin text-blue-600 dark:text-blue-400" size={20} />
        <span>{message}</span>
      </div>
    </div>
  );
}
