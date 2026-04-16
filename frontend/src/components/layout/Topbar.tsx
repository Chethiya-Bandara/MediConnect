import type { PropsWithChildren } from "react";
import { cn } from "../../lib/utils/cn";

interface TopbarProps extends PropsWithChildren {
  className?: string;
}

export function Topbar({ className, children }: TopbarProps) {
  return (
    <header className={cn("flex items-center justify-between gap-4", className)}>
      {children}
    </header>
  );
}
