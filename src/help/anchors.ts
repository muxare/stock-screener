// help/anchors.ts — help targets that are not elements.
//
// Everywhere else in the app a help target is an element carrying
// data-help="<topic>", and HelpProvider finds it with closest(). A chart is one
// canvas: the pattern chip you want documented is pixels, not a node, so there
// is nothing for closest() to find and nothing for :hover to report.
//
// A virtual anchor is the second implementation of exactly those two things. A
// canvas publishes the target under the pointer and clears it on the way out;
// the provider treats it as it would a hovered element, and everything
// downstream — the summon modifier, the delay, the latch, T, Esc, the chain —
// is unchanged, which is what putting the decision in trigger.ts bought.
//
// Identity is the `key`: republishing the same key is a no-op, so a chart may
// call this on every mousemove without restarting a timer that is already
// running for the same mark.

import { createContext, useContext } from 'react';
import type { Rect } from './place';

export interface VirtualAnchor {
  /** stable identity for one mark — e.g. `chip:pinBar@412` */
  key: string;
  /** glossary topic id */
  topic: string;
  /** the mark itself, in viewport coordinates */
  rect: Rect;
  /**
   * The region the card must stay clear of, in viewport coordinates. A DOM
   * anchor passes its parent element here; a chart passes the half of the plot
   * the mark is in, so the card docks to the quieter half instead of landing
   * on the bars it is explaining.
   */
  host?: Rect;
  /**
   * Why this one fired, here — one line above the glossary body. Generic
   * documentation answers "what is a pin bar"; this answers "why is there one
   * on this bar", which is the question someone pointing at a glyph is asking.
   */
  instance?: string;
}

/** Publish the target under the pointer, or null when there is none. */
export type PublishAnchor = (anchor: VirtualAnchor | null) => void;

const noop: PublishAnchor = () => {};

export const HelpAnchorContext = createContext<PublishAnchor>(noop);

/**
 * The publisher for a canvas that documents its own contents. Stable across
 * renders, so it is safe in an effect's dependency list. Outside a
 * HelpProvider it does nothing.
 */
export function useHelpAnchor(): PublishAnchor {
  return useContext(HelpAnchorContext);
}

/**
 * Is this a different target from the one already published? The key is the
 * identity, so a canvas republishing the same mark on every mousemove changes
 * nothing — the timer that is already running for it keeps running — while a
 * new key swaps the pending target and a null clears it.
 */
export function anchorChanged(prev: VirtualAnchor | null, next: VirtualAnchor | null): boolean {
  return (prev?.key ?? null) !== (next?.key ?? null);
}

/** Move a rect from canvas coordinates into the viewport. */
export function toViewport(box: { left: number; top: number; right: number; bottom: number }, origin: { left: number; top: number }): Rect {
  const left = origin.left + box.left, top = origin.top + box.top;
  const right = origin.left + box.right, bottom = origin.top + box.bottom;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
