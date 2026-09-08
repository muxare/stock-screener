// help/HelpProvider.tsx — the hover / pin documentation layer.
//
// Any element with data-help="<topic-id>" is a hover target. The provider
// listens once at the document level, so the rest of the app only adds
// attributes. Hovering a target for a moment opens its card next to it;
// terms inside a card are targets too, so hovering one opens a child card on
// top. The open, unpinned cards form a chain: leaving a card (and the target
// it came from) closes it and everything after it.
//
// Pressing T pins the deepest hover card where it stands. Pinned cards are
// independent: draggable, closable, and still hoverable for their terms.
// Esc closes the hover chain if there is one, else the most recent pin.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HoverCard, PinnedCard } from './HelpCard';
import { placeNear, type Rect } from './place';
import { topicOf } from './glossary';
import './help.css';

const PIN_KEY = 't';
const HOVER_DELAY = 380;
const NESTED_DELAY = 180;
const LEAVE_GRACE = 170;
const HOVER_Z = 10_000;

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

  useEffect(() => { chainRef.current = chain; }, [chain]);
  useEffect(() => { pinnedRef.current = pinned; }, [pinned]);

  useEffect(() => {
    const clearEnter = () => {
      if (enterTimer.current != null) window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
      pending.current = null;
    };
    const clearLeave = () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    };
    const closeHover = () => {
      clearEnter();
      clearLeave();
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

    const onOver = (e: MouseEvent) => {
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
      const p: Pending = { anchorEl, topic, keepIds };
      pending.current = p;
      enterTimer.current = window.setTimeout(() => {
        enterTimer.current = null;
        pending.current = null;
        if (anchorEl.matches(':hover')) open(p);
      }, cardId != null ? NESTED_DELAY : HOVER_DELAY);
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
      const t = e.target;
      if (t instanceof Element && t.closest('[data-help-card]')) return;
      closeHover();
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
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mouseout', onLeaveWindow);
    window.addEventListener('resize', closeHover);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
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
