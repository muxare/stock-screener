import { useEffect } from 'react';
import { useScreener } from './store';
import { TopBar } from './components/TopBar';
import { FilterBar } from './components/FilterBar';
import { FanLists } from './components/FanLists';
import { DetailOverlay } from './components/detail/DetailPanels';
import { DevImportModal } from './components/modals/DevImportModal';
import { FanBacktestModal } from './components/modals/FanBacktestModal';

export function AppScreener() {
  const init = useScreener((s) => s.init);
  const ready = useScreener((s) => s.ready);
  useEffect(() => { init(); }, [init]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f5f6', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#15171a', overflow: 'hidden' }}>
      <TopBar />
      <FilterBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <FanLists />
      </div>
      <DetailOverlay />
      <DevImportModal />
      <FanBacktestModal />
      {!ready && (
        <div style={{ position: 'fixed', inset: 0, background: '#f4f5f6', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}>
          <div style={{ width: 26, height: 26, border: '3px solid #e0e3e5', borderTopColor: '#06a96b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
    </div>
  );
}
