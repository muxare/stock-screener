import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HELP_INDEX, KIND_LABEL, topicOf, type HelpKind } from './glossary';
import { parseBody, type Segment } from './link';
import { clampToViewport, placeNear, type Rect } from './place';

const KIND_COLOR: Record<HelpKind, string> = {
  indicator: '#8ec5ff',
  fan: '#7ee2b8',
  screen: '#c9d1d8',
  strategy: '#d9b3ff',
  step: '#c7a6ff',
  trade: '#ffc078',
  backtest: '#ffd28a',
  data: '#b0bec9',
  ui: '#9aa4ad',
};

function renderSegments(segments: Segment[]): ReactNode {
  return segments.map((s, i) => (s.kind === 'text'
    ? <span key={i}>{s.text}</span>
    : <span key={i} className="help-term" data-help={s.topic}>{s.text}</span>));
}

export function HelpBody({ topic }: { topic: string }) {
  const t = topicOf(topic);
  if (!t) return <p>No help for “{topic}” yet.</p>;
  const blocks = parseBody(t.body, HELP_INDEX, { self: t.id });
  return (
    <>
      {blocks.map((b, i) => (b.kind === 'p'
        ? <p key={i}>{renderSegments(b.segments)}</p>
        : (
          <ul key={i}>
            {b.items.map((item, k) => <li key={k}>{renderSegments(item)}</li>)}
          </ul>
        )))}
    </>
  );
}

function Related({ topic }: { topic: string }) {
  const t = topicOf(topic);
  const rel = (t?.related ?? []).filter((id) => topicOf(id));
  if (rel.length === 0) return null;
  return (
    <div className="help-card__related">
      {rel.map((id) => (
        <span key={id} className="help-card__chip" data-help={id}>{topicOf(id)!.title}</span>
      ))}
    </div>
  );
}

function Head({ topic, pinned, onPin, onClose, onDragStart }: {
  topic: string;
  pinned: boolean;
  onPin?: () => void;
  onClose?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
}) {
  const t = topicOf(topic);
  const kind = t?.kind ?? 'ui';
  return (
    <div className="help-card__head" onPointerDown={onDragStart}>
      <span className="help-card__kind" style={{ background: KIND_COLOR[kind] }}>{KIND_LABEL[kind]}</span>
      <span className="help-card__title">{t?.title ?? topic}</span>
      {!pinned && onPin && (
        <button type="button" className="help-card__btn" title="Pin this card (T)" onClick={onPin}>📌</button>
      )}
      {pinned && onClose && (
        <button type="button" className="help-card__btn" title="Close (Esc)" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>✕</button>
      )}
    </div>
  );
}

export function HoverCard({ id, topic, anchor, z, onPin }: {
  id: number;
  topic: string;
  anchor: Rect;
  z: number;
  onPin: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(placeNear(anchor, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [anchor, topic]);

  return (
    <div
      ref={ref}
      className={`help-card${pos ? '' : ' is-measuring'}`}
      data-help-card={id}
      role="tooltip"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, zIndex: z }}
    >
      <Head topic={topic} pinned={false} onPin={onPin} />
      <div className="help-card__body"><HelpBody topic={topic} /></div>
      <Related topic={topic} />
      <div className="help-card__foot">
        <span><kbd>T</kbd>pin</span>
        <span>hover a highlighted term for more</span>
      </div>
    </div>
  );
}

export function PinnedCard({ id, topic, x, y, z, onClose, onMove, onFocus }: {
  id: number;
  topic: string;
  x: number;
  y: number;
  z: number;
  onClose: () => void;
  onMove: (x: number, y: number) => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  function onDragStart(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onFocus();
  }
  function onDrag(e: React.PointerEvent) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const p = clampToViewport(e.clientX - d.dx, e.clientY - d.dy, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
    onMove(p.x, p.y);
  }
  function onDragEnd() {
    drag.current = null;
  }

  return (
    <div
      ref={ref}
      className="help-card is-pinned"
      data-help-card={id}
      data-help-pinned=""
      role="dialog"
      aria-label={topicOf(topic)?.title ?? topic}
      style={{ left: x, top: y, zIndex: z }}
      onPointerMove={onDrag}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onMouseDown={onFocus}
    >
      <Head topic={topic} pinned onClose={onClose} onDragStart={onDragStart} />
      <div className="help-card__body"><HelpBody topic={topic} /></div>
      <Related topic={topic} />
      <div className="help-card__foot">
        <span><kbd>Esc</kbd>close</span>
        <span>drag the title to move</span>
      </div>
    </div>
  );
}
