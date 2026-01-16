import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageContent } from "./MessageContent";

describe("MessageContent", () => {
  it("renders fenced code blocks", () => {
    const { container } = render(
      <MessageContent
        content={[
          "Here is code:",
          "",
          "```ts",
          "const x = 1;",
          "console.log(x);",
          "```",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.textContent).toContain("const x = 1;");
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("does not highlight code blocks without language", () => {
    const { container } = render(
      <MessageContent
        content={[
          "```",
          "const x = 1;",
          "console.log(x);",
          "```",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.textContent).toContain("const x = 1;");
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("renders inline and block math via KaTeX", () => {
    const { container } = render(
      <MessageContent
        content={[
          "Inline: $E=mc^2$",
          "",
          "$$\\\\frac{1}{2}$$",
        ].join("\n")}
      />,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
