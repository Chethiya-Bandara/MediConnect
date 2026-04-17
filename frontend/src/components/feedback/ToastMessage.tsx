import { CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "../../lib/utils/cn";

interface ToastMessageProps {
  message: string;
  tone: "success" | "error" | "info";
}

const toneStyles = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-slate-800 text-white dark:bg-slate-700",
} satisfies Record<ToastMessageProps["tone"], string>;

const toneIcons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} satisfies Record<ToastMessageProps["tone"], typeof CheckCircle2>;

export function ToastMessage({ message, tone }: ToastMessageProps) {
  const Icon = toneIcons[tone];

  return (
    <div
      className={cn(
        "fixed left-1/2 top-6 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full px-6 py-3 text-sm font-bold shadow-2xl",
        toneStyles[tone],
      )}
      role="status"
      aria-live="polite"
    >
      <Icon size={18} />
      <span>{message}</span>
    </div>
  );
}
