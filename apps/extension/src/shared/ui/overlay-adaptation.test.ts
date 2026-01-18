/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from "vitest";

describe("overlay-adaptation", () => {
  it("treats coarse pointer as mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({ matches: true })),
      writable: true,
    });

    const { isCoarsePointer } = await import("./overlay-adaptation");
    expect(isCoarsePointer()).toBe(true);
  });

  it("uses desktop defaults when coarse pointer is false", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({ matches: false })),
      writable: true,
    });

    const { isCoarsePointer } = await import("./overlay-adaptation");
    expect(isCoarsePointer()).toBe(false);
  });

  it("clamps an anchored overlay near the right edge", async () => {
    const { computeAnchoredOverlayPosition } = await import("./overlay-adaptation");

    const pos = computeAnchoredOverlayPosition({
      anchorRect: { top: 20, left: 190, bottom: 30, width: 10, height: 10 },
      overlaySize: { width: 100, height: 50 },
      viewport: { width: 200, height: 200 },
      marginPx: 10,
      offsetPx: 10,
      prefer: "below",
    });

    expect(pos.left).toBe(90);
  });

  it("falls back above when below would overflow", async () => {
    const { computeAnchoredOverlayPosition } = await import("./overlay-adaptation");

    const pos = computeAnchoredOverlayPosition({
      anchorRect: { top: 180, left: 50, bottom: 190, width: 10, height: 10 },
      overlaySize: { width: 100, height: 80 },
      viewport: { width: 200, height: 200 },
      marginPx: 10,
      offsetPx: 10,
      prefer: "below",
    });

    expect(pos.top).toBe(90);
  });
});

