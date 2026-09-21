import type { ReactNode } from 'react';
import {
  fieldOf,
  formatField,
  valueOfField,
  isFieldId,
  type FieldId,
  type ScreenRowLike,
} from '../../lib/screen/fields';
import { isNum } from '../../lib/screen/format';
import { sortRows, toggleSort, type SortKey, type SortState, type SortValue } from '../../lib/screen/sort';
import { HDiv } from '../ui/Hoverable';
import { Spark } from '../ui/Spark';

/**
 * ScreenTable — the one grid behind every screener list.
 *
 * Columns are `FieldId`s resolved through the registry in lib/screen/fields.ts,
 * so the header label, width, alignment and cell format all come from the
 * declaration; the grid template is computed from the visible columns rather
 * than being a hard-coded constant. `extra` carries the columns only one list
 * has (the entry / stop / R / target-window / age block) with their own
 * renderer and sort value, so they sort through the same `sortRows`.
 */

export interface ExtraColumn<T> {
  id: string;
  label: string;
  width: string;
  align?: 'left' | 'right';
  help?: string;
  title?: string;
  render: (row: T) => ReactNode;
  /** Omit to make the column unsortable. */
  sortValue?: (row: T) => SortValue;
}

export const ROW_H = 34;
const HEAD_H = 30;

const GREEN = '#06a96b';
const RED = '#e23d3d';
const MUTED = '#98a0a8';

const headCell = (align: 'left' | 'right', sortable: boolean) => ({
  textAlign: align,
  padding: '0 6px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  cursor: sortable ? 'pointer' : 'default',
  userSelect: 'none' as const,
});

const bodyCell = (align: 'left' | 'right') => ({
  textAlign: align,
  padding: '0 6px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
});

function changeColor(v: number): string {
  return v >= 0 ? GREEN : RED;
}

/** The kaggle dataset has no company names; repeating the ticker is noise. */
function nameCell(row: ScreenRowLike): string {
  return row.name && row.name !== row.ticker ? row.name : '—';
}

// A dot before the ticker on a name the confirmed portfolio holds (hardening
// stage 3). It is deliberately quiet — a marker, not a column: holding a name
// changes how you read a signal, but it is not a figure to sort by, and the
// portfolio is only as current as the last screenshot that was confirmed.
function HeldMark() {
  return (
    <span
      title="You hold this, according to the last portfolio you confirmed"
      style={{ color: '#06a96b', fontSize: 9, marginRight: 4, verticalAlign: 'middle' }}
    >
      ●
    </span>
  );
}

function cellContent(id: FieldId, row: ScreenRowLike, held: boolean): ReactNode {
  if (id === 'sparkline') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Spark values={row.sparkline ?? []} width={80} height={18} />
      </div>
    );
  }
  if (id === 'ticker') {
    return <span style={{ fontWeight: 700 }}>{held && <HeldMark />}{row.ticker}</span>;
  }
  if (id === 'name') return <span style={{ color: '#6b7280' }}>{nameCell(row)}</span>;
  const text = formatField(id, row);
  if (id === 'changePct') {
    return <span style={{ color: changeColor(row.changePct), fontWeight: 600 }}>{text}</span>;
  }
  if (id === 'worstGap') {
    return <span style={{ color: isNum(row.worstGap) && row.worstGap >= 0 ? '#06865a' : '#b06a00', fontWeight: 600 }}>{text}</span>;
  }
  if (id === 'perf1m' || id === 'perf3m') {
    const v = valueOfField(id, row);
    return <span style={{ color: isNum(v) ? changeColor(v) : MUTED }}>{text}</span>;
  }
  return text;
}

/** Smallest sensible width of a grid track, for the table's horizontal scroll. */
function trackMin(track: string): number {
  const px = /(\d+(?:\.\d+)?)px/.exec(track);
  return px ? Number(px[1]) : 80;
}

