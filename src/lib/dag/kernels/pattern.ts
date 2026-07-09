// dag/kernels/pattern.ts — pattern node-family kernels (SAD-002#5.1, #8.5).
//
// Boolean multi-bar structure detectors over raw + indicator inputs (SAD-002#6.2,
// ADR-005 / SAD-002#8.5). This module owns the pattern lane of the FEAT-014
// fan-out; STORY-044 fills it. Kernels here stay pure and dependency-free
// (SAD-002#5.1) — they import ONLY the `Kernel`/`Kernels`/`Series` types from the
// evaluator, never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
//
// The pattern math below is a from-scratch reimplementation of `evalPatternAt`
// (SAD-001#3.7) computed over the input SERIES, not an import of it: the lowering
// (dag/pattern.ts) feeds a `pattern` node the raw OHLC series it needs (plus RSI(14)
// for the divergence detectors) as inputs, and the pattern name + `n` as params, so
// the kernel is a pure function of `(inputs, params)`. Each detector reproduces the
// engine's truth value BAR-FOR-BAR, including the multi-bar and `n`-parameterised
// forms (SAD-002#3.6, #2.1). Boolean output is encoded in the numeric `Series` as
// `1` = true / `0` = false, matching the relational family — a boolean series holds
// no nulls; a warm-up bar (`i < n`) is `0` (false), exactly as `evalPatternAt`.
import type { Kernel, Kernels, Series } from '../eval.ts';

// Input positions the lowering (dag/pattern.ts) wires, in a fixed order. Raw OHLC
// occupy 0..3; the divergence detectors additionally receive RSI(14) at position 4.
const O = 0, H = 1, L = 2, C = 3, R = 4;

/** Read a series as a dense number array; a null bar becomes `NaN` (all comparisons
 * against it are false), matching how `evalPatternAt` reads raw OHLC (never null). */
function toNums(s: Series | undefined): number[] {
  const src = s ?? [];
  const out = new Array<number>(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    out[i] = v == null ? NaN : v;
  }
  return out;
}

/**
 * The `pattern` kernel: compute a boolean flag series for the detector named by
 * `params.pat` with lookback `params.n`. Reproduces `evalPatternAt` for every bar
 * `i` over the input OHLC (+ RSI) series. `n` mirrors the engine's fallback
 * `+(rule.n) || 3`. Pure: no I/O, no globals, no market.ts import.
 */
const patternKernel: Kernel = (inputs, params) => {
  const o = toNums(inputs[O]);
  const h = toNums(inputs[H]);
  const l = toNums(inputs[L]);
  const c = toNums(inputs[C]);
  const rsiSeries = inputs[R] !== undefined ? toNums(inputs[R]) : undefined;
  const pat = String(params.pat);
  const n = Number(params.n) || 3;
  const len = c.length;

  // Per-bar predicates, mirroring evalPatternAt's local `downBar`/`upBar` helpers.
  const downBar = (j: number): boolean => j > 0 && o[j] < o[j - 1] && c[j] < c[j - 1];
  const upBar = (j: number): boolean => j > 0 && o[j] > o[j - 1] && c[j] > c[j - 1];

  const at = (i: number): boolean => {
    switch (pat) {
      case 'consec_down':   { if (i < n) return false; for (let k = 0; k < n; k++) if (!downBar(i - k)) return false; return true; }
      case 'consec_up':     { if (i < n) return false; for (let k = 0; k < n; k++) if (!upBar(i - k)) return false; return true; }
      case 'lower_closes':  { if (i < n) return false; for (let k = 0; k < n; k++) if (!(c[i - k] < c[i - k - 1])) return false; return true; }
      case 'higher_closes': { if (i < n) return false; for (let k = 0; k < n; k++) if (!(c[i - k] > c[i - k - 1])) return false; return true; }
      case 'higher_hl':     { if (i < n) return false; for (let k = 0; k < n; k++) { const j = i - k; if (!(h[j] > h[j - 1] && l[j] > l[j - 1])) return false; } return true; }
      case 'lower_hl':      { if (i < n) return false; for (let k = 0; k < n; k++) { const j = i - k; if (!(h[j] < h[j - 1] && l[j] < l[j - 1])) return false; } return true; }
      case 'inside_bar':    return i > 0 && h[i] < h[i - 1] && l[i] > l[i - 1];
      case 'outside_bar':   return i > 0 && h[i] > h[i - 1] && l[i] < l[i - 1];
      case 'bull_engulf':   return i > 0 && c[i - 1] < o[i - 1] && c[i] > o[i] && c[i] >= o[i - 1] && o[i] <= c[i - 1];
      case 'bear_engulf':   return i > 0 && c[i - 1] > o[i - 1] && c[i] < o[i] && o[i] >= c[i - 1] && c[i] <= o[i - 1];
      case 'gap_up':        return i > 0 && o[i] > h[i - 1];
      case 'gap_down':      return i > 0 && o[i] < l[i - 1];
      case 'new_high':      { if (i < n) return false; let mx = -Infinity; for (let k = 1; k <= n; k++) mx = Math.max(mx, c[i - k]); return c[i] > mx; }
      case 'new_low':       { if (i < n) return false; let mn = Infinity; for (let k = 1; k <= n; k++) mn = Math.min(mn, c[i - k]); return c[i] < mn; }
      case 'bull_div': {
        if (i < n || !rsiSeries) return false;
        const half = Math.floor(n / 2);
        let rIdx = -1, rLow = Infinity; for (let j = i - half; j <= i; j++) { if (c[j] < rLow) { rLow = c[j]; rIdx = j; } }
        let eIdx = -1, eLow = Infinity; for (let j = i - n; j < i - half; j++) { if (c[j] < eLow) { eLow = c[j]; eIdx = j; } }
        if (rIdx < 0 || eIdx < 0) return false;
        return c[rIdx] < c[eIdx] && rsiSeries[rIdx] > rsiSeries[eIdx] && (i - rIdx) <= 2;
      }
      case 'bear_div': {
        if (i < n || !rsiSeries) return false;
        const half = Math.floor(n / 2);
        let rIdx = -1, rHi = -Infinity; for (let j = i - half; j <= i; j++) { if (c[j] > rHi) { rHi = c[j]; rIdx = j; } }
        let eIdx = -1, eHi = -Infinity; for (let j = i - n; j < i - half; j++) { if (c[j] > eHi) { eHi = c[j]; eIdx = j; } }
        if (rIdx < 0 || eIdx < 0) return false;
        return c[rIdx] > c[eIdx] && rsiSeries[rIdx] < rsiSeries[eIdx] && (i - rIdx) <= 2;
      }
      case 'doji':          { const rng = h[i] - l[i]; return rng > 0 && Math.abs(c[i] - o[i]) <= 0.1 * rng; }
      default:              return false;
    }
  };

  const out: (number | null)[] = new Array(len);
  for (let i = 0; i < len; i++) out[i] = at(i) ? 1 : 0;
  return out;
};

/** Pattern (boolean multi-bar detector) kernels — one kernel dispatched by `params.pat`. */
export const patternKernels: Kernels = { pattern: patternKernel };
