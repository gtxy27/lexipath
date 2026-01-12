import React from "react";
import Markdown from "markdown-to-jsx";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { t } from "../../shared/i18n";
import { cn } from "../lib/utils";

const log = createLogger("ui:MessageContent");

function isExternalHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error: unknown) {
    log.debug("Failed to parse href as URL; treating as non-external", { href, message: getErrorMessage(error) });
    return false;
  }
}

export const MessageContent = React.memo(function MessageContent(props: {
  content: string;
  isStreaming?: boolean;
  className?: string;
  showCursor?: boolean;
}) {
  const content = props.content ?? "";
  const isStreaming = Boolean(props.isStreaming);
  const showCursor = props.showCursor ?? true;

  if (isStreaming && !content.trim()) {
    return (
      <div
        className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", props.className)}
        aria-label={t("chatThinking")}
      >
        <span className="h-2 w-2 rounded-full bg-muted-foreground/35 animate-pulse" style={{ animationDelay: "0ms" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/35 animate-pulse" style={{ animationDelay: "180ms" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/35 animate-pulse" style={{ animationDelay: "360ms" }} />
      </div>
    );
  }

  return (
    <div className={cn("text-sm leading-relaxed", props.className)}>
      <Markdown
        options={{
          disableParsingRawHTML: true,
          overrides: {
            a: {
              props: (props: any) => {
                const href = typeof props.href === "string" ? props.href : "";
                const external = href && isExternalHref(href);
                return {
                  ...props,
                  target: external ? "_blank" : undefined,
                  rel: external ? "noreferrer noopener" : undefined,
                  className:
                    "text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:opacity-80",
                };
              },
            },
            p: { props: { className: "my-2" } },
            ul: {
              props: { className: "my-2 list-disc pl-5" },
            },
            ol: {
              props: { className: "my-2 list-decimal pl-5" },
            },
            li: {
              props: { className: "my-1" },
            },
            pre: {
              props: {
                className:
                  "my-2 overflow-x-auto rounded-xl border border-border bg-muted/30 p-3",
              },
            },
            code: {
              props: (props: any) => {
                const children = props.children;
                const isBlock = typeof children === "string" && children.includes("\n");

                return {
                  ...props,
                  className: cn(
                    isBlock
                      ? "block bg-transparent p-0 font-mono text-[0.85em] leading-relaxed"
                      : "rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.85em]",
                    props.className,
                  ),
                };
              },
            },
            table: {
              props: {
                className:
                  "my-2 w-full border-collapse overflow-hidden rounded-xl border border-border",
              },
            },
            th: {
              props: {
                className:
                  "border border-border bg-muted/30 px-2 py-1 text-left font-semibold",
              },
            },
            td: {
              props: {
                className:
                  "border border-border px-2 py-1 align-top",
              },
            },
            blockquote: {
              props: {
                className:
                  "my-2 border-l-2 border-primary/35 pl-3 text-muted-foreground",
              },
            },
          },
        }}
      >
        {content}
      </Markdown>
      {isStreaming && showCursor && (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block w-[0.5ch] animate-pulse select-none align-baseline"
        >
          {"\u258C"}
        </span>
      )}
    </div>
  );
});
