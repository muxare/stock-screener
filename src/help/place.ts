// help/place.ts — where a card goes on screen. Pure, so it is testable.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

const GAP = 6;
const MARGIN = 8;

/**
 * Beside the anchor, on whichever side has more room, top-aligned with it.
 *
 * Below-then-above was the wrong default: for anything in the TopBar or the
 * filter row, "below" is the table you were reading, so a card you did not
 * quite mean to summon covered the answer you were already looking at. Beside
 * never covers the anchor's own row, and it keeps the card in the same band of
 * the screen as the control it explains.
 *
 * `host` is the control the anchor belongs to — the search box around the ⌕,
 * the tab around its label, the card body around a highlighted term. Narrow
 * anchors are the point of phase 3, and beside a narrow anchor is usually
 * *inside* its own control, so the side is chosen to clear the host when a
 * side still fits for it. When the host is too wide to have a side (a table
 * header row, the TopBar) the anchor decides on its own.
 *
 * Only when neither side fits at all does it fall back to the old below /
 * above behaviour.
 */
export function placeNear(anchor: Rect, w: number, h: number, vw: number, vh: number, host?: Rect): { x: number; y: number } {
  const beside = (r: Rect): number | null => {
    const roomRight = vw - MARGIN - (r.right + GAP);
    const roomLeft = (r.left - GAP) - MARGIN;
    const fitsRight = roomRight >= w;
    const fitsLeft = roomLeft >= w;
    if (!fitsRight && !fitsLeft) return null;
    const onRight = fitsRight && (!fitsLeft || roomRight >= roomLeft);
    return onRight ? r.right + GAP : r.left - GAP - w;
  };

  const x = (host ? beside(host) : null) ?? beside(anchor);
  if (x != null) {
    // Top-aligned so the card reads as attached to the anchor; pushed up only
    // as far as staying on screen requires.
    return { x, y: Math.min(Math.max(MARGIN, anchor.top), Math.max(MARGIN, vh - MARGIN - h)) };
  }

  let y = anchor.bottom + GAP;
  if (y + h > vh - MARGIN) {
    const above = anchor.top - GAP - h;
    y = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - h);
  }
  return { x: Math.min(Math.max(MARGIN, anchor.left), Math.max(MARGIN, vw - MARGIN - w)), y };
}

export function clampToViewport(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - MARGIN - w)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - MARGIN - h)),
  };
}
