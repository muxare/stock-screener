// render.ts — turn the checked-in HTML fixtures into the PNGs the eval reads.
//
// The fixture set is built from an expected answer outwards rather than from a
// screenshot inwards (see README.md), so the images are a build product of
// `src/*.html` and this script. They are still committed: the eval has to run on
// a machine without Chrome, and a PNG of a flat table costs a few tens of
// kilobytes. This script exists so that regenerating them is mechanical and so
// that the degraded variants keep a stated relationship to their original
// instead of being whatever `sips` was typed by hand that afternoon.
//
// Two dependencies, both of them macOS-and-a-browser rather than npm: the copy of
// Chrome already on the machine, and `sips`. That trade was decided in phase D of
// docs/cca-f-learning-plan.md — this runs when a fixture changes and never in CI,
// so paying for it in node_modules would be the expensive side of the bargain.
//
// Usage:
//   node server/claude/evals/fixtures/render.ts
//
// Idempotent: every run deletes each output and re-derives it from source, so a
// half-finished run leaves nothing stale behind and two runs in a row produce the
// same bytes. The only other state is a throwaway Chrome profile under the system
// temp dir, removed on the way out — pointing Chrome at the real profile would
// fail whenever a browser window is already open.

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIPS = '/usr/bin/sips';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');

/** How long one page may take to paint before the run is called broken. */
const SHOT_TIMEOUT_MS = 30_000;
/** How often the screenshot file is polled while Chrome works. */
const POLL_MS = 150;

/** A page rendered straight from HTML. */
interface Render {
  /** File name under `src/`, without the extension; also the PNG's name. */
  id: string;
  /**
   * The window Chrome screenshots. There is no "fit to content" flag, so these
   * are the measured size of each page's card plus its margin; a window smaller
   * than the card silently crops the fixture, which is why every change here
   * ends with looking at the PNG.
   */
  width: number;
  height: number;
}

/**
 * A degraded copy of an already-rendered page.
 *
 * `sips` cannot blur, so the degradation is a round trip through a smaller
 * raster: down to `viaWidth`, then back up to the original width. That is a
 * cheap resampling blur, and — more usefully — it is the *same* degradation
 * phase C found on the real screenshots, so the two variants below sit either
 * side of the threshold C measured rather than either side of a guess.
 */
interface Derived {
  id: string;
  /** The `Render.id` this copy is made from. */
  from: string;
  viaWidth: number;
}

const RENDERS: readonly Render[] = [
  { id: 'four-positions-sek', width: 1000, height: 432 },
  { id: 'mixed-currency', width: 1000, height: 382 },
  { id: 'not-holdings', width: 660, height: 604 },
];

// Both widths were chosen by looking at the result, not by arithmetic, and both
// differ from the numbers phase D's plan text carries. That text took them from
// phase C, which degraded a *retina* capture of a real account — roughly 2400
// device pixels wide — so 260px there was a ninefold reduction. These fixtures
// are rendered at 1000px, and 260px is a fourfold one: measured on 2026-09-21,
// it leaves most digits readable and would have scored the refusal case as a
// calibration case. 160px on a 1000px source is where the glyphs genuinely stop
// resolving while the table's structure survives, which is the property phase C
// actually found. If a fixture's rendered width changes, these change with it.
const DERIVED: readonly Derived[] = [
  // Gentle: the digits survive, so the model should read them correctly and say
  // it is less sure. This measures calibration.
  { id: 'mild-blur', from: 'four-positions-sek', viaWidth: 460 },
  // Brutal: every glyph is a smudge, every row is still a row. This measures
  // refusal — every field null rather than invented.
  { id: 'unreadable', from: 'four-positions-sek', viaWidth: 160 },
];

function requireTool(path: string, what: string, how: string): void {
  if (!existsSync(path)) {
    throw new Error(`${what} was not found at ${path}. ${how}`);
  }
}

function sips(args: readonly string[]): string {
  try {
    return execFileSync(SIPS, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`sips failed (${args.join(' ')}): ${detail}`, { cause: err });
  }
}

