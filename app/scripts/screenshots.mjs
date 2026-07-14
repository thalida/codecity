// app/scripts/screenshots.mjs — regenerate the README screenshots in
// .github/readme/ from a headless capture of codecity rendering its own repo.
//
// Run it via `just screenshots` (which needs `just dev` up in another
// terminal). It drives the debug-gated ?shot= capture harness
// (app/src/city/capture): for each shot it opens the app pointed at that
// shot's repo (codecity, or a bigger multi-author repo for the forest shots),
// waits for the harness to pose the camera and mark the frame ready, then
// screenshots the <canvas> (the 3D view only, no UI chrome). The animated
// demo.gif is NOT covered here — capture it by hand.
//
// Lives under app/ so `playwright` resolves from app/node_modules.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
// app/scripts/ -> repo root -> .github/readme
const OUT_DIR = join(HERE, '..', '..', '.github', 'readme');

const BASE_URL = (process.env.CODECITY_URL || 'http://localhost:8080').replace(/\/$/, '');
const SRC = 'https://github.com/thalida/codecity';
const BRANCH = 'main';

// The forest + firefly shots need a big, multi-author repo to look like the
// feature they demo (codecity itself is too sparse: few commits, one author).
const FOREST = { src: 'https://github.com/fastapi/fastapi', branch: 'master' };

// name = the ?shot= pose in app/src/city/capture/shots.ts; file = output PNG.
// Viewport is CSS px; a 2x device scale factor gives retina-crisp captures.
// src/branch default to codecity (SRC/BRANCH) unless a shot overrides them.
const SHOTS = [
  { name: 'banner', file: 'banner.png', width: 1600, height: 560 },
  { name: 'overview', file: 'overview.png', width: 1280, height: 860 },
  { name: 'buildings', file: 'buildings.png', width: 1040, height: 860 },
  { name: 'streets', file: 'streets.png', width: 1040, height: 860 },
  { name: 'trees', file: 'trees.png', width: 1280, height: 860, ...FOREST },
  { name: 'fireflies', file: 'fireflies.png', width: 1040, height: 860, ...FOREST },
  { name: 'gem', file: 'gem.png', width: 1040, height: 860 },
];

const READY = 'html[data-cc-capture-ready="1"]';

// Optional CLI filter: `node screenshots.mjs fireflies trees` captures only
// those; no args captures all. Unknown names are reported and skipped.
const requested = process.argv.slice(2);
for (const name of requested) {
  if (!SHOTS.some((s) => s.name === name)) {
    console.warn(`[screenshots] unknown shot "${name}" (skipping)`);
  }
}
const shots = requested.length ? SHOTS.filter((s) => requested.includes(s.name)) : SHOTS;
if (!shots.length) {
  console.error(`[screenshots] no matching shots. Known: ${SHOTS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();

try {
  for (const shot of shots) {
    // Fresh context per shot: the capture harness writes the camera angle to
    // localStorage, so an isolated context keeps shots from leaking into each
    // other.
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on('console', (msg) => console.log(`\n  [page] ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`\n  [page:error] ${err.message}`));
    const params = new URLSearchParams({
      src: shot.src ?? SRC,
      branch: shot.branch ?? BRANCH,
      shot: shot.name,
      debug: '1',
    });
    const url = `${BASE_URL}/?${params}`;

    process.stdout.write(`[screenshots] ${shot.name} … `);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // First run clones + scans the repo (a big repo's git-log walk is slow), so
    // allow generous time; cache is warm on later runs.
    await page.waitForSelector(READY, { timeout: 360_000 });
    await page.locator('canvas#city').screenshot({ path: join(OUT_DIR, shot.file) });
    console.log(`→ .github/readme/${shot.file}`);

    await context.close();
  }
  console.log('[screenshots] done. demo.gif is not automated; capture it by hand.');
} finally {
  await browser.close();
}
