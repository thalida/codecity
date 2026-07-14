// app/scripts/demo-gif.mjs — regenerate .github/readme/demo.gif: a smooth
// headless orbit of codecity rendering its own repo.
//
// Run via `just demo-gif` (needs `just dev` up and ffmpeg installed). It drives
// the debug-gated `orbit` shot (app/src/city/capture): the shot installs a
// per-frame window.__ccOrbit(azimuth); this script steps the azimuth a full
// turn, screenshots the <canvas> each step, then encodes the frames to a gif
// with ffmpeg (two-pass palette for quality).
//
// Lives under app/ so `playwright` resolves from app/node_modules.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '.github', 'readme', 'demo.gif');

const BASE_URL = (process.env.CODECITY_URL || 'http://localhost:8080').replace(/\/$/, '');
const SRC = 'https://github.com/thalida/codecity';
const BRANCH = 'main';

const VIEWPORT = { width: 1280, height: 720 };
const FRAMES = 100; // full 360deg turn
const FPS = 20; // -> 5s loop
const GIF_WIDTH = 800; // README display width
const READY = 'html[data-cc-capture-ready="1"]';

if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('[demo-gif] ffmpeg is required (macOS: brew install ffmpeg)');
  process.exit(1);
}

const frameDir = await mkdtemp(join(tmpdir(), 'cc-demo-gif-'));
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`  [page:error] ${err.message}`));

  const params = new URLSearchParams({ src: SRC, branch: BRANCH, shot: 'orbit', debug: '1' });
  await page.goto(`${BASE_URL}/?${params}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 360_000 });
  await page.waitForFunction(() => typeof window.__ccOrbit === 'function', { timeout: 10_000 });

  const canvas = page.locator('canvas#city');
  process.stdout.write(`[demo-gif] capturing ${FRAMES} frames `);
  for (let i = 0; i < FRAMES; i += 1) {
    const azimuth = -180 + (360 * i) / FRAMES;
    await page.evaluate((az) => window.__ccOrbit?.(az), azimuth);
    await page.waitForTimeout(40); // let the new pose render before grabbing it
    await canvas.screenshot({ path: join(frameDir, `f-${String(i).padStart(4, '0')}.png`) });
    process.stdout.write('.');
  }
  console.log(' done');
  await context.close();

  console.log('[demo-gif] encoding gif with ffmpeg …');
  const input = join(frameDir, 'f-%04d.png');
  const palette = join(frameDir, 'palette.png');
  const scale = `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  const run = (args) => spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  run([
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-vf',
    `${scale},palettegen=stats_mode=diff`,
    palette,
  ]);
  run([
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-i',
    palette,
    '-lavfi',
    `${scale},paletteuse=dither=bayer:bayer_scale=3`,
    OUT,
  ]);
  console.log(`[demo-gif] wrote ${OUT}`);
} finally {
  await browser.close();
  await rm(frameDir, { recursive: true, force: true });
}
