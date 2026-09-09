// help/HelpProvider.tsx — the hover / pin documentation layer.
//
// Any element with data-help="<topic-id>" is a hover target. The provider
// listens once at the document level, so the rest of the app only adds
// attributes. Holding the summon modifier (trigger.ts) and pointing at a
// target opens its card next to it; terms inside a card are targets too, so
// hovering one opens a child card on top. The open, unpinned cards form a
// chain: leaving a card (and the target it came from) closes it and everything
// after it.
//
// The modifier is only for the first card. While a card is showing — and for
// LATCH_GRACE after the last one closes on its own — plain hover works as it
// always did, because by then you are already reading documentation. An
// explicit dismissal (Esc, a click outside, a scroll, a resize) ends that grace
// at once: it means "stop showing me cards".
//
// Pressing T pins the deepest hover card where it stands. Pinned cards are
// independent: draggable, closable, and still hoverable for their terms.
// Esc closes the hover chain if there is one, else the most recent pin.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HoverCard, PinnedCard } from './HelpCard';
import { placeNear, type Rect } from './place';
import { decideTrigger, isModifierDown, type TriggerDelays, type TriggerState } from './trigger';
import { topicOf } from './glossary';
import './help.css';

const PIN_KEY = 't';
const HOVER_DELAY = 380;
const NESTED_DELAY = 180;
/** an explicit request needs no suspicion delay, only enough to not strobe */
const ARMED_DELAY = 90;
const LEAVE_GRACE = 170;
/** how long plain hover keeps working after the last card closes on its own */
const LATCH_GRACE = 800;
const HOVER_Z = 10_000;

const DELAYS: TriggerDelays = { hover: HOVER_DELAY, nested: NESTED_DELAY, armed: ARMED_DELAY };

interface HoverEntry {
  id: number;
  topic: string;
  anchorEl: Element;
  anchorRect: Rect;
}

interface Pinned {
  id: number;
  topic: string;
  x: number;
  y: number;
  z: number;
}

interface Pending {
  anchorEl: Element;
  topic: string;
  keepIds: Set<number>;
  /** the target is a term inside an open card, so it is never gated */
  insideCard: boolean;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [chain, setChain] = useState<HoverEntry[]>([]);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const chainRef = useRef(chain);
  const pinnedRef = useRef(pinned);
  const nextId = useRef(1);
  const topZ = useRef(1);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const pending = useRef<Pending | null>(null);
  const modifierDown = useRef(false);
  const pointerBusy = useRef(false);
  /** true while the running enter timer exists only because the modifier is down */
  const armedTimer = useRef(false);
  const latchedUntil = useRef(0);

  // The latch, kept here rather than in the listener so it follows the chain
  // itself: open while any hover card is up, then a grace once the last one
  // goes. Pinned cards deliberately do not hold it — a pin is a parked
  // reference, not an active reading session.
  useEffect(() => {
    chainRef.current = chain;
    if (chain.length) latchedUntil.current = Infinity;
    else if (latchedUntil.current === Infinity) latchedUntil.current = Date.now() + LATCH_GRACE;
  }, [chain]);
  useEffect(() => { pinnedRef.current = pinned; }, [pinned]);

  useEffect(() => {
    const clearTimer = () => {
      if (enterTimer.current != null) window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
      armedTimer.current = false;
    };
    const clearEnter = () => {
      clearTimer();
      pending.current = null;
    };
    const clearLeave = () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    };
    const closeHover = () => {
      clearEnter();
      clearLeave();
      // An explicit dismissal ends the grace too, or the next hover would
      // reopen exactly what was just waved away.
      latchedUntil.current = 0;
      if (chainRef.current.length) setChain([]);
    };

    /** Open the pending target's card as the next link of the kept chain. */
    const open = (p: Pending) => {
      const entry: HoverEntry = {
        id: nextId.current++,
        topic: p.topic,
        anchorEl: p.anchorEl,
        anchorRect: rectOf(p.anchorEl),
      };
      setChain((c) => [...c.filter((e) => p.keepIds.has(e.id)), entry]);
      return entry;
    };

    /** Start the open timer for `p`, if the current state says it may open at all. */
    const arm = (p: Pending) => {
      const state: TriggerState = {
        insideCard: p.insideCard,
        chainOpen: chainRef.current.length > 0,
        helpMode: false,
        modifierDown: modifierDown.current,
        pointerBusy: pointerBusy.current,
        latchedUntil: latchedUntil.current,
        now: Date.now(),
      };
      const d = decideTrigger(state, DELAYS);
      if (!d.open) return;
      // Whether the modifier alone is holding this timer up, so releasing it
      // cancels a card that has not appeared yet without touching one that has.
      armedTimer.current = !decideTrigger({ ...state, modifierDown: false }, DELAYS).open;
      enterTimer.current = window.setTimeout(() => {
        enterTimer.current = null;
        armedTimer.current = false;
        pending.current = null;
        if (p.anchorEl.matches(':hover')) open(p);
      }, d.delay);
    };

    /**
     * Follow the modifier from whatever event carries it — keydown, keyup, and
     * mouse events too, which is what recovers the state when the key went down
     * before the window had focus.
     */
    const syncModifier = (e: KeyboardEvent | MouseEvent) => {
      const down = isModifierDown(e);
      if (down === modifierDown.current) return;
      modifierDown.current = down;
      if (down) {
        // The pointer is usually already parked on the thing before the hand
        // reaches for the key, so arm what is already pending.
        const p = pending.current;
        if (p && enterTimer.current == null && p.anchorEl.matches(':hover')) arm(p);
      } else if (armedTimer.current) {
        // Released before the card appeared. An open card is never closed by
        // this: moving the pointer into a card must not destroy it.
        clearTimer();
      }
    };

    const onOver = (e: MouseEvent) => {
      syncModifier(e);
      // `buttons` is authoritative on every move, so a mouseup missed outside
      // the window cannot leave the layer wedged shut.
      pointerBusy.current = e.buttons !== 0;
      const t = e.target;
      if (!(t instanceof Element)) return;
      const cardEl = t.closest('[data-help-card]');
      const cardId = cardEl ? Number(cardEl.getAttribute('data-help-card')) : null;
      const anchorEl = t.closest('[data-help]');
      const topic = anchorEl?.getAttribute('data-help') ?? null;

      // Keep the chain up to the card the mouse is in, or the card whose
      // anchor the mouse is on; everything deeper is on its way out.
      const chain = chainRef.current;
      let keep = -1;
      for (let k = chain.length - 1; k >= 0; k--) {
        if (chain[k].id === cardId || chain[k].anchorEl.contains(t)) { keep = k; break; }
      }
      const kept = chain.slice(0, keep + 1);
      const keepIds = new Set(kept.map((c) => c.id));

      clearLeave();
      if (kept.length !== chain.length) {
        // Grace so the pointer can cross the gap between a term and its card.
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          setChain((c) => c.filter((x) => keepIds.has(x.id)));
        }, LEAVE_GRACE);
      }

