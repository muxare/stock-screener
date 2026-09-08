// screen/dock.ts — geometry for the docked detail panel.
//
// The detail chart is a flex sibling of the list rather than an overlay, so its
// width is state the user drags. These are the rules that width obeys and the
// breakpoint below which there is no room for both and the panel falls back to
// covering the list. Pure, so the drag handler, the store and a test can share
// them without a DOM.

/** Narrower than this and the chart's own axes start to collide. */
export const DOCK_MIN = 420;
export const DOCK_DEFAULT = 560;
/** Below this viewport width the dock becomes the old full-height overlay. */
export const DOCK_BREAKPOINT = 1100;
/** Whatever the dock is dragged to, this much of the table stays readable. */
const LIST_MIN = 520;

/**
 * The dock width actually used: at least `DOCK_MIN`, never so wide that the
 * list is squeezed below `LIST_MIN`. Called on every drag frame and again at
 * render, so a width saved on a wide screen still fits a narrow one.
 */
export function clampDockWidth(width: number, viewportW = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) return DOCK_DEFAULT;
  const max = Math.max(DOCK_MIN, viewportW - LIST_MIN);
  return Math.round(Math.min(Math.max(width, DOCK_MIN), max));
}

/** True when the viewport cannot hold the table and the dock side by side. */
export function isNarrow(viewportW: number): boolean {
  return viewportW < DOCK_BREAKPOINT;
}
