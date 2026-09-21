import { useEffect, useRef, useState } from 'react';
import { useScreener } from '../../store';
import type { EditableHolding } from '../../store/portfolioSlice';
import { HButton, HInput } from '../ui/Hoverable';

// ----------------------------------------------------------------------------
// Portfolio screenshot reader (hardening stage 3 / phase C of the CCA-F plan).
//
// The design point this component exists to enforce: **what Claude read is a
// proposal, never a fact.** So the image stays on screen beside the rows it
// produced, every field is editable, every row can be dropped, and nothing is
// stored until "Confirm holdings" is pressed. A misread share count that reached
// the portfolio unseen would change position sizing silently, which is the one
// failure this feature must not have.
//
// The rows arrive from the store already sorted with the least confident first,
// for the same reason: the rows worth a second look are the ones you see first,
// not the ones you scroll to.
// ----------------------------------------------------------------------------

const label: React.CSSProperties = { fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 };
const cell: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '5px 7px', border: '1px solid #e7e8ea', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff', outline: 'none' };

const CONFIDENCE_STYLE: Record<EditableHolding['confidence'], React.CSSProperties> = {
  low: { color: '#b3261e', background: '#fdeceb', border: '1px solid #f5c6c2' },
  medium: { color: '#b06a00', background: '#fff4e0', border: '1px solid #f3d9a8' },
  high: { color: '#06865a', background: '#e6f6ef', border: '1px solid #b9e3d1' },
};

/** Numbers come back from a text field; a field cleared to nothing is null. */
function readNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const show = (value: number | null) => (value === null ? '' : String(value));

