// help/glossary.ts — the help topics behind every hover card.
//
// Each topic is one card. Bodies are plain prose; [[topic-id]] or
// [[topic-id|shown text]] links another topic explicitly, and any alias of a
// known topic is auto-linked the first time it appears (see link.ts). Keep
// meanings grounded in the code the card describes — the fan classifier
// (lib/fan.ts), the step registry (lib/strategy/steps.ts), the trade rows
// (lib/strategy/types.ts) and the backtest stats (lib/fanBacktest.ts).

import { buildLinkIndex, explicitLinks, type LinkIndex } from './link.ts';

export type HelpKind =
  | 'indicator' | 'fan' | 'screen' | 'strategy' | 'step' | 'trade' | 'backtest' | 'data' | 'ui';

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
    body: `Hover anything in Screenr for a moment and a card like this one explains it. Highlighted words inside a card are terms of their own: hover one to open its card on top.

Press T while a card is showing to pin it. A pinned card stays where it is, can be dragged by its title bar, and still lets you hover its highlighted terms to keep digging. Press Esc to close the most recent card, or use the × on a pinned one.`,
    related: ['fan', 'strategy', 'backtest'],
  },
  {
    id: 'search',
    title: 'Search',
    kind: 'ui',
    body: `Narrows every list to tickers or company names containing the text. It applies on top of the [[filters]] and never changes what the [[fan|fan screen]] itself computed.`,
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
    body: `The filter bar trims both lists after the [[fan]] screen has run; it never changes which names are in the fan, only which are shown. Clear filters restores the defaults, where only the [[ema200-slope]] is on.

The same volume, cap and slope floors are offered again in the [[backtest]] so the history matches what the lists show.`,
    related: ['avg-volume', 'market-cap', 'min-price', 'sector', 'ema200-slope'],
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
    aliases: ['Stoch RSI', 'MACD / Stoch RSI at entry'],
    body: `A snapshot of two textbook indicators on each fill bar, bucketed against the trade's realized [[r|R]]: the classic 12/26/9 MACD (not the [[macd-18-50]]) and the stochastic RSI's %K and %D. Use it to see whether entries taken with momentum already stretched fared worse than the rest.`,
    related: ['macd-18-50', 'backtest'],
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
