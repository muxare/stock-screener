// portfolio/holdings.ts — the confirmed portfolio in localStorage.
//
// Same shape as screen/storage.ts and strategy/storage.ts, and for the same
// reasons: storage is injected (and may be null) so the store runs in Node
// tests, and what comes back is re-parsed rather than trusted, so a hand-edited
// or stale entry is dropped instead of crashing the app.
//
// One rule is specific to this file and comes from stage 3 of
// `docs/platform-hardening-plan.md`: **only a confirmed holding is ever written
// here.** What Claude read from a screenshot is a proposal that lives in the
// store until the user accepts it; a misread share count that reached this file
// unseen would quietly change position sizing, which is the failure the whole
// feature is arranged to prevent. Nothing in this module writes on its own.

export const PORTFOLIO_KEY = 'stockScreener.portfolio.v1';

/** The slice of the Web Storage API this module uses. */
export interface PortfolioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One position the user has confirmed. Nulls survive confirmation. */
export interface ConfirmedHolding {
  /** The ticker as the user confirmed it, uppercased. Null when unresolved. */
  ticker: string | null;
  name: string | null;
  shares: number | null;
  averagePrice: number | null;
  currency: string | null;
}

export interface Portfolio {
  /** The account this came from, when the screenshot showed one. */
  accountLabel: string | null;
  holdings: ConfirmedHolding[];
  /** ISO timestamp of the confirmation, so the UI can say how stale it is. */
  confirmedAt: string;
}

function str(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** One entry, or null when it carries nothing worth keeping. */
export function parseHolding(raw: unknown): ConfirmedHolding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ticker = str(r.ticker);
  const holding: ConfirmedHolding = {
    ticker: ticker ? ticker.toUpperCase() : null,
    name: str(r.name),
    shares: num(r.shares),
    averagePrice: num(r.averagePrice),
    currency: str(r.currency),
  };
  // A row that identifies nothing is not a holding, whatever numbers it carries.
  if (!holding.ticker && !holding.name) return null;
  return holding;
}

export function loadPortfolio(storage: PortfolioStorage | null): Portfolio | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PORTFOLIO_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const holdings = Array.isArray(p.holdings)
    ? p.holdings.map(parseHolding).filter((h): h is ConfirmedHolding => h !== null)
    : [];
  if (holdings.length === 0) return null;
  return {
    accountLabel: str(p.accountLabel),
    holdings,
    confirmedAt: str(p.confirmedAt) ?? new Date(0).toISOString(),
  };
}

export function savePortfolio(storage: PortfolioStorage | null, portfolio: Portfolio): void {
  if (!storage) return;
  try {
    storage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolio));
  } catch {
    // A full or disabled storage must not take the confirmation down with it;
    // the portfolio stays in the store for this session and is simply not kept.
  }
}

export function clearPortfolio(storage: PortfolioStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(PORTFOLIO_KEY, '');
  } catch {
    // As above.
  }
}

/**
 * The tickers held, uppercased, for the "you hold this" marker on a screen row.
 *
 * A holding the user never resolved to a ticker cannot mark a row — the name
 * Avanza prints ("Volvo B") is not the ticker the universe is keyed by, and
 * guessing the mapping is exactly the kind of silent inference this feature
 * refuses everywhere else.
 */
export function heldTickers(portfolio: Portfolio | null): ReadonlySet<string> {
  if (!portfolio) return new Set();
  const held = new Set<string>();
  for (const holding of portfolio.holdings) {
    if (holding.ticker) held.add(holding.ticker);
  }
  return held;
}
