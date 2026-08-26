// packages/app/scripts/screenshots.mjs — headless captures of codecity rendering a repo,
// through the debug-gated ?shot= harness (app/packages/city/capture). Run via
// `just screenshots` (README images) or `just hero-image` (the landing's
// wallpaper); both need `just dev` up in another terminal.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { mkdir } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/app/scripts/ -> repo root -> .github/readme
const OUT_DIR = join(HERE, '..', '..', '..', '.github', 'readme');
// app/scripts/ -> app/public: shipped assets, not README images.
const PUBLIC_DIR = join(HERE, '..', 'public');

const BASE_URL = (process.env.CODECITY_URL || 'http://localhost:8080').replace(/\/$/, '');
const SRC = 'https://github.com/thalida/codecity';
const BRANCH = 'main';

// The forest + firefly shots need a big, multi-author repo to look like the
// feature they demo (codecity itself is too sparse: few commits, one author).
const FOREST = { src: 'https://github.com/fastapi/fastapi', branch: 'master' };

// name = the ?shot= pose in shots.ts; file = output PNG; dir defaults to the
// README folder. Viewport is CSS px, captured at 2x for retina.
const SHOTS = [
  { name: 'banner', file: 'banner.png', width: 1600, height: 560 },
  { name: 'overview', file: 'overview.png', width: 1280, height: 860 },
  { name: 'buildings', file: 'buildings.png', width: 1040, height: 860 },
  { name: 'streets', file: 'streets.png', width: 1040, height: 860 },
  { name: 'trees', file: 'trees.png', width: 1280, height: 860, ...FOREST },
  { name: 'fireflies', file: 'fireflies.png', width: 1040, height: 860, ...FOREST },
  { name: 'gem', file: 'gem.png', width: 1040, height: 860 },
  { name: 'timeline', file: 'timeline.png', width: 1280, height: 860 },
  { name: 'hero', file: 'hero-city.png', width: 1920, height: 1080, dir: PUBLIC_DIR, byName: true },
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
// byName shots ship with the app rather than the README, so a plain
// `just screenshots` leaves them alone (see `just hero-image`).
const shots = requested.length
  ? SHOTS.filter((s) => requested.includes(s.name))
  : SHOTS.filter((s) => !s.byName);
if (!shots.length) {
  console.error(`[screenshots] no matching shots. Known: ${SHOTS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

for (const dir of new Set(shots.map((s) => s.dir ?? OUT_DIR))) {
  await mkdir(dir, { recursive: true });
}
const browser = await chromium.launch();

try {
  for (const shot of shots) {
    // Fresh context per shot: the harness writes the camera angle to
    // localStorage, which would otherwise leak into the next shot.
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    // Surface real page errors (e.g. a failed pose), not the vite/GL noise.
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`\n  [page:error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.log(`\n  [page:error] ${err.message}`));
    const params = new URLSearchParams({
      src: shot.src ?? SRC,
      branch: shot.branch ?? BRANCH,
      shot: shot.name,
      debug: '1',
    });
    const url = `${BASE_URL}/city?${params}`;

    process.stdout.write(`[screenshots] ${shot.name} … `);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // First run clones + scans the repo (a big repo's git-log walk is slow), so
    // allow generous time; cache is warm on later runs.
    await page.waitForSelector(READY, { timeout: 360_000 });
    const outDir = shot.dir ?? OUT_DIR;
    await page.locator('canvas#city').screenshot({ path: join(outDir, shot.file) });
    console.log(`→ ${relative(join(HERE, '..', '..', '..'), join(outDir, shot.file))}`);

    await context.close();
  }
  console.log('[screenshots] done. Run `just demo-video` for the animated demo.mp4.');
} finally {
  await browser.close();
}
