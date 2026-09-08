// screen/format.ts — how a screener cell is written out.
//
// One place per unit so the table, the (phase-2) filter chips and any future
// export agree: a missing number is always the em dash, never 0 or "NaN".

export const DASH = '—';

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Compact human label: 1.2M, 3.4B, etc. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}

export function fmtFixed(v: unknown, digits: number, suffix = ''): string {
  return isNum(v) ? v.toFixed(digits) + suffix : DASH;
}

/** A value already expressed in percent units (1.2 → "1.20%"). */
export function fmtPercent(v: unknown, digits = 2): string {
  return fmtFixed(v, digits, '%');
}

/** A fraction rendered as a percent (0.025 → "2.50%"). */
export function fmtRatio(v: unknown, digits = 2): string {
  return isNum(v) ? (v * 100).toFixed(digits) + '%' : DASH;
}
