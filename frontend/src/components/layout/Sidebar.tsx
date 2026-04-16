import type { PropsWithChildren } from "react";
import { cn } from "../../lib/utils/cn";

interface SidebarProps extends PropsWithChildren {
  className?: string;
}

export function Sidebar({ className, children }: SidebarProps) {
  return <aside className={cn("space-y-4", className)}>{children}</aside>;
}
