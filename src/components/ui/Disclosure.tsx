import type { CSSProperties } from 'react';

/**
 * Shared SAD#2.7 "not investment advice" compliance disclosure. Every signal-
 * bearing surface (results, detail, backtest) renders this; the canonical
 * wording lives here so it is never copied around. Backtest passes its
 * naive-fidelity caveat via `note` (e.g. ranking filters excluded from history).
 */
export const DISCLOSURE_TEXT =
  'Demo data for illustrating the workflow — not investment advice.';

type DisclosureProps = {
  note?: string;
  style?: CSSProperties;
};

export function Disclosure({ note, style }: DisclosureProps) {
  return (
    <div role="note" style={{ fontSize: 11, color: '#aab0b6', lineHeight: 1.5, ...style }}>
      {DISCLOSURE_TEXT}{note ? ' ' + note : ''}
    </div>
  );
}
