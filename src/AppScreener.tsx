import { useEffect } from 'react';
import { useScreener } from './store';
import { TopBar } from './components/TopBar';
import { Results } from './components/Results';
import { Sidebar } from './components/Sidebar';
import { DetailOverlay, DetailDock } from './components/detail/DetailPanels';
import { CompareBar, CompareDrawer } from './components/compare/Compare';
import { BacktestModal } from './components/modals/BacktestModal';
import { IndicatorBuilderModal } from './components/modals/IndicatorBuilderModal';
import { ScreenBuilderModal } from './components/modals/ScreenBuilderModal';
import { PresetBuilderModal } from './components/modals/PresetBuilderModal';
import { DevImportModal } from './components/modals/DevImportModal';

// Full screener — assembled from the feature components. Mirrors the POC root.
export function AppScreener() {
  const init = useScreener((s) => s.init);
  const ready = useScreener((s) => s.ready);
  const layout = useScreener((s) => s.layout);
  useEffect(() => { init(); }, [init]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f5f6', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#15171a', overflow: 'hidden' }}>
      <TopBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        <Results />
        {layout === 'docked' && <DetailDock />}
      </div>

      <DetailOverlay />
      <IndicatorBuilderModal />
      <ScreenBuilderModal />
      <PresetBuilderModal />
      <CompareBar />
      <CompareDrawer />
      <BacktestModal />
      <DevImportModal />

      {!ready && (
        <div style={{ position: 'fixed', inset: 0, background: '#f4f5f6', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 }}>
          <div style={{ width: 26, height: 26, border: '3px solid #e0e3e5', borderTopColor: '#06a96b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
    </div>
  );
}
