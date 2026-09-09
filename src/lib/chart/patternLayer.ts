// patternLayer.ts — draws detected price-action patterns over a price pane.
//
// Takes the markers from lib/patterns.ts plus the pane's bar→x / price→y
// mappings and paints them behind nothing and in front of the candles. Glyph
// vocabulary, so a chart reads at a glance:
//
//   pivot        ▲ / ▼ at the swing extreme — big = 3-bar, small dot = 1-bar
//   structure    HH / HL / LH / LL text at the long pivots, joined by a zigzag
//   pullback     tinted band over the counter-trend run
//   spans        a bracket around the bars a formation covers, plus a chip
//   failedBreak  the broken level as a dashed line across the attempt
//
// Labels are stacked so they never overlap: each chip takes the first free row
// above (or below) the price it belongs to. Below a few pixels per bar the
// chips are dropped and only the glyphs remain — the chart stays readable when
// it is zoomed all the way out.

import type { Box } from './interactions.ts';
import type { OHLC } from '../market.ts';
import type { PatternDir, PatternMarker } from '../patterns.ts';

export interface PatternLayerArgs {
  ctx: CanvasRenderingContext2D;
  bars: OHLC;
  markers: readonly PatternMarker[];
  from: number;
  to: number;
  /** bar index → x centre, as the price pane lays it out */
  x: (i: number) => number;
  /** price → y, as the price pane lays it out */
  py: (v: number) => number;
  /** candle body width in px */
  cw: number;
  top: number;
  height: number;
}

/**
 * A chip as it was actually drawn. The layer places these anyway — the
 * placer's whole job is finding free pixels for them — so handing them back
 * costs nothing and gives the chart the hit-test it needs to turn a glyph into
 * a help target. Chips that found no free row are not in the list, because
 * there is nothing on screen to point at.
 */
export interface PatternChip extends Box {
  marker: PatternMarker;
}

interface Tone { line: string; fill: string; text: string; chip: string }

const TONE: Record<PatternDir, Tone> = {
  bull: { line: '#06a96b', fill: 'rgba(6,169,107,0.10)', text: '#06865a', chip: 'rgba(6,169,107,0.12)' },
  bear: { line: '#e23d3d', fill: 'rgba(226,61,61,0.10)', text: '#c22f2f', chip: 'rgba(226,61,61,0.12)' },
  neutral: { line: '#8b93a1', fill: 'rgba(139,147,161,0.10)', text: '#5f6873', chip: 'rgba(139,147,161,0.14)' },
};

const FONT = "9.5px 'Helvetica Neue', Helvetica, Arial, sans-serif";
const ROW = 12;
/** below this many px per bar the chart is too dense for text */
const MIN_SLOT_FOR_LABELS = 5;

/** how many rows a chip may be pushed away from its bar before it is dropped */
const MAX_LABEL_ROWS = 8;

/**
 * Places chips so none of them overprints another: a chip starts at the price
 * it belongs to and is pushed away, a row at a time, until it lands on free
 * pixels. When nothing is free it is dropped rather than drawn on top of a
 * neighbour — the glyph still marks the bar, only its text goes.
 */
function labelPlacer(top: number, bottom: number) {
  const placed: Array<[number, number, number, number]> = [];
  return (cx: number, w: number, baseY: number, dir: -1 | 1): number | null => {
    const x1 = cx - w / 2 - 2, x2 = cx + w / 2 + 2;
    for (let step = 0; step < MAX_LABEL_ROWS; step++) {
      const y = baseY + dir * step * ROW;
      if (y < top + 7 || y > bottom - 7) break;
      const y1 = y - 7, y2 = y + 7;
      if (!placed.some(([a, b, c, d]) => !(x2 < a || x1 > c || y2 < b || y1 > d))) {
        placed.push([x1, y1, x2, y2]);
        return y;
      }
    }
    return null;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function triangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, up: boolean) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + (up ? -size : size));
  ctx.lineTo(cx - size * 0.85, cy + (up ? size * 0.7 : -size * 0.7));
  ctx.lineTo(cx + size * 0.85, cy + (up ? size * 0.7 : -size * 0.7));
  ctx.closePath();
  ctx.fill();
}

