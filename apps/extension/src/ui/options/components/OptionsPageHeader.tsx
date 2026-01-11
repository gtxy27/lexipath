import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function OptionsPageHeader(props: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const Icon = props.icon;
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        props.className,
      )}
    >
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="relative mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
            <Icon className="relative h-5 w-5 text-primary" />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">{props.title}</h2>
          {props.description ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {props.description}
            </p>
          ) : null}
        </div>
      </div>

      {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
    </header>
  );
}

