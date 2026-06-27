import { useEffect, useRef, useState } from 'react';
import { useScreener } from '../../store';
import { HButton, HInput, HTextarea } from '../ui/Hoverable';

// ----------------------------------------------------------------------------
// Dev-only EOD import modal (STORY-031). Surfaces the CLI importer
// (tools/eod-import) in the UI: pick a config (optionally edit it inline), point
// at CSV data on the server OR upload files, and write the dev SQLite DB. Only
// mounted/usable when the service reports DEV_TOOLS on (`devImport.available`);
// the styling mirrors BacktestModal so it reads as part of the app's chrome.
// ----------------------------------------------------------------------------

const label: React.CSSProperties = { fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 };
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e7e8ea', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fafbfb', outline: 'none' };

export function DevImportModal() {
  const di = useScreener((s) => s.devImport);
  const closeDevImport = useScreener((s) => s.closeDevImport);
  const selectImportConfig = useScreener((s) => s.selectImportConfig);
  const setImportConfigText = useScreener((s) => s.setImportConfigText);
  const setImportMode = useScreener((s) => s.setImportMode);
  const selectImportEntry = useScreener((s) => s.selectImportEntry);
  const setImportUploads = useScreener((s) => s.setImportUploads);
  const setImportTargetDb = useScreener((s) => s.setImportTargetDb);
  const runDevImport = useScreener((s) => s.runDevImport);

  const [showEditor, setShowEditor] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  // `webkitdirectory` is non-standard (folder picker) and not in the JSX typings;
  // set it on the DOM node directly so the input selects a directory's files.
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); }, []);

  if (!di.available || !di.open) return null;

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const csvs = Array.from(list).filter((f) => f.name.toLowerCase().endsWith('.csv'));
    const files = await Promise.all(csvs.map(async (f) => ({ name: f.name, content: await f.text() })));
    setImportUploads(files, files.length ? `${files.length} CSV file(s) staged` : 'No .csv files in the selection');
  }

  const R = di.report;

  return (
    <div onClick={closeDevImport} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', animation: 'popin 0.18s ease' }}>
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 9 }}>
            Import market data
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b06a00', background: '#fff4e0', border: '1px solid #f3d9a8', padding: '2px 7px', borderRadius: 5, letterSpacing: '0.04em' }}>DEV ONLY</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3 }}>Load CSV EOD data into the dev SQLite database, then re-screen against it — no restart.</div>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Config ------------------------------------------------------- */}
          <div>
            <div style={{ ...label, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Config{di.configDirty ? ' · edited' : ''}</span>
              <span onClick={() => setShowEditor((v) => !v)} style={{ cursor: 'pointer', color: '#06865a', textTransform: 'none', letterSpacing: 0, fontSize: 11.5 }}>{showEditor ? 'Hide JSON' : 'Edit JSON'}</span>
            </div>
            <select value={di.configName} onChange={(e) => selectImportConfig(e.target.value)} style={field}>
              {di.configs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            {showEditor && (
              <HTextarea
                value={di.configText}
                onChange={(e) => setImportConfigText((e.target as HTMLTextAreaElement).value)}
                spellCheck={false}
                style={{ ...field, marginTop: 8, minHeight: 150, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}
                focusStyle={{ borderColor: '#06a96b', background: '#fff' }}
              />
            )}
          </div>

          {/* Source: browse server dir OR upload -------------------------- */}
          <div>
            <div style={label}>Source</div>
            <div style={{ display: 'flex', gap: 2, background: '#f4f5f6', padding: 3, borderRadius: 9, marginBottom: 10, width: 'fit-content' }}>
              {(['browse', 'upload'] as const).map((m) => {
                const active = di.inputMode === m;
                return (
                  <button key={m} onClick={() => setImportMode(m)} style={{ padding: '6px 14px', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: active ? '#fff' : 'transparent', color: active ? '#15171a' : '#8b9298', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>
                    {m === 'browse' ? 'Browse server' : 'Upload files'}
                  </button>
                );
              })}
            </div>

            {di.inputMode === 'browse' ? (
              <>
                <select value={di.selectedEntry} onChange={(e) => selectImportEntry(e.target.value)} style={field}>
                  {di.dataEntries.length === 0 && <option value="">(no .csv files or folders found)</option>}
                  {di.dataEntries.map((entry) => (
                    <option key={entry.path} value={entry.path}>{entry.type === 'dir' ? '📁 ' : '📄 '}{entry.name}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: '#aab0b6', marginTop: 6 }}>Scanning <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{di.dataDir}</code> — set <code>EOD_DATA_DIR</code> to change.</div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ ...field, cursor: 'pointer', textAlign: 'center', flex: 1, background: '#fff', color: '#5b6168', fontWeight: 600 }}>
                    Choose files
                    <input type="file" multiple accept=".csv" onChange={(e) => void onFiles(e.target.files)} style={{ display: 'none' }} />
                  </label>
                  <label style={{ ...field, cursor: 'pointer', textAlign: 'center', flex: 1, background: '#fff', color: '#5b6168', fontWeight: 600 }}>
                    Choose folder
                    <input ref={folderRef} type="file" onChange={(e) => void onFiles(e.target.files)} style={{ display: 'none' }} />
                  </label>
                </div>
                <div style={{ fontSize: 11.5, color: di.uploads.length ? '#06865a' : '#aab0b6', marginTop: 6 }}>{di.uploadLabel || 'No files staged.'}</div>
              </>
            )}
          </div>

          {/* Target DB ---------------------------------------------------- */}
          <div>
            <div style={label}>Target database</div>
            <HInput value={di.targetDb} onChange={(e) => setImportTargetDb((e.target as HTMLInputElement).value)} style={field} focusStyle={{ borderColor: '#06a96b', background: '#fff' }} />
            <div style={{ fontSize: 11, color: '#aab0b6', marginTop: 6 }}>Imported data becomes the active dataset and persists across restarts — delete the DB (or <code>.dev-active-db</code>) to return to the generated one. <code>MARKETDATA_DB</code> overrides.</div>
          </div>

          {/* Result / error ---------------------------------------------- */}
          {di.error && (
            <div style={{ fontSize: 13, color: '#b3261a', lineHeight: 1.5, padding: '11px 13px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 9 }}>{di.error}</div>
          )}
          {R && !di.error && (
            <div style={{ border: '1px solid #bfe8d6', background: '#eafaf3', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#06865a', marginBottom: 10 }}>Imported — {R.universe} names now in the universe</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                {[['Files', R.files], ['Instruments', R.instruments], ['Bars', R.bars], ['Skipped', R.skipped]].map(([k, v]) => (
                  <div key={k as string}>
                    <div style={{ fontSize: 10.5, color: '#6b8f7e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k === 'Skipped' && (v as number) > 0 ? '#b06a00' : '#15171a' }}>{v as number}</div>
                  </div>
                ))}
              </div>
              {R.errors.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 11.5, color: '#8b7355', fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.6 }}>
                  {R.errors.slice(0, 5).map((e, i) => <div key={i}>{e.file.split('/').pop()}:{e.line} — {e.reason}</div>)}
                  {R.errors.length > 5 && <div>…and {R.errors.length - 5} more</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2' }}>
          <HButton onClick={closeDevImport} style={{ padding: '11px 20px', border: '1px solid #e7e8ea', borderRadius: 10, background: '#fff', color: '#5b6168', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f7f8f8' }}>Close</HButton>
          <HButton
            onClick={() => void runDevImport()}
            disabled={di.running}
            style={{ marginLeft: 'auto', padding: '11px 22px', border: 'none', borderRadius: 10, background: di.running ? '#9bbdb0' : '#06a96b', color: '#fff', fontSize: 13, fontWeight: 600, cursor: di.running ? 'default' : 'pointer', fontFamily: 'inherit' }}
            hoverStyle={di.running ? {} : { background: '#06865a' }}
          >
            {di.running ? 'Importing…' : 'Run import'}
          </HButton>
        </div>
      </div>
    </div>
  );
}
