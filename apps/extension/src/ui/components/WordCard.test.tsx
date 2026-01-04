/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { browserMock } = vi.hoisted(() => ({
  browserMock: {
    i18n: {
      getMessage: vi.fn((key: string) => key),
    },
  },
}));

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

import { WordCard } from "./WordCard";

describe("WordCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders visible labels using i18n keys", () => {
    render(
      <WordCard
        data={{
          word: "hello",
          definition: "definition",
        }}
      />,
    );

    expect(screen.getByText("wordCard_pronounce")).toBeInTheDocument();
    expect(screen.getByText("wordCard_markLearned")).toBeInTheDocument();
  });
});

