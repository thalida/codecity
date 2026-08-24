// src/app/scripts/demo-video.mjs — regenerate .github/readme/demo.mp4, a looping
// orbit of codecity rendering its own repo. Run via `just demo-video` (needs
// the app served and ffmpeg); it records the debug-gated `orbit` shot between
// its data-cc-orbit-start/done marks. Under src/app/ so `playwright` resolves.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', '.github', 'readme', 'demo.mp4');

const BASE_URL = (process.env.CODECITY_URL || 'http://localhost:8080').replace(/\/$/, '');
const SRC = 'https://github.com/thalida/codecity';
const BRANCH = 'main';

const VIEWPORT = { width: 1280, height: 720 };
const OUT_WIDTH = 960; // encoded mp4 width

if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('[demo-video] ffmpeg is required (macOS: brew install ffmpeg)');
  process.exit(1);
}

const videoDir = await mkdtemp(join(tmpdir(), 'cc-demo-vid-'));
// Headed: headless Chromium renders WebGL in software at a choppy frame rate,
// so a real (visible, ~20s) window is what makes the orbit record smoothly.
const browser = await chromium.launch({
  headless: false,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist'],
});

try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  // Pin the canvas full-viewport from the first paint so the recording is
  // chrome-free. Via the CSSOM: the page's CSP drops an inline <style>.
  await context.addInitScript(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      '#city{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;}'
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`  [page:error] ${err.message}`));

  const params = new URLSearchParams({ src: SRC, branch: BRANCH, shot: 'orbit', debug: '1' });
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/?${params}`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('html[data-cc-orbit-start="1"]', { timeout: 360_000 });
  const tStart = Date.now();
  console.log('[demo-video] recording orbit …');
  await page.waitForSelector('html[data-cc-orbit-done="1"]', { timeout: 120_000 });
  const tEnd = Date.now();

  const video = page.video();
  await context.close(); // finalizes the webm
  const webm = await video.path();

  const startSec = Math.max(0, (tStart - t0) / 1000 + 0.15); // skip the load flash
  const durSec = (tEnd - tStart) / 1000;
  console.log(`[demo-video] encoding mp4 (from ${startSec.toFixed(1)}s, ${durSec.toFixed(1)}s) …`);
  const res = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(startSec),
      '-t',
      String(durSec),
      '-i',
      webm,
      '-vf',
      `scale=${OUT_WIDTH}:-2:flags=lanczos`,
      '-c:v',
      'libx264',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      OUT,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  if (res.status !== 0) process.exit(1);
  console.log(`[demo-video] wrote ${OUT}`);
} finally {
  await browser.close();
  await rm(videoDir, { recursive: true, force: true });
}
