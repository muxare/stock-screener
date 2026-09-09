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
// The modifier is a hidden gesture, so two things make it findable: the ? in
// the TopBar toggles help mode, in which plain hover works everywhere for as
// long as it is lit, and a cold dwell whispers the gesture beside the pointer
// a few times a session.
//
// Pressing T pins the deepest hover card where it stands. Pinned cards are
// independent: draggable, closable, and still hoverable for their terms.
// Esc closes the hover chain if there is one, else the most recent pin.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HoverCard, PinnedCard } from './HelpCard';
import { clampToViewport, placeNear, type Rect } from './place';
import { decideTrigger, isModifierDown, SUMMON_LABEL, type TriggerDelays, type TriggerState } from './trigger';
import { HelpModeContext } from './helpMode';
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
/** a cold dwell this long has stopped travelling, so the gesture is worth a word */
const WHISPER_DELAY = 600;
/** and then take the word away, so a parked pointer is not nagged indefinitely */
const WHISPER_LINGER = 2600;
/** a hint, not a stored preference: it teaches a few times a session, then stops */
const WHISPER_LIMIT = 4;
const HOVER_Z = 10_000;

const DELAYS: TriggerDelays = { hover: HOVER_DELAY, nested: NESTED_DELAY, armed: ARMED_DELAY };

