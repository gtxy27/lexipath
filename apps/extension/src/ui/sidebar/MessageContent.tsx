import React from "react";
import Markdown from "markdown-to-jsx";

function isExternalHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const MessageContent = React.memo(function MessageContent(props: {
  content: string;
  isStreaming?: boolean;
}) {
  const content = props.content ?? "";
  const isStreaming = Boolean(props.isStreaming);

  if (isStreaming) {
    return (
      <div className="whitespace-pre-wrap break-words font-medium">
        {content}
        <span className="ml-0.5 inline-block w-[0.5ch] animate-pulse select-none">
          {"\u258C"}
        </span>
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed">
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
                  "my-2 overflow-x-auto rounded-xl border border-gray-200/70 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-3",
              },
            },
            code: {
              props: {
                className:
                  "rounded bg-gray-100 dark:bg-white/10 px-1 py-0.5 font-mono text-[0.85em]",
              },
            },
            table: {
              props: {
                className:
                  "my-2 w-full border-collapse overflow-hidden rounded-xl border border-gray-200/70 dark:border-white/10",
              },
            },
            th: {
              props: {
                className:
                  "border border-gray-200/70 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1 text-left font-semibold",
              },
            },
            td: {
              props: {
                className:
                  "border border-gray-200/70 dark:border-white/10 px-2 py-1 align-top",
              },
            },
            blockquote: {
              props: {
                className:
                  "my-2 border-l-2 border-indigo-400/60 pl-3 text-gray-700 dark:text-gray-300",
              },
            },
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
