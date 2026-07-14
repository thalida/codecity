// scripts/screenshots.mjs — regenerate the README screenshots in
// .github/readme/ from a headless capture of codecity rendering its own repo.
//
// Run it via `just screenshots` (which needs `just dev` up in another
// terminal). It drives the debug-gated ?shot= capture harness
// (app/src/city/capture): for each shot it opens the app pointed at
// github.com/thalida/codecity, waits for the harness to pose the camera and
// mark the frame ready, then screenshots the <canvas> (the 3D view only, no
// UI chrome). The animated demo.gif is NOT covered here — capture it by hand.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", ".github", "readme");

const BASE_URL = (process.env.CODECITY_URL || "http://localhost:8080").replace(
  /\/$/,
  "",
);
const SRC = "https://github.com/thalida/codecity";
const BRANCH = "main";

// name = the ?shot= pose in app/src/city/capture/shots.ts; file = output PNG.
// Viewport is CSS px; a 2x device scale factor gives retina-crisp captures.
const SHOTS = [
  { name: "banner", file: "banner.png", width: 1600, height: 560 },
  { name: "overview", file: "overview.png", width: 1280, height: 860 },
  { name: "buildings", file: "buildings.png", width: 1040, height: 860 },
  { name: "streets", file: "streets.png", width: 1040, height: 860 },
  { name: "trees", file: "trees.png", width: 1280, height: 860 },
  { name: "fireflies", file: "fireflies.png", width: 1040, height: 860 },
  { name: "gem", file: "gem.png", width: 1040, height: 860 },
];

const READY = 'html[data-cc-capture-ready="1"]';

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();

try {
  for (const shot of SHOTS) {
    // Fresh context per shot: the capture harness writes the camera angle to
    // localStorage, so an isolated context keeps shots from leaking into each
    // other.
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const params = new URLSearchParams({
      src: SRC,
      branch: BRANCH,
      shot: shot.name,
      debug: "1",
    });
    const url = `${BASE_URL}/?${params}`;

    process.stdout.write(`[screenshots] ${shot.name} … `);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // First run clones + scans the repo, so allow generous time; cache is warm
    // on later runs.
    await page.waitForSelector(READY, { timeout: 180_000 });
    await page
      .locator("canvas#city")
      .screenshot({ path: join(OUT_DIR, shot.file) });
    console.log(`→ .github/readme/${shot.file}`);

    await context.close();
  }
  console.log(
    "[screenshots] done. demo.gif is not automated; capture it by hand.",
  );
} finally {
  await browser.close();
}
