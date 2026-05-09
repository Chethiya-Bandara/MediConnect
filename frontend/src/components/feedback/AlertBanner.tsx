import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "../../lib/utils/cn";

type AlertTone = "error" | "success" | "info";

interface AlertBannerProps {
  tone?: AlertTone;
  title?: string;
  message: string;
  className?: string;
}

const toneStyles: Record<AlertTone, string> = {
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300",
};

const toneIcons = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} satisfies Record<AlertTone, typeof AlertTriangle>;

export function AlertBanner({ tone = "info", title, message, className }: AlertBannerProps) {
  const Icon = toneIcons[tone];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm",
        toneStyles[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 shrink-0" size={18} />
      <div>
        {title ? <p className="font-bold">{title}</p> : null}
        <p className={title ? "mt-1" : ""}>{message}</p>
      </div>
    </div>
  );
}