/** The data URL for a chosen file, or null when the browser could not read it. */
function readImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function PortfolioImportModal() {
  const p = useScreener((s) => s.portfolio);
  const closePortfolio = useScreener((s) => s.closePortfolio);
  const setScreenshot = useScreener((s) => s.setScreenshot);
  const extractHoldings = useScreener((s) => s.extractHoldings);
  const editHolding = useScreener((s) => s.editHolding);
  const toggleHolding = useScreener((s) => s.toggleHolding);
  const confirmHoldings = useScreener((s) => s.confirmHoldings);
  const forgetPortfolio = useScreener((s) => s.forgetPortfolio);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Pasting is how a screenshot usually arrives on a desktop, so the whole modal
  // listens rather than one field. The listener is only attached while the modal
  // is open, or it would eat every paste in the app.
  useEffect(() => {
    if (!p.open) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile();
      if (file) void readImageFile(file).then(setScreenshot);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [p.open, setScreenshot]);

  if (!p.available || !p.open) return null;

  const stage = (file: File | null | undefined) => {
    if (file) void readImageFile(file).then(setScreenshot);
  };

  const kept = p.rows.filter((r) => r.include).length;

  return (
    <div onClick={closePortfolio} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 980, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', animation: 'popin 0.18s ease' }}>

        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Read holdings from a screenshot</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3 }}>
            Paste or drop a screenshot of your holdings. Claude reads it; you check every row before anything is saved.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, padding: '18px 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>

          {/* The image, kept beside the rows it produced -------------------- */}
          <div style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={label}>Screenshot</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); stage(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{ border: `1.5px dashed ${dragging ? '#06a96b' : '#e0e3e5'}`, borderRadius: 11, background: dragging ? '#f2fbf7' : '#fafbfb', minHeight: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', padding: p.imageDataUrl ? 0 : 20 }}
            >
              {p.imageDataUrl
                ? <img src={p.imageDataUrl} alt="The screenshot being read" style={{ width: '100%', display: 'block' }} />
                : <div style={{ fontSize: 12.5, color: '#98a0a8', textAlign: 'center', lineHeight: 1.6 }}>Paste (⌘V), drop a file,<br />or click to choose one</div>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => stage(e.target.files?.[0])} style={{ display: 'none' }} />

            <HButton
              onClick={() => void extractHoldings()}
              disabled={!p.imageDataUrl || p.extracting}
              style={{ padding: '9px 14px', border: 'none', borderRadius: 9, background: !p.imageDataUrl || p.extracting ? '#c6cbd0' : '#06a96b', color: '#fff', fontSize: 13, fontWeight: 600, cursor: !p.imageDataUrl || p.extracting ? 'default' : 'pointer', fontFamily: 'inherit' }}
              hoverStyle={!p.imageDataUrl || p.extracting ? {} : { background: '#06865a' }}
            >
              {p.extracting ? 'Reading…' : 'Read holdings'}
            </HButton>

            {p.confirmed && (
              <div style={{ fontSize: 11.5, color: '#8b9298', lineHeight: 1.6, borderTop: '1px solid #f0f1f2', paddingTop: 10 }}>
                {p.confirmed.holdings.length} holding(s) confirmed {new Date(p.confirmed.confirmedAt).toLocaleString()}
                {' · '}
                <span onClick={forgetPortfolio} style={{ cursor: 'pointer', color: '#b3261e' }}>forget them</span>
              </div>
            )}
          </div>

          {/* The proposal --------------------------------------------------- */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {p.error && (
              <div style={{ fontSize: 12.5, color: '#b3261e', background: '#fdeceb', border: '1px solid #f5c6c2', borderRadius: 9, padding: '9px 11px' }}>{p.error}</div>
            )}

            {p.attempts > 1 && (
              <div style={{ fontSize: 11.5, color: '#b06a00' }}>
                The first reading did not pass validation; this is the second attempt.
              </div>
            )}

            {p.problems.length > 0 && (
              <div style={{ fontSize: 12, color: '#b3261e', background: '#fdeceb', border: '1px solid #f5c6c2', borderRadius: 9, padding: '9px 11px', lineHeight: 1.6 }}>
                <strong>Still does not add up</strong> — check these against the image before confirming:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {p.problems.map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              </div>
            )}

            {p.warnings.length > 0 && (
              <div style={{ fontSize: 12, color: '#b06a00', background: '#fff4e0', border: '1px solid #f3d9a8', borderRadius: 9, padding: '9px 11px', lineHeight: 1.6 }}>
                {p.warnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            )}

            {p.rows.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#98a0a8', padding: '30px 0', textAlign: 'center' }}>
                {p.extracting ? 'Reading the screenshot…' : 'No rows yet.'}
              </div>
            ) : (
              <>
                <div style={{ ...label, marginBottom: 0 }}>
                  {p.accountLabel ? `${p.accountLabel} · ` : ''}{p.rows.length} row(s), least certain first
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#98a0a8', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '0 4px 6px', width: 26 }} />
                      <th style={{ padding: '0 4px 6px' }}>Name</th>
                      <th style={{ padding: '0 4px 6px', width: 88 }}>Ticker</th>
                      <th style={{ padding: '0 4px 6px', width: 78 }}>Shares</th>
                      <th style={{ padding: '0 4px 6px', width: 86 }}>Avg price</th>
                      <th style={{ padding: '0 4px 6px', width: 62 }}>Ccy</th>
                      <th style={{ padding: '0 4px 6px', width: 70 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((row, i) => (
                      <tr key={i} style={{ opacity: row.include ? 1 : 0.45, borderTop: '1px solid #f4f5f6' }}>
                        <td style={{ padding: '6px 4px' }}>
                          <input type="checkbox" checked={row.include} onChange={() => toggleHolding(i)} title="Keep this row" />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <HInput value={row.name ?? ''} onChange={(e) => editHolding(i, { name: (e.target as HTMLInputElement).value || null })} style={cell} focusStyle={{ border: '1px solid #06a96b' }} />
                          {row.note && <div style={{ fontSize: 10.5, color: '#b06a00', marginTop: 3 }}>{row.note}</div>}
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <HInput value={row.ticker ?? ''} placeholder="—" onChange={(e) => editHolding(i, { ticker: (e.target as HTMLInputElement).value || null })} style={cell} focusStyle={{ border: '1px solid #06a96b' }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <HInput value={show(row.shares)} placeholder="unread" onChange={(e) => editHolding(i, { shares: readNumber((e.target as HTMLInputElement).value) })} style={{ ...cell, background: row.shares === null ? '#fdeceb' : '#fff' }} focusStyle={{ border: '1px solid #06a96b' }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <HInput value={show(row.averagePrice)} placeholder="unread" onChange={(e) => editHolding(i, { averagePrice: readNumber((e.target as HTMLInputElement).value) })} style={{ ...cell, background: row.averagePrice === null ? '#fdeceb' : '#fff' }} focusStyle={{ border: '1px solid #06a96b' }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <HInput value={row.currency ?? ''} placeholder="—" onChange={(e) => editHolding(i, { currency: (e.target as HTMLInputElement).value || null })} style={cell} focusStyle={{ border: '1px solid #06a96b' }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <span style={{ ...CONFIDENCE_STYLE[row.confidence], fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, letterSpacing: '0.04em' }}>
                            {row.confidence.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f1f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 11.5, color: '#98a0a8' }}>
            Nothing is saved until you confirm. The screenshot itself is never stored or logged.
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <HButton
              onClick={closePortfolio}
              style={{ padding: '9px 14px', border: '1px solid #e7e8ea', borderRadius: 9, background: '#fff', color: '#5b6168', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              hoverStyle={{ border: '1px solid #c6cbd0' }}
            >
              Cancel
            </HButton>
            <HButton
              onClick={confirmHoldings}
              disabled={kept === 0}
              style={{ padding: '9px 16px', border: 'none', borderRadius: 9, background: kept === 0 ? '#c6cbd0' : '#06a96b', color: '#fff', fontSize: 13, fontWeight: 600, cursor: kept === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
              hoverStyle={kept === 0 ? {} : { background: '#06865a' }}
            >
              Confirm {kept || ''} holding{kept === 1 ? '' : 's'}
            </HButton>
          </div>
        </div>
      </div>
    </div>
  );
}
