import React from "react";
import { cn } from "../../lib/utils";

export function OptionsRow(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between",
        props.className,
      )}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? (
          <div className="text-xs text-muted-foreground">{props.description}</div>
        ) : null}
      </div>
      <div className="sm:ml-6 shrink-0">{props.children}</div>
    </div>
  );
}

