export type AnchoredOverlayPositionInput = Readonly<{
  anchorRect: Pick<DOMRect, "top" | "left" | "bottom" | "width" | "height">;
  overlaySize: Readonly<{ width: number; height: number }>;
  viewport: Readonly<{ width: number; height: number }>;
  marginPx: number;
  offsetPx: number;
  prefer: "above" | "below";
}>;

/**
 * Coarse pointer detection used for "mobile-like" overlay behavior.
 * This intentionally relies only on `(pointer: coarse)` so desktop defaults remain stable.
 */
export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  } catch {
    return false;
  }
}

export function computeAnchoredOverlayPosition(
  input: AnchoredOverlayPositionInput,
): { top: number; left: number } {
  const { anchorRect, overlaySize, viewport, marginPx, offsetPx, prefer } = input;

  const maxLeft = viewport.width - overlaySize.width - marginPx;
  const maxTop = viewport.height - overlaySize.height - marginPx;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const idealLeft = anchorRect.left + anchorRect.width / 2 - overlaySize.width / 2;
  const left = clamp(idealLeft, marginPx, maxLeft);

  const belowTop = anchorRect.bottom + offsetPx;
  const aboveTop = anchorRect.top - overlaySize.height - offsetPx;
  const preferTop = prefer === "below" ? belowTop : aboveTop;
  const fallbackTop = prefer === "below" ? aboveTop : belowTop;

  const fits = (top: number) => top >= marginPx && top + overlaySize.height <= viewport.height - marginPx;
  const top = clamp(fits(preferTop) ? preferTop : fallbackTop, marginPx, maxTop);

  return { top, left };
}

export function clampOverlayPositionToViewport(input: Readonly<{
  position: Readonly<{ top: number; left: number }>;
  overlaySize: Readonly<{ width: number; height: number }>;
  viewport: Readonly<{ width: number; height: number }>;
  marginPx: number;
}>): { top: number; left: number } {
  const { position, overlaySize, viewport, marginPx } = input;

  const maxLeft = viewport.width - overlaySize.width - marginPx;
  const maxTop = viewport.height - overlaySize.height - marginPx;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  return {
    top: clamp(position.top, marginPx, maxTop),
    left: clamp(position.left, marginPx, maxLeft),
  };
}
