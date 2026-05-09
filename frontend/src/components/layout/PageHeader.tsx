import { cn } from "../../lib/utils/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <h1 className="font-headline text-3xl font-extrabold text-primary dark:text-blue-400">
        {title}
      </h1>
      {description ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
      ) : null}
    </div>
  );
}