interface HoverEntry {
  id: number;
  topic: string;
  anchorEl: Element;
  anchorRect: Rect;
  /** the control the anchor sits in, so the card can be placed clear of it */
  hostRect: Rect | null;
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

/**
 * The control an anchor belongs to. Phase 3 moved the anchors onto the words
 * — the ⌕ in the search box, a tab's label, a term inside a card body — and
 * beside a word that small is usually inside the thing it names, so `placeNear`
 * is given the parent to keep clear of. A parent too wide to have a side of its
 * own is simply ignored there, which is why the plain parent is enough.
 */
function hostOf(el: Element): Rect | null {
  return el.parentElement ? rectOf(el.parentElement) : null;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [chain, setChain] = useState<HoverEntry[]>([]);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [helpMode, setHelpMode] = useState(false);
  /** where the whisper is showing, in viewport coords; null = not showing */
  const [whisper, setWhisper] = useState<{ x: number; y: number } | null>(null);
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
  const helpModeRef = useRef(helpMode);
  const whisperTimer = useRef<number | null>(null);
  /** this session's hint budget — a whisper is only useful until it is learnt */
  const whispersLeft = useRef(WHISPER_LIMIT);
  const pointerAt = useRef({ x: 0, y: 0 });

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
  useEffect(() => { helpModeRef.current = helpMode; }, [helpMode]);

  const clearWhisper = useCallback(() => {
    if (whisperTimer.current != null) window.clearTimeout(whisperTimer.current);
    whisperTimer.current = null;
    setWhisper(null);
  }, []);

  // Switching help mode on retires the hint it was teaching: plain hover works
  // now, so there is nothing left to ask for.
  const changeHelpMode = useCallback((on: boolean) => {
    setHelpMode(on);
    if (on) clearWhisper();
  }, [clearWhisper]);

  useEffect(() => {
    const clearTimer = () => {
      if (enterTimer.current != null) window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
      armedTimer.current = false;
    };
    const clearEnter = () => {
      clearTimer();
      clearWhisper();
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
        hostRect: hostOf(p.anchorEl),
      };
      setChain((c) => [...c.filter((e) => p.keepIds.has(e.id)), entry]);
      return entry;
    };

    /**
     * Say the gesture once, beside the pointer. No panel and no dismissal: it
     * goes on the modifier, on leaving the target, and on its own after a
     * moment — and the session only ever gets WHISPER_LIMIT of them.
     */
    const showWhisper = () => {
      whisperTimer.current = null;
      const p = pending.current;
      if (!p || !p.anchorEl.matches(':hover')) return;
      if (modifierDown.current || helpModeRef.current) return;
      whispersLeft.current--;
      setWhisper({ ...pointerAt.current });
      whisperTimer.current = window.setTimeout(() => {
        whisperTimer.current = null;
        setWhisper(null);
      }, WHISPER_LINGER);
    };

    /** Start the open timer for `p`, if the current state says it may open at all. */
    const arm = (p: Pending) => {
      const state: TriggerState = {
        insideCard: p.insideCard,
        chainOpen: chainRef.current.length > 0,
        helpMode: helpModeRef.current,
        modifierDown: modifierDown.current,
        pointerBusy: pointerBusy.current,
        latchedUntil: latchedUntil.current,
        now: Date.now(),
      };
      const d = decideTrigger(state, DELAYS);
      if (!d.open) {
        // Nothing opens — but if the modifier *would* have opened it, the
        // pointer has stopped on something it could be asking about, which is
        // the one moment the gesture is worth mentioning.
        if (d.armable && whispersLeft.current > 0) {
          whisperTimer.current = window.setTimeout(showWhisper, WHISPER_DELAY);
        }
        return;
      }
      // A card is on its way; the hint has served its purpose.
      clearWhisper();
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
        // The hint has been read. Taking it away is the acknowledgement.
        clearWhisper();
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

    /** Nothing but the pointer position, so the whisper lands where the eye is. */
    const onMove = (e: MouseEvent) => {
      pointerAt.current = { x: e.clientX, y: e.clientY };
    };

    const onOver = (e: MouseEvent) => {
      syncModifier(e);
      onMove(e);
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
        : placeNear(top.anchorRect, 330, 200, window.innerWidth, window.innerHeight, top.hostRect ?? undefined);
      setPinned((p) => [...p, { id: top.id, topic: top.topic, x: pos.x, y: pos.y, z: ++topZ.current }]);
      setChain((c) => c.filter((x) => x.id !== top.id));
    };

    const onKey = (e: KeyboardEvent) => {
      syncModifier(e);
      if (e.key === 'Escape') {
        if (chainRef.current.length || pending.current) { closeHover(); e.preventDefault(); return; }
        // Then the mode itself: Esc means "stop showing me documentation", and
        // that is the mode before it is the pinned cards, which were parked
        // deliberately and carry their own ✕.
        if (helpModeRef.current) { setHelpMode(false); e.preventDefault(); return; }
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
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', syncModifier);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mouseout', onLeaveWindow);
    window.addEventListener('resize', closeHover);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousemove', onMove);
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
  }, [clearWhisper]);

  const pinFromCard = (id: number) => {
    const entry = chainRef.current.find((e) => e.id === id);
    if (!entry) return;
    const el = document.querySelector(`[data-help-card="${id}"]`);
    const r = el?.getBoundingClientRect();
    const pos = r
      ? { x: r.left, y: r.top }
      : placeNear(entry.anchorRect, 330, 200, window.innerWidth, window.innerHeight, entry.hostRect ?? undefined);
    setPinned((p) => [...p, { id, topic: entry.topic, x: pos.x, y: pos.y, z: ++topZ.current }]);
    setChain((c) => c.filter((x) => x.id !== id));
  };

  const modeApi = useMemo(() => ({ helpMode, setHelpMode: changeHelpMode }), [helpMode, changeHelpMode]);
  // The chip is one short line that never wraps, so its own box is close
  // enough to keep it off the viewport edges.
  const whisperAt = whisper
    ? clampToViewport(whisper.x + 15, whisper.y + 17, 104, 18, window.innerWidth, window.innerHeight)
    : null;

  return (
    <HelpModeContext.Provider value={modeApi}>
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
              host={c.hostRect}
              z={HOVER_Z + depth}
              onPin={() => pinFromCard(c.id)}
            />
          ))}
          {whisperAt && (
            <div className="help-whisper" style={{ left: whisperAt.x, top: whisperAt.y }}>
              <b>{SUMMON_LABEL}</b> help
            </div>
          )}
        </div>,
        document.body,
      )}
    </HelpModeContext.Provider>
  );
}
