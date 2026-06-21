import { Presets } from './sidebar/Presets';
import { ActiveFilters } from './sidebar/ActiveFilters';
import { Indicators } from './sidebar/Indicators';
import { Screens } from './sidebar/Screens';
import { RuleSection, PatternSection, RankSection } from './sidebar/FilterSections';
import { QuickSignals } from './sidebar/QuickSignals';

// The 320px filter sidebar — composes the leaf sections built by the
// `filters` and `builders` agents. Order matches the POC sidebar.
export function Sidebar() {
  return (
    <div style={{ width: 320, flex: 'none', background: '#fff', borderRight: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 18px 14px' }}>
        <Presets />
        <ActiveFilters />
        <Indicators />
        <Screens />
        <RuleSection />
        <PatternSection />
        <RankSection />
        <QuickSignals />
      </div>
    </div>
  );
}
