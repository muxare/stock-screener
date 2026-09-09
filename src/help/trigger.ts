// help/trigger.ts — whether a hover target opens its card, and after how long.
// Pure, so it is testable: the provider owns the timers, the listeners and the
// DOM; this owns the rule.
//
// A cold pointer opens nothing. The first card has to be asked for, by holding
// the summon modifier — which is what stops a card appearing under a pointer
// that was only crossing the screen. Once a card is up the modifier is
// redundant (you are already reading documentation), so an open chain, and a
// short grace after the last card closes, put plain hover back.

export type SummonModifier = 'shift' | 'ctrl' | 'meta';

/**
 * Which key summons the first card. One edit changes the gesture everywhere,
 * including the on-screen copy, which is generated from `SUMMON_LABEL`.
 *
 * Shift, because Ctrl and Cmd are browser keys: Ctrl+click is the secondary
 * click on macOS and every help target is a live control, Ctrl/Cmd+wheel is
 * browser zoom, and Ctrl/Cmd+T opens a tab — which would fight the pin key.
 */
export const SUMMON_MODIFIER: SummonModifier = 'shift';

const MODIFIER_LABEL: Record<SummonModifier, string> = {
  shift: '⇧ Shift',
  ctrl: 'Ctrl',
  meta: '⌘ Cmd',
};

export const SUMMON_LABEL = MODIFIER_LABEL[SUMMON_MODIFIER];

/**
 * Read the modifier off the event's own flags rather than matching `e.key`.
 * That gets both Shift keys for free, and keeps the state right when the key
 * went down before the window had focus.
 */
export function isModifierDown(e: KeyboardEvent | MouseEvent): boolean {
  if (SUMMON_MODIFIER === 'ctrl') return e.ctrlKey;
  if (SUMMON_MODIFIER === 'meta') return e.metaKey;
  return e.shiftKey;
}

export interface TriggerDelays {
  /** plain hover, once documentation is already in play */
  hover: number;
  /** a highlighted term inside an open card */
  nested: number;
  /** the modifier is down — an explicit request needs no suspicion delay */
  armed: number;
}

export interface TriggerState {
  /** the target is a term inside an open help card */
  insideCard: boolean;
  /** at least one hover card is showing */
  chainOpen: boolean;
  /** sticky help mode (phase 2); always false today */
  helpMode: boolean;
  /** the summon modifier is down */
  modifierDown: boolean;
  /** a mouse button is down — never arm mid-drag */
  pointerBusy: boolean;
  /** epoch ms the plain-hover grace runs to; 0 = not latched */
  latchedUntil: number;
  now: number;
}

export type TriggerDecision =
  /** `armable`: the modifier would open this target right now */
  | { open: false; armable: boolean }
  | { open: true; delay: number };

export function decideTrigger(s: TriggerState, d: TriggerDelays): TriggerDecision {
  // Drag-to-pan is the primary chart gesture; a card must never appear under a
  // pointer that is in the middle of one.
  if (s.pointerBusy) return { open: false, armable: false };
  if (s.insideCard) return { open: true, delay: d.nested };
  if (s.helpMode || s.chainOpen || s.now < s.latchedUntil) return { open: true, delay: d.hover };
  if (s.modifierDown) return { open: true, delay: d.armed };
  return { open: false, armable: true };
}