      const last = kept[kept.length - 1];
      const same = last != null && last.anchorEl === anchorEl;
      if (pending.current && pending.current.anchorEl === anchorEl && !same) return;
      clearEnter();
      if (!anchorEl || !topic || same || !topicOf(topic)) return;
      // The pending target is recorded even when nothing opens: it is what the
      // modifier — or T — summons without the pointer having to move again.
      const p: Pending = { anchorEl, topic, keepIds, insideCard: cardId != null };
      pending.current = p;
      arm(p);
    };

    const pinTop = () => {
      const chain = chainRef.current;
      let entry: HoverEntry | undefined = chain[chain.length - 1];
      if (!entry && pending.current) {
        // Pressed before the delay elapsed: open and pin in one go.
        const p = pending.current;
        clearEnter();
        entry = open(p);
      }
      if (!entry) return;
      const top = entry;
      const el = document.querySelector(`[data-help-card="${top.id}"]`);
      const r = el?.getBoundingClientRect();
      const pos = r
        ? { x: r.left, y: r.top }
        : placeNear(top.anchorRect, 330, 200, window.innerWidth, window.innerHeight);
      setPinned((p) => [...p, { id: top.id, topic: top.topic, x: pos.x, y: pos.y, z: ++topZ.current }]);
      setChain((c) => c.filter((x) => x.id !== top.id));
    };

    const onKey = (e: KeyboardEvent) => {
      syncModifier(e);
      if (e.key === 'Escape') {
        if (chainRef.current.length || pending.current) { closeHover(); e.preventDefault(); return; }
        if (pinnedRef.current.length) {
          setPinned((p) => p.slice(0, -1));
          e.preventDefault();
        }
        return;
      }
      if (e.key.toLowerCase() !== PIN_KEY || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (isEditable(e.target)) return;
      if (!chainRef.current.length && !pending.current) return;
      e.preventDefault();
      pinTop();
    };

    const onDown = (e: MouseEvent) => {
      pointerBusy.current = true;
      syncModifier(e);
      clearEnter();
      const t = e.target;
      if (t instanceof Element && t.closest('[data-help-card]')) return;
      closeHover();
    };
    const onUp = (e: MouseEvent) => {
      pointerBusy.current = false;
      syncModifier(e);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-help-card]')) return;
      closeHover();
    };
    const onLeaveWindow = (e: MouseEvent) => {
      if (e.relatedTarget == null) closeHover();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', syncModifier);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mouseout', onLeaveWindow);
    window.addEventListener('resize', closeHover);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', syncModifier);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mouseout', onLeaveWindow);
      window.removeEventListener('resize', closeHover);
      clearEnter();
      clearLeave();
    };
  }, []);

  const pinFromCard = (id: number) => {
    const entry = chainRef.current.find((e) => e.id === id);
    if (!entry) return;
    const el = document.querySelector(`[data-help-card="${id}"]`);
    const r = el?.getBoundingClientRect();
    const pos = r ? { x: r.left, y: r.top } : placeNear(entry.anchorRect, 330, 200, window.innerWidth, window.innerHeight);
    setPinned((p) => [...p, { id, topic: entry.topic, x: pos.x, y: pos.y, z: ++topZ.current }]);
    setChain((c) => c.filter((x) => x.id !== id));
  };

  return (
    <>
      {children}
      {createPortal(
        <div className="help-layer">
          {pinned.map((p) => (
            <PinnedCard
              key={p.id}
              id={p.id}
              topic={p.topic}
              x={p.x}
              y={p.y}
              z={p.z}
              onClose={() => setPinned((all) => all.filter((x) => x.id !== p.id))}
              onMove={(x, y) => setPinned((all) => all.map((c) => (c.id === p.id ? { ...c, x, y } : c)))}
              onFocus={() => {
                if (p.z === topZ.current) return;
                const z = ++topZ.current;
                setPinned((all) => all.map((c) => (c.id === p.id ? { ...c, z } : c)));
              }}
            />
          ))}
          {chain.map((c, depth) => (
            <HoverCard
              key={c.id}
              id={c.id}
              topic={c.topic}
              anchor={c.anchorRect}
              z={HOVER_Z + depth}
              onPin={() => pinFromCard(c.id)}
            />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
