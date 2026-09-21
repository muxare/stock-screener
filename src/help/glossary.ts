// help/glossary.ts — the help topics behind every hover card.
//
// Each topic is one card. Bodies are plain prose; [[topic-id]] or
// [[topic-id|shown text]] links another topic explicitly, and any alias of a
// known topic is auto-linked the first time it appears (see link.ts). Keep
// meanings grounded in the code the card describes — the fan classifier
// (lib/fan.ts), the step registry (lib/strategy/steps.ts), the trade rows
// (lib/strategy/types.ts) and the backtest stats (lib/fanBacktest.ts).

import { buildLinkIndex, explicitLinks, type LinkIndex } from './link.ts';
import { SUMMON_LABEL } from './trigger.ts';

export type HelpKind =
  | 'indicator' | 'fan' | 'screen' | 'strategy' | 'step' | 'pattern' | 'trade' | 'backtest' | 'data' | 'ui';

export interface HelpTopic {
  id: string;
  title: string;
  kind: HelpKind;
  /** Phrases that auto-link to this topic inside other cards. */
  aliases?: string[];
  body: string;
  /** Shown as chips under the body. */
  related?: string[];
}

export const KIND_LABEL: Record<HelpKind, string> = {
  indicator: 'Indicator',
  fan: 'Fan screen',
  screen: 'Filter',
  strategy: 'Strategy',
  step: 'Step',
  pattern: 'Price action',
  trade: 'Trade',
  backtest: 'Backtest',
  data: 'Data',
  ui: 'Screenr',
};

