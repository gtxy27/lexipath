/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";

import { buildChatBackgroundInfo } from "./context";

describe("buildChatBackgroundInfo", () => {
  it("redacts email-like and phone-like strings", () => {
    const text = buildChatBackgroundInfo(
      {
        kind: "web",
        title: "Title",
        domain: "example.com",
        selectedText: "Contact me at test@example.com or +1 (555) 123-4567",
      },
      { title: true, timestamp: false, snippet: true },
    );

    expect(text).toContain("[REDACTED_EMAIL]");
    expect(text).toContain("[REDACTED_PHONE]");
    expect(text).not.toContain("test@example.com");
    expect(text).not.toContain("555");
  });

  it("returns undefined when nothing is selected", () => {
    const text = buildChatBackgroundInfo(
      {
        kind: "web",
        title: "Title",
        domain: "example.com",
        selectedText: "hello",
      },
      { title: false, timestamp: false, snippet: false },
    );

    expect(text).toBeUndefined();
  });
});
