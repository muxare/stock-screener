import { describe, expect, it } from 'vitest';
import { decideTrigger, type TriggerDelays, type TriggerState } from './trigger';

const D: TriggerDelays = { hover: 380, nested: 180, armed: 90 };

/** A cold pointer: no card up, no modifier, no latch. */
const cold: TriggerState = {
  insideCard: false,
  chainOpen: false,
  helpMode: false,
  modifierDown: false,
  pointerBusy: false,
  latchedUntil: 0,
  now: 1_000,
};
const at = (s: Partial<TriggerState>) => decideTrigger({ ...cold, ...s }, D);

describe('decideTrigger', () => {
  it('opens nothing on a cold hover, but says the modifier would', () => {
    expect(at({})).toEqual({ open: false, armable: true });
  });

  it('opens fast while the modifier is down', () => {
    expect(at({ modifierDown: true })).toEqual({ open: true, delay: 90 });
  });

  it('drops the modifier requirement while a card is showing', () => {
    expect(at({ chainOpen: true })).toEqual({ open: true, delay: 380 });
  });

  it('keeps plain hover alive inside the latch grace, and not past it', () => {
    expect(at({ latchedUntil: 1_500 })).toEqual({ open: true, delay: 380 });
    expect(at({ latchedUntil: 1_000 })).toEqual({ open: false, armable: true });
    expect(at({ latchedUntil: 900 })).toEqual({ open: false, armable: true });
  });

  it('never gates a term inside a card, whatever the modifier and latch say', () => {
    expect(at({ insideCard: true })).toEqual({ open: true, delay: 180 });
    expect(at({ insideCard: true, modifierDown: true })).toEqual({ open: true, delay: 180 });
    expect(at({ insideCard: true, chainOpen: true, latchedUntil: 1_500 })).toEqual({ open: true, delay: 180 });
  });

  it('treats help mode as plain hover everywhere', () => {
    expect(at({ helpMode: true })).toEqual({ open: true, delay: 380 });
    expect(at({ helpMode: true, modifierDown: true })).toEqual({ open: true, delay: 380 });
  });

  it('refuses to open — or to arm — while a mouse button is down', () => {
    // Holding the modifier through a chart pan must not flash a card.
    expect(at({ pointerBusy: true })).toEqual({ open: false, armable: false });
    expect(at({ pointerBusy: true, modifierDown: true })).toEqual({ open: false, armable: false });
    expect(at({ pointerBusy: true, chainOpen: true })).toEqual({ open: false, armable: false });
    expect(at({ pointerBusy: true, insideCard: true })).toEqual({ open: false, armable: false });
  });
});
