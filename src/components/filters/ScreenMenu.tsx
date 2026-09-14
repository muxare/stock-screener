import { useState } from 'react';
import { useScreener } from '../../store';
import type { SavedScreen } from '../../store';
import { UNTITLED_SCREEN } from '../../lib/screen/storage';
import { HButton, HDiv, HInput } from '../ui/Hoverable';
import { LABEL, POPOVER, useDismiss } from './useDismiss';

/**
 * The screen menu: the name of the screen on show, a ▾ of what can be done to
 * it, and a Save that appears only when the state has drifted from the saved
 * copy. It sits where the filter bar's explanatory sentence used to, which is
 * the same corner TradingView puts its screen title in.
 *
 * A screen is the chips, the sort and columns of the table shape the visible
 * tab uses, the tab itself and the entry strategy — everything the store's
 * `screenState()` collects. The search box is deliberately not part of it: it is
 * a lookup, not a filter you would name and come back to.
 */
export function ScreenMenu() {
  const screens = useScreener((s) => s.screens);
  const activeScreenId = useScreener((s) => s.activeScreenId);
  // A derived boolean rather than a subscription per piece of screen state: the
  // selector re-runs on every store change and only re-renders when it flips.
  const dirty = useScreener((s) => s.screenDirty());
  const newScreen = useScreener((s) => s.newScreen);
  const saveScreen = useScreener((s) => s.saveScreen);
  const saveScreenAs = useScreener((s) => s.saveScreenAs);
  const loadScreen = useScreener((s) => s.loadScreen);
  const renameScreen = useScreener((s) => s.renameScreen);
  const deleteScreen = useScreener((s) => s.deleteScreen);
  const setDefaultScreen = useScreener((s) => s.setDefaultScreen);

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<'none' | 'saveAs' | 'rename' | 'delete'>('none');
  const [name, setName] = useState('');
  // Closing drops a half-typed name, wherever the close came from.
  const close = () => { setOpen(false); setPrompt('none'); };
  const wrap = useDismiss<HTMLDivElement>(open, close);

  const active = screens.find((s) => s.id === activeScreenId);

  const startPrompt = (kind: 'saveAs' | 'rename' | 'delete') => {
    setPrompt(kind);
    if (kind === 'saveAs') setName(active ? `${active.name} copy` : '');
    if (kind === 'rename') setName(active?.name ?? '');
  };

  const commit = () => {
    if (prompt === 'saveAs') saveScreenAs(name);
    if (prompt === 'rename' && active) renameScreen(active.id, name);
    close();
  };

  const pick = (s: SavedScreen) => { loadScreen(s.id); close(); };

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <HButton
        data-help="saved-screen"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        title={active ? `Saved ${new Date(active.savedAt).toLocaleString()}` : 'This screen has not been saved'}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 6, maxWidth: 240,
          padding: '6px 10px', border: '1px solid #e7e8ea', borderRadius: 9,
          background: '#fff', color: active ? '#3d4349' : '#98a0a8',
          fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        }}
        hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active ? active.name : UNTITLED_SCREEN}
        </span>
        {dirty && <span style={{ color: '#e0a90a', fontSize: 14, lineHeight: 0 }} title="Unsaved changes">•</span>}
        <span style={{ color: '#98a0a8', fontSize: 10 }}>▾</span>
      </HButton>

      {dirty && (
        <HButton
          onClick={() => saveScreen()}
          title={`Overwrite "${active?.name ?? ''}" with the current filters, columns and sort`}
          style={{ padding: '6px 11px', border: '1px solid #06a96b', borderRadius: 9, background: '#06a96b', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          hoverStyle={{ background: '#06865a' }}
        >
          Save
        </HButton>
      )}

      {open && (
        <div style={{ ...POPOVER, top: 34, left: 'auto', right: 0, width: 268, maxHeight: 380, overflowY: 'auto' }}>
          {prompt === 'saveAs' || prompt === 'rename' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={LABEL}>{prompt === 'saveAs' ? 'Save this screen as' : 'Rename screen'}</div>
              <HInput
                value={name}
                autoFocus
                placeholder="Screen name"
                aria-label="Screen name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) commit(); }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #e7e8ea', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: '#3d4349' }}
                focusStyle={{ border: '1px solid #06a96b', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <HButton
                  onClick={commit}
                  disabled={!name.trim()}
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #06a96b', borderRadius: 7, background: name.trim() ? '#06a96b' : '#b8e3d0', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: name.trim() ? 'pointer' : 'default' }}
                  hoverStyle={name.trim() ? { background: '#06865a' } : undefined}
                >
                  {prompt === 'saveAs' ? 'Save' : 'Rename'}
                </HButton>
                <HButton onClick={() => setPrompt('none')} style={ROW_BUTTON} hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}>
                  Cancel
                </HButton>
              </div>
            </div>
          ) : prompt === 'delete' && active ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12.5, color: '#3d4349', lineHeight: 1.4 }}>
                Delete <strong>{active.name}</strong>? The filters stay on screen — only the saved copy goes.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <HButton
                  onClick={() => { deleteScreen(active.id); close(); }}
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #f5c6c0', borderRadius: 7, background: '#fdeceb', color: '#b3261a', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                  hoverStyle={{ background: '#f9dcd9' }}
                >
                  Delete
                </HButton>
                <HButton onClick={() => setPrompt('none')} style={ROW_BUTTON} hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}>
                  Cancel
                </HButton>
              </div>
            </div>
          ) : (
            <>
              <div style={{ ...LABEL, padding: '0 2px 6px' }}>This screen</div>
              <MenuRow label="New screen" hint="Back to the defaults" onClick={() => { newScreen(); close(); }} />
              {active && (
                <MenuRow
                  label="Save"
                  hint={dirty ? 'Overwrite the saved copy' : 'No changes to save'}
                  disabled={!dirty}
                  onClick={() => { saveScreen(); close(); }}
                />
              )}
              <MenuRow label="Save as…" onClick={() => startPrompt('saveAs')} />
              {active && <MenuRow label="Rename…" onClick={() => startPrompt('rename')} />}
              {active && <MenuRow label="Delete" danger onClick={() => startPrompt('delete')} />}

              <div style={{ ...LABEL, padding: '10px 2px 6px', borderTop: '1px solid #f0f1f2', marginTop: 8 }}>
                Saved screens
              </div>
              {screens.length === 0 && (
                <div style={{ fontSize: 11.5, color: '#98a0a8', padding: '2px 6px 4px', lineHeight: 1.4 }}>
                  None yet. Save as… writes the current chips, columns, sort and tab under a name.
                </div>
              )}
              {screens.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <HDiv
                    onClick={() => pick(s)}
                    title={`Saved ${new Date(s.savedAt).toLocaleString()}`}
                    style={{
                      flex: 1, minWidth: 0, padding: '5px 6px', borderRadius: 6, cursor: 'pointer',
                      fontSize: 12.5, color: s.id === activeScreenId ? '#06865a' : '#3d4349',
                      fontWeight: s.id === activeScreenId ? 700 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    hoverStyle={{ background: '#f4f5f6' }}
                  >
                    {s.name}
                  </HDiv>
                  <HButton
                    onClick={() => setDefaultScreen(s.default ? null : s.id)}
                    title={s.default ? 'Loads at start-up — click to stop' : 'Load this screen at start-up'}
                    aria-label={s.default ? `Stop loading ${s.name} at start-up` : `Load ${s.name} at start-up`}
                    style={{ border: 0, background: 'transparent', padding: '2px 5px', cursor: 'pointer', fontSize: 12, color: s.default ? '#e0a90a' : '#d3d7da', fontFamily: 'inherit' }}
                    hoverStyle={{ color: s.default ? '#c79609' : '#98a0a8' }}
                  >
                    ★
                  </HButton>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const ROW_BUTTON: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #e7e8ea', borderRadius: 7, background: '#fafbfb',
  color: '#6b7280', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
};

function MenuRow({
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = disabled ? '#c8ced3' : danger ? '#b3261a' : '#3d4349';
  return (
    <HDiv
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        padding: '5px 6px', borderRadius: 6, fontSize: 12.5, color,
        cursor: disabled ? 'default' : 'pointer',
      }}
      hoverStyle={disabled ? undefined : { background: danger ? '#fdeceb' : '#f4f5f6' }}
    >
      <span>{label}</span>
      {hint && <span style={{ fontSize: 10.5, color: '#a9b0b6' }}>{hint}</span>}
    </HDiv>
  );
}