/**
 * Wait until `path` exists and has stopped growing.
 *
 * This is the awkward part of the script and it is deliberate. `--screenshot`
 * is documented to write the file and exit, and on Chrome 153.0.8010.48 —
 * measured here on 2026-09-21, in both `--headless` and `--headless=old` — it
 * writes a complete, correct PNG and then never exits, with or without
 * `--virtual-time-budget`. Waiting on the process therefore hangs forever, so
 * the script waits on the artefact instead and kills the browser once the file
 * has settled. Two consecutive polls at the same non-zero size is the settle
 * condition: Chrome writes the PNG in one pass, and a half-written file would
 * still be growing between polls.
 */
async function waitForScreenshot(path: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + SHOT_TIMEOUT_MS;
  let previousSize = -1;
  let exited = false;
  child.once('exit', () => { exited = true; });

  while (Date.now() < deadline) {
    await delay(POLL_MS);
    const size = existsSync(path) ? statSync(path).size : 0;
    if (size > 0 && size === previousSize) return;
    previousSize = size;
    // A Chrome that exits without leaving a file has failed at something this
    // script cannot see — a bad flag, a profile it could not lock — and saying
    // so now is more useful than waiting out the full timeout.
    if (exited && size === 0) {
      throw new Error(`Chrome exited without writing ${path}`);
    }
  }
  throw new Error(`Chrome did not finish ${path} within ${SHOT_TIMEOUT_MS / 1000}s`);
}

async function shot(render: Render, profileDir: string): Promise<string> {
  const html = join(SRC, `${render.id}.html`);
  if (!existsSync(html)) throw new Error(`no source page at ${html}`);
  const out = join(HERE, `${render.id}.png`);
  // Removed first so that a stale PNG from an earlier run can never be mistaken
  // for this run's output by the poll above.
  rmSync(out, { force: true });

  const child = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    // A fixture that renders differently on a Retina machine than on an external
    // monitor is not a fixture, so the scale factor is pinned rather than
    // inherited. LCD text is off for the same reason, and because subpixel
    // antialiasing puts colour fringes on every glyph and inflates the PNG.
    '--force-device-scale-factor=1',
    '--disable-lcd-text',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    `--window-size=${render.width},${render.height}`,
    `--screenshot=${out}`,
    pathToFileURL(html).href,
  ], { stdio: 'ignore' });

  try {
    await waitForScreenshot(out, child);
  } finally {
    child.kill('SIGKILL');
  }
  return out;
}

function degrade(derived: Derived, width: number): string {
  const source = join(HERE, `${derived.from}.png`);
  if (!existsSync(source)) throw new Error(`cannot derive ${derived.id}: ${source} has not been rendered`);
  const out = join(HERE, `${derived.id}.png`);
  rmSync(out, { force: true });
  sips(['--resampleWidth', String(derived.viaWidth), source, '--out', out]);
  sips(['--resampleWidth', String(width), out, '--out', out]);
  return out;
}

function report(path: string): string {
  const kb = (statSync(path).size / 1024).toFixed(0);
  const probe = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
  const width = /pixelWidth:\s*(\d+)/.exec(probe)?.[1] ?? '?';
  const height = /pixelHeight:\s*(\d+)/.exec(probe)?.[1] ?? '?';
  return `${width}x${height}, ${kb} kB`;
}

async function main(): Promise<void> {
  requireTool(CHROME, 'Google Chrome', 'Install Chrome, or edit CHROME in this file if it lives elsewhere.');
  requireTool(SIPS, 'sips', 'sips ships with macOS; this script does not run anywhere else.');

  const profileDir = mkdtempSync(join(tmpdir(), 'fixture-render-'));
  try {
    for (const render of RENDERS) {
      const out = await shot(render, profileDir);
      process.stdout.write(`rendered ${render.id}.png — ${report(out)}\n`);
    }
    for (const derived of DERIVED) {
      const origin = RENDERS.find((r) => r.id === derived.from);
      if (!origin) throw new Error(`${derived.id} is derived from ${derived.from}, which is not rendered here`);
      const out = degrade(derived, origin.width);
      process.stdout.write(`derived  ${derived.id}.png via ${derived.viaWidth}px — ${report(out)}\n`);
    }
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
