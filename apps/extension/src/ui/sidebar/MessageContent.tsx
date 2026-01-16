import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { t } from "../../shared/i18n";
import { cn } from "../lib/utils";

const log = createLogger("ui:MessageContent");

function getTextFromChildren(children: React.ReactNode): string {
  if (children === null || children === undefined) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(getTextFromChildren).join("");
  if (React.isValidElement(children)) return getTextFromChildren(children.props.children);
  return "";
}

function getLanguageFromClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const match = className.match(/language-([a-z0-9_-]+)/i);
  return match?.[1];
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator?.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back below.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

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
  const blockSpacing = "my-2 first:mt-0 last:mb-0";

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
    <div className={cn("lx-message-markdown text-sm leading-relaxed", props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a({ className, href, ...rest }) {
            const safeHref = typeof href === "string" ? href : "";
            const external = safeHref && isExternalHref(safeHref);
            return (
              <a
                {...rest}
                href={safeHref}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
                className={cn(
                  "text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:opacity-80",
                  className,
                )}
              />
            );
          },
          p({ className, ...rest }) {
            return <p {...rest} className={cn(blockSpacing, className)} />;
          },
          ul({ className, ...rest }) {
            return <ul {...rest} className={cn(blockSpacing, "list-disc pl-5", className)} />;
          },
          ol({ className, ...rest }) {
            return <ol {...rest} className={cn(blockSpacing, "list-decimal pl-5", className)} />;
          },
          li({ className, ...rest }) {
            return <li {...rest} className={cn("my-1 first:mt-0 last:mb-0", className)} />;
          },
          pre({ node, className, children, ...rest }) {
            const copyTimeoutRef = React.useRef<number | undefined>(undefined);
            const [copied, setCopied] = React.useState(false);

            React.useEffect(() => {
              return () => {
                if (copyTimeoutRef.current !== undefined) {
                  window.clearTimeout(copyTimeoutRef.current);
                }
              };
            }, []);

            const childNodes = React.Children.toArray(children);
            const firstChild = childNodes[0];
            const codeElement =
              React.isValidElement(firstChild) && firstChild.type === "code" ? firstChild : undefined;

            if (!codeElement) {
              return (
                <pre
                  {...rest}
                  className={cn(
                    blockSpacing,
                    "overflow-x-auto rounded-xl border border-border bg-muted/30 p-3",
                    className,
                  )}
                >
                  {children}
                </pre>
              );
            }

            const language = getLanguageFromClassName(
              codeElement?.props?.className ? String(codeElement.props.className) : undefined,
            );
            const codeText = getTextFromChildren(codeElement.props.children).replace(/\n$/, "");
            const canCopy = Boolean(codeText);
            const languageLabel = language ? language.toUpperCase() : t("chatCodeBlock");
            const copyLabel = copied ? t("chatCopiedCode") : t("chatCopyCode");

            const handleCopy = React.useCallback(async () => {
              if (!codeText) return;
              const ok = await copyToClipboard(codeText);
              if (!ok) return;

              setCopied(true);
              if (copyTimeoutRef.current !== undefined) {
                window.clearTimeout(copyTimeoutRef.current);
              }
              copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
            }, [codeText]);

            return (
              <div
                className={cn(
                  blockSpacing,
                  "group overflow-hidden rounded-xl border border-border bg-muted/20",
                  className,
                )}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                    {languageLabel}
                  </span>
                  {canCopy && (
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label={copyLabel}
                      title={copyLabel}
                      className={cn(
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition",
                        "hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                <pre {...rest} className="overflow-x-auto p-3">
                  {children}
                </pre>
              </div>
            );
          },
          code({ className, children, ...rest }) {
            const text = Array.isArray(children) ? children.join("") : String(children ?? "");
            const hasLanguageClass = typeof className === "string" && className.includes("language-");
            const isInline = !hasLanguageClass && !text.includes("\n");
            return (
              <code
                {...rest}
                className={cn(
                  isInline
                    ? "rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.85em]"
                    : "block bg-transparent p-0 font-mono text-[0.85em] leading-relaxed",
                  !isInline && hasLanguageClass ? "hljs" : undefined,
                  className,
                )}
              >
                {children}
              </code>
            );
          },
          table({ className, ...rest }) {
            return (
              <div className={cn(blockSpacing, "overflow-x-auto rounded-xl border border-border")}>
                <table {...rest} className={cn("w-max min-w-full border-collapse", className)} />
              </div>
            );
          },
          tr({ className, ...rest }) {
            return (
              <tr
                {...rest}
                className={cn("even:bg-muted/10 hover:bg-muted/20 transition-colors", className)}
              />
            );
          },
          th({ className, ...rest }) {
            return (
              <th
                {...rest}
                className={cn(
                  "border border-border/70 bg-muted/30 px-3 py-2 text-left text-xs font-semibold text-muted-foreground",
                  className,
                )}
              />
            );
          },
          td({ className, ...rest }) {
            return <td {...rest} className={cn("border border-border/70 px-3 py-2 align-top", className)} />;
          },
          blockquote({ className, ...rest }) {
            return (
              <blockquote
                {...rest}
                className={cn(blockSpacing, "border-l-2 border-primary/35 pl-3 text-muted-foreground", className)}
              />
            );
          },
          hr({ className, ...rest }) {
            return (
              <hr
                {...rest}
                className={cn("my-3 first:mt-0 last:mb-0 border-0 border-t border-border/70", className)}
              />
            );
          },
          h1({ className, ...rest }) {
            return <h1 {...rest} className={cn("mt-4 first:mt-0 mb-2 last:mb-0 text-base font-semibold", className)} />;
          },
          h2({ className, ...rest }) {
            return <h2 {...rest} className={cn("mt-4 first:mt-0 mb-2 last:mb-0 text-base font-semibold", className)} />;
          },
          h3({ className, ...rest }) {
            return <h3 {...rest} className={cn("mt-3 first:mt-0 mb-2 last:mb-0 text-sm font-semibold", className)} />;
          },
          h4({ className, ...rest }) {
            return <h4 {...rest} className={cn("mt-3 first:mt-0 mb-2 last:mb-0 text-sm font-semibold", className)} />;
          },
          h5({ className, ...rest }) {
            return <h5 {...rest} className={cn("mt-2 first:mt-0 mb-1.5 last:mb-0 text-sm font-semibold", className)} />;
          },
          h6({ className, ...rest }) {
            return <h6 {...rest} className={cn("mt-2 first:mt-0 mb-1.5 last:mb-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
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