const TOPIC_LIST: HelpTopic[] = [
  // ---------------------------------------------------------------- ui / meta
  {
    id: 'help',
    title: 'Help cards',
    kind: 'ui',
    body: `Hold ${SUMMON_LABEL} and point at anything in Screenr: a card like this one explains it. Without the key nothing opens, so documentation never lands on top of what you were reading while you work.

Once a card is up the key is redundant — you are already reading documentation — so plain hover keeps working while a card is showing, and for a moment after the last one closes on its own. Highlighted words inside a card are terms of their own: hover one to open its card on top.

The ? button in the top bar is the same thing without the key: click it and help mode stays on, lit green, with plain hover opening cards everywhere until you click it again or press Esc. Use it if holding a key while moving the pointer is awkward, or when you are reading rather than working.

Press T while a card is showing to pin it. A pinned card stays where it is, can be dragged by its title bar, and still lets you hover its highlighted terms to keep digging. Press Esc to close the most recent card, or use the × on a pinned one; dismissing a card also ends the plain-hover grace, so the next card needs the key again.`,
    related: ['fan', 'strategy', 'backtest'],
  },
  {
    id: 'search',
    title: 'Search',
    kind: 'ui',
    body: `Narrows every list to tickers or company names containing the text. It applies on top of the [[filters]] and never changes what the [[fan|fan screen]] itself computed.`,
  },
  {
    id: 'column-chooser',
    title: 'Columns',
    kind: 'ui',
    aliases: ['column chooser'],
    body: `The ⚙ over a list picks which columns it shows. Every column is a field the row already carries — [[rel-vol]], [[rsi]], [[perf|performance]], [[market-cap]] and the rest — so turning one on costs nothing and re-runs no [[fan|screen]].

Click a header to sort by that column; click it again to reverse. Names with no value for the sorted column (too little history, a dataset without volume) always sink to the bottom, whichever way it is sorted. Choices are per list and last for the session.`,
    related: ['filters', 'search'],
  },
  {
    id: 'detail-dock',
    title: 'Detail panel',
    kind: 'ui',
    aliases: ['detail panel', 'chart panel'],
    body: `The candlestick chart docks beside the list instead of covering it, so you can keep scanning while you chart: click another row and the panel swaps symbol in place. Drag its left edge to widen it — the chart redraws at the new width — and press Esc or ✕ to close.

Below 1100 px wide there is no room for both, so the panel goes back to covering the list and a click outside closes it. Nothing in the panel changes what the [[fan|screen]] matched; it is the same [[universe|instrument]] history drawn in full.`,
    related: ['fan', 'column-chooser'],
  },
  {
    id: 'saved-screen',
    title: 'Saved screens',
    kind: 'ui',
    aliases: ['saved screen', 'saved screens', 'screen menu'],
    body: `A screen is everything the bar and the table are set to: the [[filter-chip|chips]], the [[column-chooser|columns]] and sort of the list you are on, the tab itself and the [[entry-strategy|entry strategy]]. The ▾ beside the name saves it, renames it, deletes it, or loads one you saved before. The search box is deliberately not part of it — it is a lookup, not a filter worth naming.

Save appears only once the current state differs from the saved copy, and a dot sits by the name while it does. ★ marks the one screen that loads at start-up. Screens live in this browser, like your saved [[strategy|strategies]], and a screen whose strategy has since been deleted still loads — on the [[fan]] lists, with no entry scan.`,
    related: ['filters', 'column-chooser', 'entry-strategy'],
  },
  {
    id: 'data-source',
    title: 'Data source',
    kind: 'data',
    aliases: ['data source', 'Synthetic (generated)'],
    body: `Which market database the server screens. Synthetic (generated) is a deterministic fake [[universe]] for trying the workflow; a SQLite file is real end-of-day history loaded by the import tools. Switching re-runs the [[fan]] screen and any open [[live-entry|entry scan]].

An option marked invalid is a database the server found but could not open.`,
    related: ['universe', 'dev-import'],
  },
  {
    id: 'universe',
    title: 'Universe',
    kind: 'data',
    aliases: ['universe'],
    body: `Every instrument in the active [[data-source]]. The [[fan]] screen and the [[backtest]] walk all of it; the counts under each list header say how many names came out of that total.`,
  },
  {
    id: 'dev-import',
    title: 'Import data',
    kind: 'data',
    aliases: ['Import data'],
    body: `Loads CSV end-of-day bars into the dev database. It is only offered when the server runs with dev tools on and it never touches the synthetic [[data-source]].`,
  },
  {
    id: 'portfolio',
    title: 'Holdings',
    kind: 'data',
    aliases: ['Holdings'],
    body: `Your own positions, read by Claude from a screenshot of your broker account and then confirmed by you row by row. A name you hold is marked with a green dot beside its ticker in every list.

What comes back from the screenshot is a proposal, never a fact: anything Claude could not read in full comes back blank rather than guessed, the least certain rows are shown first, and nothing is saved until you confirm it. The list lives in this browser only — the screenshot is never stored and never logged.`,
    related: ['universe', 'live-entry'],
  },

  // ---------------------------------------------------------------- indicators
  {
    id: 'ema',
    title: 'EMA (exponential moving average)',
    kind: 'indicator',
    aliases: ['EMA', 'EMAs', 'exponential moving average', '18-EMA', '50-EMA', '100-EMA', '200-EMA', 'the 18', 'the 50', 'the 100', 'the 200'],
    body: `An average of closing prices that weights recent bars more heavily, so it turns faster than a simple average. Screenr uses four lengths everywhere: 18, 50, 100 and 200 daily bars. Their order on the chart defines the [[fan]]; their slope and crossings drive most [[step|steps]].

The EMA columns in the lists show each average's value on the latest bar.`,
    related: ['fan', 'ema200-slope', 'macd-18-50'],
  },
  {
    id: 'macd-18-50',
    title: '18–50 MACD',
    kind: 'indicator',
    aliases: ['18–50 MACD', '18-50 MACD', 'MACD flip'],
    body: `A MACD built from the fan's own averages instead of the textbook 12/26: the line is the 18-EMA minus the 50-EMA, the signal is a 9-bar EMA of that line, and the histogram is line minus signal.

It is favorable when the line is above its signal and the histogram is at or above zero. A flip is the line dropping below the signal. Used by the [[step-macd-favorable]] guard and the [[macd-exit]] rule.`,
    related: ['step-macd-favorable', 'macd-exit', 'indicators-at-entry'],
  },
  {
    id: 'macd',
    title: 'MACD (12/26/9)',
    kind: 'indicator',
    aliases: ['MACD 12/26/9', '12/26/9 MACD', 'classic MACD'],
    body: `The textbook moving-average convergence/divergence, drawn as its own pane under the chart: the line is the 12-EMA minus the 26-EMA, the signal is a 9-bar [[ema|EMA]] of that line, and the bars are line minus signal.

Read it as momentum, not direction. The histogram crossing zero is the line crossing its signal — the move is accelerating or has stopped doing so — and the line's distance from zero says how far the fast average has pulled away from the slow one. Divergence, price making a new extreme while the histogram does not, is the reading it is famous for and the one to be most careful with.

Screenr's own [[macd-18-50|18–50 MACD]] is a different pair, built from the fan's averages; it is what the [[step-macd-favorable]] guard reads. This pane and [[indicators-at-entry]] use the classic settings.`,
    related: ['macd-18-50', 'stoch-rsi', 'indicators-at-entry'],
  },
  {
    id: 'atr',
    title: 'ATR(14)',
    kind: 'indicator',
    aliases: ['ATR', 'ATR(14)', 'ATR pad'],
    body: `Average true range: a 14-bar exponential average of each bar's range, where range also counts the gap from the previous close. It is a volatility yardstick in price units.

The [[stop]] row uses it as a pad: an ATR pad of 0.25 places the stop a quarter of one ATR under the anchor low, so noisier names get a little more room.`,
    related: ['stop'],
  },
  {
    id: 'pivot-low',
    title: 'Pivot low',
    kind: 'indicator',
    aliases: ['pivot low', 'pivot lows', 'confirmed pivot', 'pivots'],
    body: `A three-bar swing low: a bar whose low is below both its neighbour's lows. It only counts once it is confirmed, which happens on the first later bar whose high takes out the high of the bar before the pivot.

[[trail-pivot]] moves the stop to 2¢ under each newly confirmed pivot low.`,
    related: ['trail-pivot', 'stop'],
  },
  {
    id: 'change-pct',
    title: 'Change',
    kind: 'indicator',
    body: `Percent change of the latest close against the previous close. Green is up, red is down. It is display only; no [[step]] or [[filters|filter]] reads it.`,
  },
  {
    id: 'sparkline',
    title: '40-day sparkline',
    kind: 'indicator',
    body: `The last 40 closes drawn as a tiny line so you can see the shape of the recent move without opening the chart. Click the row for the full candlestick chart with the four [[ema|EMAs]].`,
  },
  {
    id: 'rsi',
    title: 'RSI(14)',
    kind: 'indicator',
    aliases: ['RSI', 'RSI(14)', 'RSI 14'],
    body: `Relative strength index over 14 bars, on Wilder smoothing: the share of the recent move that was up, scaled 0–100. Above 70 is conventionally "overbought", below 30 "oversold", but in a stacked [[fan]] a reading in the 50s and 60s is simply what a healthy trend looks like.

The column is the reading on the latest bar. Names with fewer than 15 bars of history show — rather than a fabricated 50.`,
    related: ['stoch-rsi', 'fan'],
  },
  {
    id: 'stoch-rsi',
    title: 'Stoch RSI (%K / %D)',
    kind: 'indicator',
    aliases: ['Stoch RSI', 'stochastic RSI', 'Stoch %K', 'Stoch %D'],
    body: `Where the current [[rsi|RSI]] sits inside its own 14-bar range, smoothed twice (14, 3, 3) and scaled 0–100. It moves faster than RSI, so it reaches its extremes far more often: %K under 20 marks a pullback inside the move, over 80 a stretched one.

%K is the faster line, %D its 3-bar average. The [[backtest]] buckets fills by the same numbers under [[indicators-at-entry]].`,
    related: ['rsi', 'indicators-at-entry'],
  },
  {
    id: 'volume',
    title: 'Volume',
    kind: 'indicator',
    body: `Shares traded on the latest bar. On its own it says little — a big name always trades more than a small one — so compare it with [[avg-volume|its own 20-day average]] through [[rel-vol]].`,
    related: ['rel-vol', 'avg-volume'],
  },
  {
    id: 'rel-vol',
    title: 'Relative volume',
    kind: 'indicator',
    aliases: ['Rel vol', 'relative volume'],
    body: `Latest-bar [[volume]] divided by the [[avg-volume|20-day average]]. 1.0 is an ordinary day; 2.0 means twice the usual interest. It is the quickest read on whether anything is actually happening in a name today, independent of its size.`,
    related: ['volume', 'avg-volume'],
  },
  {
    id: 'perf',
    title: 'Performance (1M / 3M)',
    kind: 'indicator',
    aliases: ['Perf 1M', 'Perf 3M'],
    body: `Percent move of the close against the close 21 bars ago (about a month) and 63 bars ago (about three). It ranks names inside the [[fan]] by how much of the move has already happened — a fan that has just formed shows far less than one that has run for a quarter.

Shorter histories show — rather than a partial figure.`,
    related: ['fan', 'change-pct'],
  },
  {
    id: 'atr-pct',
    title: 'Volatility (ATR %)',
    kind: 'indicator',
    aliases: ['ATR %', 'Volatility'],
    body: `[[atr|ATR(14)]] as a percent of the latest close, so noisiness compares across prices: 2% means the average day covers about 2% of the price. It sets the scale of any [[stop]] you would place, and the [[r|R]] you would be risking.`,
    related: ['atr', 'stop', 'r'],
  },
  {
    id: 'week52',
    title: '52-week high / low',
    kind: 'indicator',
    aliases: ['52w high', '52w low', '52-week high'],
    body: `The highest high and lowest low of the last 252 trading days — the calendar year of bars. Datasets that carry only closes use those instead. Distance from the high is the usual sanity check on a [[fan]] that has already run.`,
    related: ['fan', 'perf'],
  },

  // ---------------------------------------------------------------- fan screen
  {
    id: 'fan',
    title: 'EMA fan (18 > 50 > 100 > 200)',
    kind: 'fan',
    aliases: ['EMA fan', 'full fan', 'the fan', 'fan screen', 'the stack', 'full stack', '18 > 50 > 100 > 200', '18>50>100>200'],
    body: `The core screen. A name is in the fan when its four [[ema|EMAs]] are stacked in order on the latest bar: 18 above 50, 50 above 100, 100 above 200. That ordering is what an established uptrend looks like once the averages have fanned apart.

The left list holds every name currently stacked; [[fan-near]] holds the ones about to be. Strategies build on the fan with [[step-fan-up]], [[step-fan-onset]] and the [[fan-exit]] rule.`,
    related: ['slow-fan', 'fan-near', 'worst-gap', 'step-fan-up'],
  },
  {
    id: 'slow-fan',
    title: 'Slow fan (50 > 100 > 200)',
    kind: 'fan',
    aliases: ['slow fan', '50 > 100 > 200', '50>100>200'],
    body: `The [[fan]] without its fastest average: 50 above 100 above 200. It survives a normal pullback where the 18-EMA dips under the 50, so steps use it as the looser "trend still intact" condition. [[step-ema-cross]] can require it while the cross fires, and [[fan-exit]] can flatten a trade when it breaks.`,
    related: ['fan', 'fan-exit'],
  },
  {
    id: 'fan-near',
    title: 'Close to fan',
    kind: 'fan',
    aliases: ['Close to fan', 'close to the fan', 'near the fan', 'approaching the stack', 'near status'],
    body: `Names that are not stacked yet but almost are. Two tests, both on the latest bar:

- The [[worst-gap]] between adjacent averages is inverted by less than 0.5%.
- That gap is better than it was 10 bars ago, so the name is entering the fan rather than leaving it.

[[step-fan-onset]] can trigger on the bar a name first turns near.`,
    related: ['fan', 'worst-gap', 'step-fan-onset'],
  },
  {
    id: 'worst-gap',
    title: 'Gap (worst adjacent pair)',
    kind: 'fan',
    aliases: ['worst gap', 'Gap column'],
    body: `The smallest of the three gaps between adjacent [[ema|EMAs]] (18 vs 50, 50 vs 100, 100 vs 200), each measured as a fraction of the slower average. Positive means every pair is in order and this is the tightest one; negative means at least one pair is inverted and this is how far.

A [[fan]] match always shows a positive gap. A [[fan-near]] name shows a small negative one.`,
    related: ['fan', 'fan-near'],
  },

  // ---------------------------------------------------------------- filters
  {
    id: 'filters',
    title: 'Filters',
    kind: 'screen',
    aliases: ['filters', 'filter bar'],
    body: `The filter bar trims both lists after the [[fan]] screen has run; it never changes which names are in the fan, only which are shown. It is an open row of [[filter-chip|chips]] — one per field — plus a + that adds any other. Clear filters restores the defaults, where only the [[ema200-slope]] is on.

Volume, cap and slope are the three the [[live-entry|entries]] scan is given up front, because that scan is expensive; every other chip is applied to the rows it returns. The same three floors are offered again in the [[backtest]] so the history matches what the lists show.`,
    related: ['filter-chip', 'saved-screen', 'avg-volume', 'market-cap', 'min-price', 'sector', 'ema200-slope'],
  },
  {
    id: 'filter-chip',
    title: 'Filter chips',
    kind: 'screen',
    aliases: ['filter chip', 'chip', 'chips'],
    body: `Each chip is one field and its allowed range. Click it to type a minimum, a maximum, or both — leave a box empty for an open end — or take one of the quick values. The + chip adds any field the table can show, so anything you can put in a [[column-chooser|column]] you can also filter on, including [[rsi]], [[stoch-rsi|Stoch %K]], [[rel-vol]], [[perf|performance]] and [[atr-pct|volatility]].

Units follow the field. A percent field is typed as a percent — [[atr-pct|volatility]] 3 means 3%, not 0.03. Volume and [[market-cap|cap]] accept 400K or 1.2B.

**A name with no value for a filtered field is dropped**, whichever bound is set. Short histories have no [[rsi|RSI]] and no [[stoch-rsi|Stoch RSI]] yet, and some datasets have no cap, so a chip can shrink a list for a reason that is not on screen — the "n of m shown" count is there to say it happened. Sorting deliberately does the opposite: a missing value sinks to the bottom but stays in the list.`,
    related: ['filters', 'column-chooser', 'ema200-slope'],
  },
  {
    id: 'entry-strategy',
    title: 'Entry strategy',
    kind: 'screen',
    aliases: ['Entry strategy'],
    body: `Switches the page from the two fan lists to a single list of [[live-entry|live entries]] for one [[strategy]]. Every name in the [[universe]] is scanned with that strategy's steps and trade rows, and the ones whose most recent simulated trade is still open are shown with their entry, stop, [[r|R]] and [[target-window]].

Choose "Fan lists (no entry)" to go back. Built-in presets are listed first, your saved strategies after.`,
    related: ['live-entry', 'strategy', 'backtest'],
  },
  {
    id: 'live-entry',
    title: 'Live entry',
    kind: 'screen',
    aliases: ['live entry', 'live entries', 'open entry', 'open entries', 'Entries'],
    body: `A [[strategy]] fill whose simulated trade is still open on the latest bar. The simulation uses the strategy's own [[stop]] at 1R and no early management, so "open" means price has neither hit the stop nor the target yet.

Entry, stop and the [[target-window]] are illustrative: no costs, slippage or overnight gaps. [[entry-age]] says how many bars ago the fill happened.`,
    related: ['entry-strategy', 'entry', 'stop', 'r', 'entry-age'],
  },
  {
    id: 'entry-age',
    title: 'Age',
    kind: 'screen',
    body: `Bars since the [[live-entry|entry]] filled; "today" means the fill is on the latest bar. Older entries have had more time to move toward the [[target-window|target]] or the [[stop]].`,
  },
  {
    id: 'avg-volume',
    title: 'Average volume (20d)',
    kind: 'screen',
    aliases: ['Avg volume', 'average volume', '20-day average volume'],
    body: `The simple average of daily share volume over the last 20 bars. Setting a floor drops thin names that would be hard to trade. Datasets without volume treat it as zero, so any floor hides them.`,
    related: ['filters'],
  },
  {
    id: 'market-cap',
    title: 'Market cap',
    kind: 'screen',
    aliases: ['Market cap', 'market-cap'],
    body: `Latest close times shares outstanding. It is only known when the dataset carries shares outstanding, so with a floor set, names with an unknown cap are dropped and the lists can shrink more than expected. Leave it on "Any" for datasets without that field.`,
    related: ['filters'],
  },
  {
    id: 'min-price',
    title: 'Min price',
    kind: 'screen',
    body: `Drops names whose latest close is below the floor. A quick way to skip penny stocks whose [[ema|EMAs]] stack for reasons that have little to do with trend.`,
    related: ['filters'],
  },
  {
    id: 'sector',
    title: 'Sector',
    kind: 'screen',
    body: `Keeps one sector as labelled in the [[data-source]]. The list of sectors comes from the data itself, so a synthetic universe has made-up ones.`,
    related: ['filters'],
  },
  {
    id: 'ema200-slope',
    title: '200-EMA slope',
    kind: 'screen',
    aliases: ['200-EMA slope', '200-EMA rising', 'slope filter'],
    body: `Requires the 200-day [[ema|EMA]] to be higher today than it was 21, 63 or 105 trading days ago, roughly 1, 3 or 5 months. A stacked [[fan]] with a falling 200 is usually a bounce inside a longer downtrend; a rising 200 says the long trend agrees.

On by default at 1 month, which is the usual minimum. The [[backtest]] applies the same test on each fill bar.`,
    related: ['filters', 'step-ema-slope'],
  },

  // ---------------------------------------------------------------- strategy
  {
    id: 'strategy',
    title: 'Strategy',
    kind: 'strategy',
    aliases: ['strategy', 'strategies', 'preset', 'presets'],
    body: `An ordered list of [[step|steps]] plus three trade rows: [[entry]], [[stop]] and [[exit]]. The engine walks a name's bars and advances through the steps in order; when the last step fires, the entry row decides the fill, the stop row the risk, and the exit row how the trade is managed.

Built-in presets can be edited but not overwritten; Save as keeps your version under a new name. Saved strategies live in this browser and appear in the [[entry-strategy]] picker.`,
    related: ['step', 'entry', 'stop', 'exit', 'backtest'],
  },
  {
    id: 'step',
    title: 'Step',
    kind: 'strategy',
    aliases: ['step', 'steps', 'step machine'],
    body: `One condition in a [[strategy]]. Steps fire in order; a step only starts looking once the previous one has fired, and the whole machine resets to step 1 when a [[hold]] breaks or a step's [[max-wait]] runs out.

How a step consumes bars depends on its kind: [[step-kind-candle|candle]], [[step-kind-instant|instant]], [[step-kind-guard|guard]] or [[step-kind-tracker|tracker]]. Each fired step leaves a mark on the trade chart at the price it fired.`,
    related: ['step-kind-candle', 'step-kind-instant', 'step-kind-guard', 'step-kind-tracker', 'hold', 'max-wait'],
  },
  {
    id: 'step-kind-candle',
    title: 'Candle step',
    kind: 'strategy',
    aliases: ['candle step', 'candle steps'],
    body: `A [[step]] that describes the bar itself, like an [[step-ema-tag|EMA tag]] or a [[step-reversal-candle|reversal candle]]. It consumes the bar: at most one candle step fires per bar, so two candle steps in a row always land on different bars.`,
    related: ['step', 'step-kind-instant'],
  },
  {
    id: 'step-kind-instant',
    title: 'Instant step',
    kind: 'strategy',
    aliases: ['instant step', 'instant steps'],
    body: `A [[step]] about an indicator state rather than a bar shape, like [[step-fan-up]] or [[step-ema-cross]]. If it is already true on the bar the previous step fired, it fires on that same bar; otherwise it waits for the first bar where it becomes true.`,
    related: ['step', 'step-kind-candle'],
  },
  {
    id: 'step-kind-guard',
    title: 'Guard step',
    kind: 'strategy',
    aliases: ['guard step', 'guard steps', 'guards'],
    body: `A [[step]] that must be true on the very bar the previous step fired. If it is not, that firing is cancelled and the machine drops back to the nearest earlier [[step-kind-candle|candle step]] to try again. Guards never wait. [[step-macd-favorable]] and [[step-ema-slope]] are guards.`,
    related: ['step', 'step-macd-favorable', 'step-ema-slope'],
  },
  {
    id: 'step-kind-tracker',
    title: 'Tracker step',
    kind: 'strategy',
    aliases: ['tracker step', 'tracker'],
    body: `A [[step]] that fires immediately and then keeps state while later steps wait. The swing-mode [[step-pullback]] is the tracker: it records the swing high and counts lower lows under it, cancelling the setup when there are too many.`,
    related: ['step', 'step-pullback'],
  },
  {
    id: 'hold',
    title: 'Hold as an invariant',
    kind: 'strategy',
    aliases: ['hold', 'held', 'held step', 'a hold breaks', 'held step breaks'],
    body: `Once a held [[step]] has fired, its condition must keep being true on every later bar while the rest of the strategy waits. The moment it breaks, the machine resets to step 1. Typical use: hold [[step-fan-up]] so a pullback setup is thrown away if the [[fan]] falls apart before the trigger.

Only steps that describe a state can be held ([[step-fan-up]], [[step-ema-cross]]); candle shapes cannot.`,
    related: ['step', 'max-wait'],
  },
  {
    id: 'max-wait',
    title: 'Max wait',
    kind: 'strategy',
    aliases: ['max wait', 'Max wait'],
    body: `How many bars a [[step]] may wait after the previous step fired before the setup is abandoned and the machine resets. Blank means forever, which is fine when an earlier [[hold]] bounds the setup instead.

A [[step-pullback|pullback run]] with "next step on the very next bar" forces the following step's max wait to 1.`,
    related: ['step', 'hold'],
  },

  // ---------------------------------------------------------------- step types
  {
    id: 'step-fan-up',
    title: 'EMA fan up',
    kind: 'step',
    aliases: ['EMA fan up', 'fan up'],
    body: `An [[step-kind-instant|instant step]] that is true while the chosen stack holds: the [[fan|full fan]] (18 > 50 > 100 > 200) or the [[slow-fan]] (50 > 100 > 200). Usually the first step of a strategy and usually [[hold|held]], so the setup dies with the trend. Its mark sits on the 50-EMA.`,
    related: ['fan', 'slow-fan', 'hold'],
  },
  {
    id: 'step-fan-onset',
    title: 'Fan onset',
    kind: 'step',
    aliases: ['Fan onset', 'fan onset'],
    body: `A [[step-kind-candle|candle step]] that fires on the first bar a name's fan status changes into the chosen state: stacked (the [[fan]] just formed) or near (it just became [[fan-near|close to the fan]]). Because it needs the previous bar to be different, it fires exactly once per transition. The baseline preset is this single step.`,
    related: ['fan', 'fan-near'],
  },
  {
    id: 'step-ema-cross',
    title: 'EMA cross',
    kind: 'step',
    aliases: ['EMA cross', 'ema cross', 'cross'],
    body: `An [[step-kind-instant|instant step]] that fires on the bar a fast [[ema|EMA]] crosses through a slow one, up or down, optionally only while the [[slow-fan]] or [[fan|full fan]] holds. Crossing up means the fast average was at or below the slow one on the previous bar and above it now.

Held, it keeps the fast average on the crossed side, checked one bar late so the opposite cross can fire before the hold breaks. The Bunn continuation preset uses an adverse 18-under-50 cross as its held first step.`,
    related: ['ema', 'slow-fan', 'hold'],
  },
  {
    id: 'step-pullback',
    title: 'Pullback',
    kind: 'step',
    aliases: ['Pullback', 'pullback', 'pullback run', 'pullback swing', 'swing mode'],
    body: `Two modes. Run is a [[step-kind-candle|candle step]]: a stretch of at least N bars with lower highs and/or lower lows, whose last bar's low or close is under a chosen [[ema|EMA]]. While the next step waits, further lower bars extend the run; with "next step on the very next bar" the trigger must follow immediately.

Swing is a [[step-kind-tracker|tracker]]: it fires at once, records the swing high, and cancels the setup after more than the allowed number of lower lows (0 to 2). Re-arm after a new swing high lets a fresh high restart the count. The tag presets use swing mode.`,
    related: ['step-kind-candle', 'step-kind-tracker', 'setup-low'],
  },
  {
    id: 'step-price-vs-ema',
    title: 'Price vs EMA',
    kind: 'step',
    aliases: ['Price vs EMA'],
    body: `A [[step-kind-candle|candle step]] that fires when a bar's high, close or low is above or below a chosen [[ema|EMA]]. The default new strategy ends with "high above the 18-EMA" as the breakout trigger after a [[step-pullback|pullback run]].`,
    related: ['ema', 'step-pullback'],
  },
  {
    id: 'step-ema-tag',
    title: 'EMA tag',
    kind: 'step',
    aliases: ['EMA tag', '18-EMA tag', '50-EMA tag', 'tag', 'tags the'],
    body: `A [[step-kind-candle|candle step]] for the classic pullback entry: the bar's low touches or dips through the 18- or 50-[[ema|EMA]] and the close comes back above it. "Also trades through the 18" asks the same bar to have crossed the 18 as well, so the pullback was deep enough to test both averages (the dual-EMA preset).

Confirmation "close back above is enough" fires on the touch; "2-bar reversal or rejection wick" additionally wants a [[reversal-2bar|two-bar reversal]] or an [[ma-bounce|upper-40% close]] on the bar.`,
    related: ['ema', 'reversal-2bar', 'ma-bounce', 'step-pullback'],
  },
  {
    id: 'step-reversal-candle',
    title: 'Reversal candle on an EMA',
    kind: 'step',
    aliases: ['Reversal candle', 'reversal candle', 'reversal on the'],
    body: `A [[step-kind-candle|candle step]] that fires when a bar reverses off any of the chosen averages (50, 100, 200). Two shapes: the [[bunn-reversal]] (body above the average, tail through it and below the prior low) or the [[ma-bounce|rejection wick]] (close back above the average in the upper 40% of the bar).

"Latest reversal wins while waiting" lets a later reversal replace the mark while the next step is still waiting, which the Bunn continuation preset relies on.`,
    related: ['bunn-reversal', 'ma-bounce', 'bunn'],
  },
  {
    id: 'step-macd-favorable',
    title: '18–50 MACD favorable',
    kind: 'step',
    aliases: ['MACD favorable', 'MACD favorable step'],
    body: `A [[step-kind-guard|guard]]: the bar the previous step fired on must have the [[macd-18-50]] line above its signal with a histogram at or above zero, otherwise that firing is cancelled. It filters entries on momentum without waiting for anything. To act on the MACD after entry instead, use [[macd-exit]].`,
    related: ['macd-18-50', 'step-kind-guard', 'macd-exit'],
  },
  {
    id: 'step-ema-slope',
    title: 'EMA rising',
    kind: 'step',
    aliases: ['EMA rising', 'ema rising', '50 still rising'],
    body: `A [[step-kind-guard|guard]]: the chosen [[ema|EMA]] must be higher on the trigger bar than it was N bars ago. The tag presets end with "50-EMA rising over 5 bars" so a tag against a flattening 50 is not taken. The [[ema200-slope]] filter is the same idea applied to the 200 over months.`,
    related: ['ema', 'step-kind-guard', 'ema200-slope'],
  },

  // ---------------------------------------------------------------- candle shapes
  {
    id: 'reversal-2bar',
    title: 'Two-bar reversal',
    kind: 'step',
    aliases: ['two-bar reversal', '2-bar reversal'],
    body: `A down bar followed by an up bar with a lower high: the previous bar closed below its open, this bar closes above its open, and this bar's high is under the previous high. A small sign that selling ran out inside the pullback. One of the two confirmations an [[step-ema-tag|EMA tag]] can ask for.`,
    related: ['step-ema-tag', 'ma-bounce'],
  },
  {
    id: 'ma-bounce',
    title: 'Rejection wick (MA bounce)',
    kind: 'step',
    aliases: ['rejection wick', 'MA bounce', 'upper 40%'],
    body: `A bar that dipped to or under the average, closed back at or above it, closed up, and finished in the top 40% of its own range. The long lower tail is the "rejection". Used as an [[step-ema-tag|EMA tag]] confirmation and as one shape of [[step-reversal-candle]].`,
    related: ['step-ema-tag', 'step-reversal-candle', 'bunn-reversal'],
  },
  {
    id: 'bunn-reversal',
    title: 'Bunn reversal',
    kind: 'step',
    aliases: ['Bunn reversal', 'bunn reversal'],
    body: `The bounce shape from the [[bunn|Bunn]] presets: the bar opens and closes above the [[ema|EMA]] being tested, but its low pokes through the average and under the previous bar's low. The body stayed on the right side while the tail shook out the prior low.

The Bunn presets then place a [[buy-stop]] 2¢ above this bar's high and the [[stop]] 2¢ under its low, so [[r|1R]] is the bar's height plus 4¢.`,
    related: ['bunn', 'step-reversal-candle', 'buy-stop'],
  },
  {
    id: 'bunn',
    title: 'Bunn presets',
    kind: 'strategy',
    aliases: ['Bunn', 'Bunn bounce', 'Bunn continuation', 'the penny', '2¢'],
    body: `Two presets that follow the course-style bounce rules rather than the tag-and-close entries. Bunn bounce: [[slow-fan]] held, then a [[bunn-reversal]] on the 50, 100 or 200. Bunn continuation: the 18 crosses adversely under the 50, a reversal on the 100 or 200, then the 18 crossing back up with the [[fan|full fan]] restored.

Both fill with a [[buy-stop]] 2¢ above the trigger high and stop 2¢ under the marked low, no [[atr|ATR]] pad. The 2¢ is the "penny" offset used throughout.`,
    related: ['bunn-reversal', 'buy-stop', 'step-reversal-candle'],
  },

  // ---------------------------------------------------------------- trade rows
  {
    id: 'entry',
    title: 'Entry (fill)',
    kind: 'trade',
    aliases: ['Entry', 'entry row', 'the fill', 'fill'],
    body: `How the [[strategy]] gets in once its last [[step]] fires on the trigger bar. Two fills: "Buy the trigger close" fills at that bar's close; "Buy stop above the trigger high" rests a [[buy-stop]] and fills only if a later bar trades through it.

The Entry column in the lists and the entry mark on the chart show the resulting price.`,
    related: ['buy-stop', 'trigger-bar', 'stop', 'exit'],
  },
  {
    id: 'buy-stop',
    title: 'Buy stop',
    kind: 'trade',
    aliases: ['buy stop', 'Buy stop', 'resting buy stop'],
    body: `A pending order at the trigger bar's high plus an offset (the Bunn penny, 2¢). From the next bar on, the first bar whose high reaches it fills the trade there; a bar that gaps over it fills at that bar's open. Price has to prove itself by moving up first.

Max wait (bars) caps how long the order rests. Blank means it waits until a [[hold|held step]] breaks.`,
    related: ['entry', 'trigger-bar', 'bunn'],
  },
  {
    id: 'trigger-bar',
    title: 'Trigger bar',
    kind: 'trade',
    aliases: ['trigger bar', 'trigger high', 'trigger low', 'the trigger'],
    body: `The bar on which the strategy's last [[step]] fired. Its close, high and low are what the [[entry]] and [[stop]] rows refer to as "the trigger". With a [[buy-stop]] the fill can land several bars later; the trigger bar does not move.`,
    related: ['entry', 'stop'],
  },
  {
    id: 'stop',
    title: 'Stop (protective)',
    kind: 'trade',
    aliases: ['Stop', 'protective stop', 'the stop', 'stop row', 'structural stop'],
    body: `Where the trade is wrong. The stop row builds it from an anchor low, optionally capped under the 50-[[ema|EMA]], then pads it with a fraction of [[atr|ATR(14)]] and a fixed offset. The distance from fill to stop is [[r|1R]], the unit every result is measured in.

Anchors: [[setup-low]] (lowest low of the whole setup), [[trigger-bar|trigger low]], or the low of the bar a chosen step marked. Trades that gap through the stop exit at the open, not at the stop.`,
    related: ['stop-anchor', 'atr', 'r', 'breakeven', 'trail-ema'],
  },
  {
    id: 'stop-anchor',
    title: 'Stop anchor',
    kind: 'trade',
    aliases: ['stop anchor', 'anchor low'],
    body: `The low the [[stop]] is measured from.

- Lowest low of the setup: the [[setup-low]], scanned from the swing high (or the first candle mark) to the fill.
- The trigger bar's low: just the [[trigger-bar]].
- The low of a step's bar: the bar a particular [[step]] marked, for example the reversal bar in Bunn continuation.

"Also under the 50-EMA" pushes the anchor down to the 50-EMA on the fill bar when the average is lower.`,
    related: ['stop', 'setup-low', 'trigger-bar'],
  },
  {
    id: 'setup-low',
    title: 'Setup low',
    kind: 'trade',
    aliases: ['setup low', 'lowest low of the setup', 'setup_low'],
    body: `The lowest low between the start of the setup and the fill. The setup starts at the swing high a [[step-pullback|swing tracker]] recorded, or at the first [[step-kind-candle|candle step]]'s bar when there is no tracker. It is the default [[stop-anchor]]: the whole pullback has to fail before the trade is stopped.`,
    related: ['stop-anchor', 'step-pullback'],
  },
  {
    id: 'r',
    title: 'R (risk unit)',
    kind: 'trade',
    aliases: ['1R', 'R multiple', 'R-multiple', 'risk unit', 'realized R', 'unrealized R', 'R (risk)'],
    body: `One R is the distance from the fill to the initial [[stop]], per share. Everything after is quoted in multiples of it: a trade that exits 2R up made twice its initial risk; a stopped trade is −1R. The list column shows R in price and as a percent of the entry.

Sizing in the [[swing-account]] risks a fixed percent of equity per 1R, so a wide stop simply means fewer shares.`,
    related: ['stop', 'target', 'expectancy', 'risk-per-trade'],
  },
  {
    id: 'exit',
    title: 'Exit',
    kind: 'trade',
    aliases: ['Exit', 'exit row', 'exit management', 'trade management'],
    body: `How an open trade is managed after the fill. The exit row picks a [[target]] (a fixed [[r|R]] multiple, the [[target-window]], or a trailing stop under an [[trail-ema|EMA]] or [[trail-pivot|pivots]]), an optional [[breakeven]] move, a [[max-hold]], the [[macd-exit]] and the [[fan-exit]]. The first rule to trigger closes the trade, and the [[exit-reasons|reason]] is recorded.`,
    related: ['target', 'breakeven', 'max-hold', 'macd-exit', 'fan-exit'],
  },
  {
    id: 'target',
    title: 'Target',
    kind: 'trade',
    aliases: ['Target', 'target', 'target R', 'hard target'],
    body: `Where a winning trade takes profit. Fixed choices exit at 2, 3 or 4 [[r|R]] the first bar the high reaches it. "2.5–3R window" is the [[target-window]]. The trail options replace the target with a moving [[stop]]: [[trail-ema|trail the 50- or 18-EMA]] or [[trail-pivot|trail pivots]], letting a runner go as far as it will.`,
    related: ['r', 'target-window', 'trail-ema', 'trail-pivot'],
  },
  {
    id: 'target-window',
    title: '2.5–3R target window',
    kind: 'trade',
    aliases: ['target window', '2.5–3R', '2.5-3R', '2.5–3R exit window', 'course target window'],
    body: `The course rule for taking profit: sell somewhere between 2.5 and 3 times the initial risk. The simulation exits at the floor, 2.5[[r|R]], the first bar the high reaches it, so the results are the conservative end of that window. The Target window column in the entries list shows the price range that corresponds to.`,
    related: ['target', 'r'],
  },
  {
    id: 'trail-ema',
    title: 'Trail an EMA',
    kind: 'trade',
    aliases: ['trail the 50', 'trail the 18', 'Trail 50-EMA', 'Trail 18-EMA', 'trailed trade', 'trailing'],
    body: `After the [[breakeven]] move, the [[stop]] follows the chosen [[ema|EMA]] (50 or 18) upward and the trade exits when a close falls under it. There is no fixed [[target]], so a strong trend can run for many [[r|R]]; the cost is giving back the distance from the high to the average. While trailing, the [[macd-exit]] is ignored.`,
    related: ['target', 'breakeven', 'trail-pivot'],
  },
  {
    id: 'trail-pivot',
    title: 'Trail pivots',
    kind: 'trade',
    aliases: ['Trail pivots', 'trail pivots', 'trail 2¢ under confirmed pivot lows'],
    body: `After entry, each newly confirmed [[pivot-low]] moves the [[stop]] to 2¢ under it, never down. The trade exits when price trades through that level. It hugs price more closely than [[trail-ema|trailing an EMA]] and overrides it when both are set. The [[macd-exit]] is ignored while trailing.`,
    related: ['pivot-low', 'trail-ema', 'stop'],
  },
  {
    id: 'breakeven',
    title: 'Breakeven at 1R',
    kind: 'trade',
    aliases: ['breakeven', 'Move stop to breakeven'],
    body: `Once the trade shows [[r|1R]] of open profit (a high one R above the fill), the [[stop]] moves up to the entry price. From then on the worst outcome is roughly flat. It is also the point where [[trail-ema|EMA trailing]] starts.`,
    related: ['stop', 'r', 'trail-ema'],
  },
  {
    id: 'max-hold',
    title: 'Max hold',
    kind: 'trade',
    aliases: ['Max hold', 'max hold'],
    body: `A time stop: if the trade is still open after this many bars it is closed at that bar's close, whatever the [[r|R]]. "Until exit" turns it off and leaves it to the [[target]], [[stop]] and the other [[exit]] rules.`,
    related: ['exit'],
  },
  {
    id: 'macd-exit',
    title: 'MACD exit',
    kind: 'trade',
    aliases: ['MACD exit'],
    body: `Closes the trade at the close of the first bar where the [[macd-18-50]] line drops below its signal, a momentum flip. It only applies with a fixed [[target]] or the [[target-window]]; a [[trail-ema|trailed]] trade ignores it. To filter entries on the MACD instead, add the [[step-macd-favorable]] guard step.`,
    related: ['macd-18-50', 'step-macd-favorable', 'exit'],
  },
  {
    id: 'fan-exit',
    title: 'Fan exit',
    kind: 'trade',
    aliases: ['Fan exit', 'fan exit', 'fan breaks', 'stack breaks'],
    body: `Flattens the trade at the close of the first bar where the chosen stack is no longer in order: the [[slow-fan]] (50 > 100 > 200) or the [[fan|full fan]] (18 > 50 > 100 > 200). Full is stricter and exits on the first dip of the 18 under the 50; slow tolerates that and only exits when the trend itself unwinds.`,
    related: ['fan', 'slow-fan', 'exit'],
  },
  {
    id: 'exit-reasons',
    title: 'Exit reasons',
    kind: 'backtest',
    aliases: ['exit reasons', 'Exits:'],
    body: `Why each closed trade ended: the [[stop]] (including after [[breakeven]]), a fixed [[target]] or the [[target-window]], a trailing [[trail-ema|EMA]] or [[trail-pivot|pivot]] stop, the [[macd-exit]], the [[fan-exit]], the [[max-hold]], or the dataset simply ending. The counts tell you which rule is really doing the work.`,
    related: ['exit', 'hit-target'],
  },

  // ---------------------------------------------------------------- backtest
  {
    id: 'backtest',
    title: 'Backtest',
    kind: 'backtest',
    aliases: ['Backtest', 'backtest', 'backtests'],
    body: `Replays one [[strategy]] over every name in the [[universe]] and reports the simulated trades: per-trade statistics in [[r|R]], a [[swing-account]] cash book, naive [[forward-returns]] and the [[indicators-at-entry]] table. Long only, no costs, slippage or gaps, and no discretion, so treat it as a check of the rules rather than a promise.

The volume, cap and [[ema200-slope]] floors are the same as the [[filters|filter bar]] and are tested on each fill bar. Click a trade row to open its chart with every step's mark.`,
    related: ['strategy', 'win-rate', 'expectancy', 'swing-account'],
  },
  {
    id: 'backtest-entries',
    title: 'Entries (backtest)',
    kind: 'backtest',
    body: `Total fills the [[strategy]] produced across the [[universe]], and how many distinct names they came from. A high count from few names means one stock kept re-triggering.`,
    related: ['backtest'],
  },
  {
    id: 'win-rate',
    title: 'Win rate',
    kind: 'backtest',
    aliases: ['Win rate', 'win rate'],
    body: `Share of closed trades that ended above their entry, over the number of trades shown under it. On its own it says little: a trailing [[exit]] wins less often but wins bigger. Read it next to [[expectancy]].`,
    related: ['expectancy', 'hit-target'],
  },
  {
    id: 'expectancy',
    title: 'Expectancy',
    kind: 'backtest',
    aliases: ['Expectancy', 'expectancy'],
    body: `The average result per trade in [[r|R]]: what one unit of risk earned on average, wins and losses together. Positive means the rules made money before costs. The median under it is less swayed by a few huge runners, so a big gap between the two means the average leans on outliers.`,
    related: ['r', 'win-rate'],
  },
  {
    id: 'hit-target',
    title: 'Hit target',
    kind: 'backtest',
    aliases: ['Hit target'],
    body: `Percent of closed trades that exited at the fixed [[target]] or the [[target-window]] rather than by a stop, a trail, the [[macd-exit]], [[fan-exit]] or [[max-hold]]. Always low for a trailing exit, since a trailed trade has no target to hit. Average hold is the mean number of bars from fill to exit.`,
    related: ['target', 'exit-reasons'],
  },
  {
    id: 'swing-account',
    title: 'Swing account',
    kind: 'backtest',
    aliases: ['Swing account', 'swing account', 'cash book'],
    body: `The same fills replayed as a single cash account with real position sizes, in date order, over the last N months of the dataset. Each fill is sized so the stop loses [[risk-per-trade]] percent of current equity, subject to [[max-names]] and the cash on hand. It runs until the [[backtest-window|window]] ends or the account is ruined.

End equity, return and [[max-drawdown]] describe that account; [[taken-skipped]] says how many signals it could actually take.`,
    related: ['risk-per-trade', 'max-names', 'backtest-window', 'max-drawdown'],
  },
  {
    id: 'risk-per-trade',
    title: 'Risk per trade',
    kind: 'backtest',
    aliases: ['Risk / trade', 'risk per trade'],
    body: `Percent of the [[swing-account]]'s current equity lost if a trade hits its initial [[stop]]. Shares = that dollar amount divided by [[r|1R]] per share, rounded down. Because it is a percent of current equity, sizing grows after wins and shrinks after losses.`,
    related: ['swing-account', 'r'],
  },
  {
    id: 'max-names',
    title: 'Max names',
    kind: 'backtest',
    aliases: ['Max names', 'max names'],
    body: `The most positions the [[swing-account]] may hold at once. Signals arriving while it is full are skipped and counted under [[taken-skipped]]. Lower values keep the equity curve calmer; higher ones let the account take more of what the strategy found.`,
    related: ['swing-account', 'taken-skipped'],
  },
  {
    id: 'backtest-window',
    title: 'Window (months)',
    kind: 'backtest',
    aliases: ['window', 'Window'],
    body: `The [[swing-account]] only opens trades whose fill falls in the last N months of the dataset. Trades opened inside the window may close after it. The per-trade statistics above the account are not windowed; they use every fill in the history.`,
    related: ['swing-account'],
  },
  {
    id: 'max-drawdown',
    title: 'Max drawdown',
    kind: 'backtest',
    aliases: ['Max DD', 'max drawdown', 'drawdown'],
    body: `The largest peak-to-trough fall of the [[swing-account]]'s realized equity, as a percent of the peak. Realized means it is measured after each exit, so open losses between exits are not counted; the true intra-trade drawdown is somewhat worse.`,
    related: ['swing-account', 'equity-curve'],
  },
  {
    id: 'equity-curve',
    title: 'Equity after each exit',
    kind: 'backtest',
    aliases: ['equity curve', 'Equity after each exit'],
    body: `The [[swing-account]]'s cash plus closed results, plotted at every exit in order. A curve that climbs in steps with shallow dips is what you want; a single spike followed by a slide usually means one outlier and a lot of noise.`,
    related: ['swing-account', 'max-drawdown'],
  },
  {
    id: 'taken-skipped',
    title: 'Taken and skipped',
    kind: 'backtest',
    aliases: ['Taken', 'skipped'],
    body: `How many of the strategy's signals inside the [[backtest-window|window]] the [[swing-account]] actually traded. Skipped "no cash/size" means the account could not fund even one share at the required risk; "max names" means the [[max-names]] cap was full that day. A large skipped count means the account results describe a subset of the strategy.`,
    related: ['swing-account', 'max-names'],
  },
  {
    id: 'ruin',
    title: 'Ruin',
    kind: 'backtest',
    aliases: ['ruin', 'ruined'],
    body: `The [[swing-account]] stops early when it can no longer size a position at all: equity has fallen so far that the [[risk-per-trade]] amount does not buy one share of the next signal. The account section is marked ruined and the return is measured at that point.`,
    related: ['swing-account'],
  },
  {
    id: 'forward-returns',
    title: 'Forward returns from entry',
    kind: 'backtest',
    aliases: ['Forward returns', 'forward returns'],
    body: `What price did after each fill if you ignore the [[stop]] and [[exit]] entirely: the average percent move from the fill to the close 5, 10, 20 and 40 bars later, with the share of fills that were up at each horizon. It separates the quality of the entry from the quality of the trade management.`,
    related: ['backtest', 'entry'],
  },
  {
    id: 'indicators-at-entry',
    title: 'MACD / Stoch RSI at entry',
    kind: 'backtest',
    aliases: ['MACD / Stoch RSI at entry'],
    body: `A snapshot of two textbook indicators on each fill bar, bucketed against the trade's realized [[r|R]]: the classic 12/26/9 MACD (not the [[macd-18-50]]) and the stochastic RSI's %K and %D. Use it to see whether entries taken with momentum already stretched fared worse than the rest.`,
    related: ['macd-18-50', 'backtest'],
  },

  // ------------------------------------------------------- price action (chart)
  {
    id: 'price-action',
    title: 'Price-action patterns',
    kind: 'pattern',
    aliases: ['price action', 'price-action patterns'],
    body: `The Patterns menu over the chart draws what the bars themselves are saying, on top of the candles. Each detector is independent: turn on only what you are reading for, and the number beside each one counts what is inside the window you are looking at.

Detection runs over the whole history, not the visible window, so zooming and panning never change what a pattern is. Everything is confirmed-only — a [[pa-pivot|pivot]] is not drawn until the bars that confirm it have printed — so nothing on the chart is knowledge you would not have had on the day.

Hover a bar for the crosshair readout: it lists every pattern whose span covers that bar.`,
    related: ['pa-pivot', 'pa-structure', 'pa-pullback', 'detail-dock'],
  },
  {
    id: 'pa-pivot',
    title: 'Pivots (swing points)',
    kind: 'pattern',
    aliases: ['swing pivot', 'swing pivots', 'pivot high', 'long pivot', 'short pivot'],
    body: `A pivot high is a bar whose high beats the highs on both sides of it; a pivot low is the mirror. How many bars each side is what makes one significant: the chart draws a long pivot (3 bars either side) as a solid triangle and a short one (1 bar) as a small dot, so the higher-timeframe swings stand out from the noise between them.

Pivots are what [[pa-structure|swing structure]] is read from, where trendlines and support/resistance get anchored, and where a [[stop]] logically sits — beyond the swing, not beside it. A tie does not count: a bar sharing its high with a neighbour is nobody's pivot.

The backtester's [[pivot-low]] is a different, stricter rule with its own confirmation, used for trailing; this one is for reading the chart.`,
    related: ['pa-structure', 'pivot-low', 'stop'],
  },
  {
    id: 'pa-structure',
    title: 'HH / HL / LH / LL',
    kind: 'pattern',
    aliases: ['higher high', 'higher low', 'lower high', 'lower low', 'swing structure'],
    body: `Every long [[pa-pivot|pivot]] labelled against the last pivot of its own kind, joined by a dashed zigzag. Higher highs with higher lows is an uptrend; lower highs with lower lows is a downtrend — this is the definition of trend, not an indicator of it.

The useful moment is the break in the sequence: a lower low inside a run of HH/HL, or a lower high that stops a rally, is the first evidence the trend has changed hands. Read it before the [[ema|EMAs]], which lag it by construction.`,
    related: ['pa-pivot', 'pa-pullback', 'ema'],
  },
  {
    id: 'pa-pullback',
    title: 'Pullbacks',
    kind: 'pattern',
    aliases: ['pullback band'],
    body: `A run of at least two bars of lower highs *and* lower lows while the trend is up — drawn as a tinted band over the bars it covers. It is a breather inside the move, not a turn: the point of marking it is to enter with the trend at a better price, once the run stalls (a higher low, or the minor downtrend line breaking).

Trend context is the 20 vs 50 [[ema|EMA]] order at the bar the run starts from, so the same three red bars in a downtrend are marked as a counter-trend rally instead, the other colour.

The [[step-pullback]] step is the strategy-builder version of the same idea, with its own EMA condition and its own bar count.`,
    related: ['pa-structure', 'step-pullback', 'ema'],
  },
  {
    id: 'pa-reversal-2bar',
    title: 'Two-bar reversal (chart)',
    kind: 'pattern',
    body: `Two bars of opposite character at a turning point: a bar that makes a new extreme over the last five, immediately followed by a bar the other way that closes back through at least half of it. Exhaustion — whoever pushed to the extreme could not hold it for a single bar.

The entry is conventionally the break of the second bar's extreme, with the [[stop]] beyond the pair's extreme, which is the price the marker points at.

Note this is a stricter rule than the builder's [[reversal-2bar|two-bar reversal]] step, which only asks for a down bar then an up bar with a lower high. The chart wants the new extreme and the retracement too.`,
    related: ['reversal-2bar', 'pa-reversal-3bar', 'stop'],
  },
  {
    id: 'pa-reversal-3bar',
    title: 'Three-bar reversal',
    kind: 'pattern',
    aliases: ['three-bar reversal', '3-bar reversal'],
    body: `The filtered version of the [[pa-reversal-2bar|two-bar turn]]: a bar makes the extreme, a second bar pauses on it (a small body inside a narrower range), and a third closes back through the first bar's opposite end.

The middle bar is what buys the extra confidence — the move did not merely bounce, it stopped, held, and then reversed. Fewer signals than the two-bar version, and fewer of them fail.`,
    related: ['pa-reversal-2bar', 'pa-doji'],
  },
  {
    id: 'pa-pin-bar',
    title: 'Pin bar',
    kind: 'pattern',
    aliases: ['pin bar', 'rejection candle'],
    body: `A bar with a long wick and a small body: price was pushed to an extreme within the bar and rejected outright. A bullish pin has the long wick below (buyers stepped in under the market); a bearish pin has it above.

The chart wants the signal wick to be at least 55% of the range, the opposite wick under 25%, and the body under 35% — and the bar to be worth looking at at all, which is why bars smaller than a quarter of [[atr|ATR]] are skipped. Colour is not part of it.

Worth trading at a level — a [[pa-pivot|pivot]], an [[ema|EMA]], the edge of a range — and worth ignoring in the middle of nowhere. The builder's [[ma-bounce|rejection wick]] is the same shape pinned to an average.`,
    related: ['ma-bounce', 'pa-pivot', 'atr'],
  },
  {
    id: 'pa-engulfing',
    title: 'Engulfing bar',
    kind: 'pattern',
    aliases: ['engulfing bar', 'engulfing'],
    body: `A bar whose body completely covers the previous bar's body, in the opposite direction: bullish when an up bar swallows the prior down body, bearish the other way. One session undid the whole of the last one — a decisive change of hands rather than a drift.

The chart brackets both bars and marks the pair's extreme, which is where a [[stop]] would go.`,
    related: ['pa-outside-bar', 'pa-pin-bar', 'stop'],
  },
  {
    id: 'pa-inside-bar',
    title: 'Inside bar',
    kind: 'pattern',
    aliases: ['inside bar', 'mother bar'],
    body: `A bar whose whole range sits inside the previous bar's — the previous bar being the "mother bar". Range contracting means disagreement contracting: nobody took price anywhere new.

It is traded as the break of the mother bar's high or low rather than on its own, and it is a continuation pattern as often as a turn — in a trend, a pause is usually just a pause. Several in a row is compression, and compression tends to resolve with an [[pa-outside-bar|expansion bar]].`,
    related: ['pa-outside-bar', 'pa-failed-break'],
  },
  {
    id: 'pa-outside-bar',
    title: 'Outside bar',
    kind: 'pattern',
    aliases: ['outside bar'],
    body: `The opposite of an [[pa-inside-bar|inside bar]]: a range that covers the previous bar's high and its low. Both sides were tested inside one session, so it is an expansion of volatility whichever way it closes — and where it closes is what decides whether it read as a reversal or a breakout. The chart takes its colour from the close for exactly that reason.`,
    related: ['pa-inside-bar', 'pa-engulfing', 'atr-pct'],
  },
  {
    id: 'pa-doji',
    title: 'Doji',
    kind: 'pattern',
    aliases: ['doji'],
    body: `Open and close all but equal — the bar went somewhere and came back. Balance, not direction.

Where it prints is the whole of its meaning: at the end of an extended move it is a warning that the move has stopped paying, and it is the classic middle bar of a [[pa-reversal-3bar|three-bar reversal]]. Inside a range it is noise. Bars narrower than a quarter of [[atr|ATR]] are skipped so a quiet session does not litter the chart.`,
    related: ['pa-reversal-3bar', 'atr'],
  },
  {
    id: 'pa-failed-break',
    title: 'Failed breakout',
    kind: 'pattern',
    aliases: ['failed breakout', 'false break'],
    body: `Price takes out the 20-bar high (or low), then closes back inside it within three bars. The chart draws the level that gave way as a dashed line and brackets the attempt.

Everyone who bought the break is offside at once, and their stops sit just the other side of the level — which is why the fade in the opposite direction is a higher-probability trade than the breakout was, with the [[stop]] just beyond the failed extreme.

Compression before the attempt — a run of [[pa-inside-bar|inside bars]] — makes both the break and its failure more likely to matter.`,
    related: ['pa-inside-bar', 'pa-pivot', 'stop'],
  },
];

