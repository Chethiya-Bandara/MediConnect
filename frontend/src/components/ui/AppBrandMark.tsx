import mediConnectLogo from "../../../logo/logo.png";
import { cn } from "../../lib/utils/cn";

interface AppBrandMarkProps {
  className?: string;
  copyClassName?: string;
  logoClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
  titleClassName?: string;
}

export function AppBrandMark({
  className,
  copyClassName,
  logoClassName,
  subtitle,
  subtitleClassName,
  titleClassName,
}: AppBrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <img
        src={mediConnectLogo}
        alt="MediConnect logo"
        className={cn("h-10 w-auto shrink-0 object-contain", logoClassName)}
      />
      <div className={cn("min-w-0", copyClassName)}>
        <p
          className={cn(
            "font-headline text-lg font-black leading-none tracking-tight",
            titleClassName,
          )}
        >
          <span className="text-sky-700 dark:text-sky-300">Medi</span>
          <span className="text-emerald-600 dark:text-emerald-400">Connect</span>
        </p>
        {subtitle ? (
          <p
            className={cn(
              "mt-1 text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400",
              subtitleClassName,
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
