interface LoadingStateProps {
  message?: string;
}

export function LoadingState({
  message = "Loading...",
}: LoadingStateProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      {message}
    </div>
  );
}