/** high/low over an inclusive bar span, clamped to the series. */
function spanExtent(bars: OHLC, from: number, to: number): { hi: number; lo: number } {
  let hi = -Infinity, lo = Infinity;
  const a = Math.max(0, from), b = Math.min(bars.h.length - 1, to);
  for (let i = a; i <= b; i++) {
    if (bars.h[i] > hi) hi = bars.h[i];
    if (bars.l[i] < lo) lo = bars.l[i];
  }
  return { hi, lo };
}

/** Patterns drawn as a bracket around the bars they cover. */
const SPAN_IDS = new Set(['reversal2', 'reversal3', 'engulfing', 'insideBar', 'outsideBar']);

/**
 * Who gets the pixels when chips compete for the same spot. Structure first —
 * the HH/HL sequence is the one reading you want kept when a chart is busy —
 * then the turns, then the shapes. Unranked ids sort last.
 */
const CHIP_RANK: Partial<Record<string, number>> = {
  structure: 0,
  reversal2: 1,
  reversal3: 1,
  failedBreak: 2,
  pullback: 3,
  pinBar: 4,
  engulfing: 5,
  doji: 6,
  insideBar: 7,
  outsideBar: 7,
};

export function drawPatternLayer({
  ctx, bars, markers, from, to, x, py, cw, top, height,
}: PatternLayerArgs): PatternChip[] {
  if (markers.length === 0) return [];
  const visible = markers.filter((m) => m.to >= from && m.from <= to);
  if (visible.length === 0) return [];

  const slot = cw / 0.62;
  const withLabels = slot >= MIN_SLOT_FOR_LABELS;
  const bottom = top + height;
  const place = labelPlacer(top, bottom);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x(from) - slot, top, (to - from + 2) * slot, height);
  ctx.clip();
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  // Chips are collected as the shapes are drawn and laid out at the end, so the
  // placer can hand the good spots to the patterns that matter most rather than
  // to whichever shape happened to be painted first.
  const chips: Array<{ m: PatternMarker; cx: number; baseY: number; text: string; tone: Tone; dir: -1 | 1; rank: number }> = [];
  const chip = (m: PatternMarker, cx: number, baseY: number, dir: -1 | 1) => {
    if (!withLabels || !m.tag) return;
    chips.push({ m, cx, baseY, text: m.tag, tone: TONE[m.dir], dir, rank: CHIP_RANK[m.id] ?? 99 });
  };

  // ---- pullback bands (behind everything else) ----
  for (const m of visible) {
    if (m.id !== 'pullback') continue;
    const tone = TONE[m.dir];
    const { hi, lo } = spanExtent(bars, m.from, m.to);
    const x1 = x(m.from) - cw / 2 - 1, x2 = x(m.to) + cw / 2 + 1;
    const yTop = py(hi), yBot = py(lo);
    ctx.fillStyle = tone.fill;
    ctx.fillRect(x1, yTop, x2 - x1, yBot - yTop);
    ctx.strokeStyle = tone.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    if (m.dir === 'bull') { ctx.moveTo(x1, yTop); ctx.lineTo(x2, yBot); }
    else { ctx.moveTo(x1, yBot); ctx.lineTo(x2, yTop); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    chip(m, (x1 + x2) / 2, m.dir === 'bull' ? yBot + 12 : yTop - 12, m.dir === 'bull' ? 1 : -1);
  }

  // ---- failed breakouts: the level that gave way, then didn't ----
  for (const m of visible) {
    if (m.id !== 'failedBreak') continue;
    const tone = TONE[m.dir];
    const y = py(m.price);
    const x1 = x(Math.max(from, m.from - 3)) - cw / 2;
    const x2 = x(Math.min(to, m.to + 3)) + cw / 2;
    ctx.strokeStyle = tone.line;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.setLineDash([]);
    const { hi, lo } = spanExtent(bars, m.from, m.to);
    ctx.fillStyle = tone.fill;
    const bx = x(m.from) - cw / 2 - 1;
    ctx.fillRect(bx, py(hi), x(m.to) + cw / 2 + 1 - bx, py(lo) - py(hi));
    chip(m, x(m.index), m.dir === 'bear' ? py(hi) - 12 : py(lo) + 12, m.dir === 'bear' ? -1 : 1);
  }

  // ---- span brackets: the 1–3 bar formations ----
  for (const m of visible) {
    if (!SPAN_IDS.has(m.id)) continue;
    const tone = TONE[m.dir];
    const { hi, lo } = spanExtent(bars, m.from, m.to);
    const x1 = x(m.from) - cw / 2 - 2, x2 = x(m.to) + cw / 2 + 2;
    const y1 = py(hi) - 2, y2 = py(lo) + 2;
    ctx.strokeStyle = tone.line;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    roundRect(ctx, x1, y1, Math.max(3, x2 - x1), Math.max(3, y2 - y1), 3);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const up = m.dir !== 'bear';
    chip(m, (x1 + x2) / 2, up ? y2 + 11 : y1 - 11, up ? 1 : -1);
  }

  // ---- swing structure: the zigzag through the long pivots ----
  const struct = visible.filter((m) => m.id === 'structure');
  if (struct.length > 1) {
    ctx.strokeStyle = 'rgba(107,114,128,0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    struct.forEach((m, i) => {
      const px = x(m.index), pyy = py(m.price);
      if (i === 0) ctx.moveTo(px, pyy); else ctx.lineTo(px, pyy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- pivots ----
  for (const m of visible) {
    if (m.id !== 'pivot') continue;
    const long = (m.strength ?? 1) > 1;
    const tone = TONE[m.dir];
    const cx = x(m.index);
    const high = m.dir === 'bear';
    const y = py(m.price) + (high ? -5 : 5);
    ctx.fillStyle = long ? tone.line : 'rgba(139,147,161,0.75)';
    if (long) triangle(ctx, cx, y, 5, !high);
    else { ctx.beginPath(); ctx.arc(cx, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
  }

  // ---- structure labels, pin bars and dojis ----
  for (const m of visible) {
    if (m.id === 'structure') {
      const high = m.tag === 'HH' || m.tag === 'LH';
      chip(m, x(m.index), py(m.price) + (high ? -16 : 16), high ? -1 : 1);
      continue;
    }
    if (m.id === 'pinBar' || m.id === 'doji') {
      const tone = TONE[m.dir];
      const cx = x(m.index);
      const bull = m.dir === 'bull';
      const y = py(m.price) + (bull ? 6 : -6);
      ctx.fillStyle = tone.line;
      if (m.id === 'pinBar') triangle(ctx, cx, y, 4.5, bull);
      else {
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(cx, y - 3.5); ctx.lineTo(cx + 3.5, y); ctx.lineTo(cx, y + 3.5); ctx.lineTo(cx - 3.5, y);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      chip(m, cx, y + (bull ? 11 : -11), bull ? 1 : -1);
    }
  }

  // ---- the labels, best-ranked first ----
  chips.sort((a, b) => a.rank - b.rank);
  ctx.font = FONT;
  ctx.textAlign = 'center';
  const drawn: PatternChip[] = [];
  for (const c of chips) {
    const w = ctx.measureText(c.text).width + 8;
    const y = place(c.cx, w, c.baseY, c.dir);
    if (y === null) continue;
    ctx.fillStyle = c.tone.chip;
    roundRect(ctx, c.cx - w / 2, y - 6.5, w, 13, 3.5);
    ctx.fill();
    ctx.fillStyle = c.tone.text;
    ctx.fillText(c.text, c.cx, y + 0.5);
    drawn.push({ marker: c.m, left: c.cx - w / 2, top: y - 6.5, right: c.cx + w / 2, bottom: y + 6.5 });
  }

  ctx.restore();
  return drawn;
}