function SortArrow({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return null;
  return <span style={{ color: GREEN, fontSize: 9, marginLeft: 3 }}>{dir === 'asc' ? '▲' : '▼'}</span>;
}

export function ScreenTable<T extends ScreenRowLike>({
  rows,
  columns,
  extra = [],
  extraAfter,
  sort,
  onSort,
  selected,
  onSelect,
  empty,
  rowTitle,
  held,
}: {
  rows: T[];
  columns: FieldId[];
  extra?: ExtraColumn<T>[];
  /** Where the `extra` block sits; appended at the end when omitted. */
  extraAfter?: FieldId;
  sort: SortState | null;
  onSort: (next: SortState) => void;
  selected: string | null;
  onSelect: (ticker: string) => void;
  empty: string;
  rowTitle?: (row: T) => string;
  /** Tickers the confirmed portfolio holds; they get a marker on the ticker. */
  held?: ReadonlySet<string>;
}) {
  const extraById = new Map(extra.map((c) => [c.id, c]));
  const at = extraAfter ? columns.indexOf(extraAfter) : -1;
  const keys: SortKey[] = at >= 0
    ? [...columns.slice(0, at + 1), ...extra.map((c) => c.id), ...columns.slice(at + 1)]
    : [...columns, ...extra.map((c) => c.id)];

  const valueOf = (row: T, key: SortKey): SortValue => {
    const ex = extraById.get(key);
    if (ex) return ex.sortValue ? ex.sortValue(row) : null;
    return isFieldId(key) ? valueOfField(key, row) : null;
  };

  if (rows.length === 0) {
    return <div style={{ padding: '36px 20px', color: MUTED, fontSize: 13, textAlign: 'center' }}>{empty}</div>;
  }

  const ordered = sortRows(rows, sort, valueOf, (r) => r.ticker);
  const tracks = keys.map((k) => extraById.get(k)?.width ?? (isFieldId(k) ? fieldOf(k)?.width ?? '80px' : '80px'));
  const template = tracks.join(' ');
  // The panel is narrower than the full column set, so the table scrolls
  // sideways inside it rather than squeezing every number into ellipses.
  const minWidth = `${tracks.reduce((sum, t) => sum + trackMin(t), 20)}px`;

  return (
    <div style={{ minWidth }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: template,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: '#fff',
          padding: '0 10px',
          height: HEAD_H,
          alignItems: 'center',
          borderBottom: '1px solid #eef0f1',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {keys.map((key) => {
          const ex = extraById.get(key);
          const field = !ex && isFieldId(key) ? fieldOf(key) : undefined;
          const label = ex ? ex.label : field?.label ?? key;
          const align = (ex?.align ?? field?.align ?? 'right') as 'left' | 'right';
          const sortable = ex ? !!ex.sortValue : !!field && field.kind !== 'spark';
          const help = ex?.help ?? field?.help;
          const dir = sort && sort.field === key ? sort.dir : null;
          const startDir = field && (field.kind === 'text' || field.kind === 'enum') ? 'asc' : 'desc';
          return (
            <HDiv
              key={key}
              data-help={help}
              title={ex?.title ?? field?.title ?? (sortable ? `Sort by ${label}` : undefined)}
              onClick={sortable ? () => onSort(toggleSort(sort, key, startDir)) : undefined}
              style={{ ...headCell(align, sortable), color: dir ? '#3d4349' : MUTED }}
              hoverStyle={sortable ? { color: '#3d4349' } : undefined}
            >
              {label}
              <SortArrow dir={dir} />
            </HDiv>
          );
        })}
      </div>

      {ordered.map((row) => {
        const active = selected === row.ticker;
        return (
          <HDiv
            key={row.ticker}
            onClick={() => onSelect(row.ticker)}
            title={rowTitle ? rowTitle(row) : `${row.ticker} — click for the candlestick chart`}
            style={{
              display: 'grid',
              gridTemplateColumns: template,
              padding: '0 10px',
              height: ROW_H,
              alignItems: 'center',
              cursor: 'pointer',
              background: active ? '#eafaf3' : '#fff',
              borderBottom: '1px solid #f4f5f6',
              fontSize: 12.5,
              fontVariantNumeric: 'tabular-nums',
            }}
            hoverStyle={{ background: active ? '#eafaf3' : '#f7f8f8' }}
          >
            {keys.map((key) => {
              const ex = extraById.get(key);
              if (ex) {
                return (
                  <div key={key} style={bodyCell(ex.align ?? 'right')}>{ex.render(row)}</div>
                );
              }
              if (!isFieldId(key)) return <div key={key} />;
              const field = fieldOf(key);
              return (
                <div key={key} style={bodyCell(field?.align ?? 'right')}>{cellContent(key, row, held?.has(row.ticker) ?? false)}</div>
              );
            })}
          </HDiv>
        );
      })}
    </div>
  );
}
