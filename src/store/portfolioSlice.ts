// store/portfolioSlice.ts — the portfolio screenshot reader's state.
//
// The shape of this slice follows from the one rule stage 3 of
// `docs/platform-hardening-plan.md` refuses to bend: **what Claude read is a
// proposal, and only what the user confirmed is a fact.** So there are two
// pieces of state, not one. `rows` is the proposal — editable, droppable, and
// discarded when the modal closes — and `portfolio` is the confirmed holding
// list, which nothing but `confirmHoldings` may write and which is the only
// piece that reaches localStorage.
//
// Kept out of store.ts, like screenSlice, so that file stays the screener's own
// data and async layer.

import type {
  ExtractedHolding,
  HoldingConfidence,
  MarketClient,
  ScreenshotUpload,
} from '../lib/client/marketClient.ts';
import {
  clearPortfolio as clearStoredPortfolio,
  loadPortfolio,
  savePortfolio,
  type ConfirmedHolding,
  type Portfolio,
  type PortfolioStorage,
} from '../lib/portfolio/holdings.ts';

/** A proposed row, plus whether the user is keeping it. */
export interface EditableHolding extends ExtractedHolding {
  include: boolean;
}

/** Low confidence first: the rows most worth a second look are the ones on top. */
const CONFIDENCE_RANK: Record<HoldingConfidence, number> = { low: 0, medium: 1, high: 2 };

export interface PortfolioSlice {
  portfolio: PortfolioState;
  /** Ask the service whether the reader is configured. Called once, at start-up. */
  probePortfolio: () => Promise<void>;
  openPortfolio: () => void;
  closePortfolio: () => void;
  /** Stage an image; `dataUrl` is what the FileReader produced. */
  setScreenshot: (dataUrl: string | null) => void;
  extractHoldings: () => Promise<void>;
  editHolding: (index: number, patch: Partial<EditableHolding>) => void;
  /** Keep or drop one proposed row. A dropped row is not stored. */
  toggleHolding: (index: number) => void;
  /** Accept the kept rows as the portfolio. The only writer of `confirmed`. */
  confirmHoldings: () => void;
  forgetPortfolio: () => void;
}

export interface PortfolioState {
  /** The service reports an ANTHROPIC_API_KEY. False hides the feature. */
  available: boolean;
  open: boolean;
  /** The staged screenshot as a data URL, shown beside the rows it produced. */
  imageDataUrl: string | null;
  extracting: boolean;
  error: string | null;
  /** 1 or 2 — shown because a silent retry is worth seeing. */
  attempts: number;
  /** Meaning checks the service could not get resolved. */
  problems: string[];
  /** What Claude said about the image as a whole. */
  warnings: string[];
  accountLabel: string | null;
  /** The proposal. Empty until an extraction lands; cleared on close. */
  rows: EditableHolding[];
  /** The confirmed portfolio, loaded from localStorage at start-up. */
  confirmed: Portfolio | null;
}

export const EMPTY_PORTFOLIO: PortfolioState = {
  available: false,
  open: false,
  imageDataUrl: null,
  extracting: false,
  error: null,
  attempts: 0,
  problems: [],
  warnings: [],
  accountLabel: null,
  rows: [],
  confirmed: null,
};

/** Splits `data:image/png;base64,AAAA` into what the service's route accepts. */
export function parseDataUrl(dataUrl: string): ScreenshotUpload | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), dataBase64: match[2] };
}

function toEditable(rows: ExtractedHolding[]): EditableHolding[] {
  return rows
    .map((row) => ({ ...row, include: true }))
    .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
}

function toConfirmed(row: EditableHolding): ConfirmedHolding {
  return {
    ticker: row.ticker ? row.ticker.trim().toUpperCase() : null,
    name: row.name,
    shares: row.shares,
    averagePrice: row.averagePrice,
    currency: row.currency,
  };
}

type SliceSet = (partial: { portfolio: PortfolioState }) => void;
type SliceGet = () => { portfolio: PortfolioState };

export function createPortfolioSlice(
  set: SliceSet,
  get: SliceGet,
  client: MarketClient,
  storage: PortfolioStorage | null,
): PortfolioSlice {
  const patch = (next: Partial<PortfolioState>) => set({ portfolio: { ...get().portfolio, ...next } });

  return {
    portfolio: { ...EMPTY_PORTFOLIO, confirmed: loadPortfolio(storage) },

    probePortfolio: async () => {
      const status = await client.portfolioStatus();
      patch({ available: status?.available === true });
    },

    openPortfolio: () => patch({ open: true, error: null }),

    // Closing throws the proposal away deliberately. A half-reviewed table kept
    // across an accidental close is a table someone confirms without re-reading.
    closePortfolio: () =>
      patch({
        open: false,
        imageDataUrl: null,
        rows: [],
        problems: [],
        warnings: [],
        accountLabel: null,
        attempts: 0,
        error: null,
      }),

    setScreenshot: (dataUrl) => patch({ imageDataUrl: dataUrl, error: null, rows: [], problems: [], warnings: [], attempts: 0 }),

    extractHoldings: async () => {
      const { imageDataUrl } = get().portfolio;
      if (!imageDataUrl) return;
      const image = parseDataUrl(imageDataUrl);
      if (!image) {
        patch({ error: 'that does not look like an image the browser could read' });
        return;
      }
      patch({ extracting: true, error: null });
      try {
        const result = await client.extractPortfolio(image);
        patch({
          extracting: false,
          rows: toEditable(result.extraction.holdings),
          accountLabel: result.extraction.accountLabel,
          warnings: result.extraction.warnings,
          problems: result.problems,
          attempts: result.attempts,
        });
      } catch (err) {
        patch({ extracting: false, error: err instanceof Error ? err.message : 'extraction failed' });
      }
    },

    editHolding: (index, rowPatch) => {
      const rows = get().portfolio.rows.map((row, i) => (i === index ? { ...row, ...rowPatch } : row));
      patch({ rows });
    },

    toggleHolding: (index) => {
      const rows = get().portfolio.rows.map((row, i) => (i === index ? { ...row, include: !row.include } : row));
      patch({ rows });
    },

    confirmHoldings: () => {
      const state = get().portfolio;
      const kept = state.rows.filter((row) => row.include).map(toConfirmed);
      if (kept.length === 0) {
        patch({ error: 'nothing to confirm — every row is unticked' });
        return;
      }
      const confirmed: Portfolio = {
        accountLabel: state.accountLabel,
        holdings: kept,
        confirmedAt: new Date().toISOString(),
      };
      savePortfolio(storage, confirmed);
      set({
        portfolio: {
          ...state,
          confirmed,
          open: false,
          imageDataUrl: null,
          rows: [],
          problems: [],
          warnings: [],
          attempts: 0,
          error: null,
        },
      });
    },

    forgetPortfolio: () => {
      clearStoredPortfolio(storage);
      patch({ confirmed: null });
    },
  };
}