export const TOPICS: ReadonlyMap<string, HelpTopic> = new Map(TOPIC_LIST.map((t) => [t.id, t]));

export function topicOf(id: string): HelpTopic | undefined {
  return TOPICS.get(id);
}

export const HELP_INDEX: LinkIndex = buildLinkIndex(TOPIC_LIST);

/** Topic id for a strategy step type, e.g. 'ema_tag' → 'step-ema-tag'. */
export function stepTopic(type: string): string {
  return `step-${type.replace(/_/g, '-')}`;
}

/** Topic id for a step kind, e.g. 'guard' → 'step-kind-guard'. */
export function stepKindTopic(kind: string): string {
  return `step-kind-${kind}`;
}

/** Problems a test can assert on: dangling links, duplicate ids or aliases. */
export function validateGlossary(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const aliases = new Map<string, string>();
  for (const t of TOPIC_LIST) {
    if (ids.has(t.id)) problems.push(`duplicate id ${t.id}`);
    ids.add(t.id);
    for (const a of t.aliases ?? []) {
      const key = a.toLowerCase();
      const prev = aliases.get(key);
      if (prev && prev !== t.id) problems.push(`alias "${a}" on both ${prev} and ${t.id}`);
      aliases.set(key, t.id);
    }
  }
  for (const t of TOPIC_LIST) {
    for (const id of explicitLinks(t.body)) {
      if (!ids.has(id)) problems.push(`${t.id} links to unknown ${id}`);
      if (id === t.id) problems.push(`${t.id} links to itself`);
    }
    for (const id of t.related ?? []) {
      if (!ids.has(id)) problems.push(`${t.id} relates to unknown ${id}`);
    }
  }
  return problems;
}
