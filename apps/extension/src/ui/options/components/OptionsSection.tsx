import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function OptionsSection(props: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary";
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}): React.ReactElement {
  const Icon = props.icon;
  const tone = props.tone ?? "default";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card shadow-none",
        props.className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-60",
          tone === "primary"
            ? "bg-gradient-to-br from-primary/12 dark:from-primary/6 via-transparent to-transparent"
            : "bg-gradient-to-br from-muted/40 via-transparent to-transparent",
        )}
      />

      <div className={cn("relative p-6", props.contentClassName)}>
        {props.title ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {Icon ? (
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/30 shadow-sm">
                  <Icon className={cn("h-4 w-4", tone === "primary" ? "text-primary" : "text-muted-foreground")} />
                </div>
              ) : null}
              <div className="space-y-1">
                <div className="text-sm font-medium">{props.title}</div>
                {props.description ? (
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    {props.description}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className={cn(props.title ? "mt-5" : undefined)}>{props.children}</div>
      </div>
    </section>
  );
}

