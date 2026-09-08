// help/place.ts — where a card goes on screen. Pure, so it is testable.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

const GAP = 6;
const MARGIN = 8;

/** Below the anchor, left-aligned; flips above / shifts left to stay on screen. */
export function placeNear(anchor: Rect, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  let x = anchor.left;
  let y = anchor.bottom + GAP;
  if (y + h > vh - MARGIN) {
    const above = anchor.top - GAP - h;
    y = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - h);
  }
  if (x + w > vw - MARGIN) x = Math.max(MARGIN, vw - MARGIN - w);
  return { x, y };
}

export function clampToViewport(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - MARGIN - w)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - MARGIN - h)),
  };
}
