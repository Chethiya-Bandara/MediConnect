import type { ReactNode } from "react";
import clsx from "clsx";

interface CardProps {
  title?: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}

export function Card({ title, subtitle, className, children }: CardProps) {
  return (
    <section className={clsx("ui-card", className)}>
      {(title || subtitle) && (
        <header className="ui-card__header">
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
