import React from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function OptionsDisclosure(props: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  summaryRight?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}): React.ReactElement {
  const Icon = props.icon;

  return (
    <details
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        props.className,
      )}
    >
      <summary className="cursor-pointer list-none select-none px-6 py-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/30 shadow-sm">
              <Icon className="h-4 w-4 text-muted-foreground" />
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

        <div className="flex items-center gap-2 pt-0.5">
          {props.summaryRight ? (
            <span className="text-xs text-muted-foreground">{props.summaryRight}</span>
          ) : null}
          <ChevronRight
            data-disclosure-chevron
            className="h-4 w-4 text-muted-foreground"
          />
        </div>
      </summary>

      <div className={cn("px-6 pb-6", props.contentClassName)}>{props.children}</div>
    </details>
  );
}
