// Post-refactor visual regression verifier. Compares screenshots taken at
// the 3 fixed POSES against the reference PNGs captured pre-refactor via
// capture-references.ts.
//
// PASS criterion: <1% of pixels differ per pose (pixelmatch threshold 0.1).
// EXIT CODE: 0 if all poses pass, 1 if any fail.
// DIFF OUTPUT: failing poses write a diff PNG to tests/visual/references-diff/
//              for debugging. That directory is gitignored.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { setupHarness, makePoses } from './setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REF_DIR = resolve(__dirname, 'references');
const DIFF_DIR = resolve(__dirname, 'references-diff');
const TOLERANCE_PX_PCT = 0.01; // 1% pixels may differ.

(async () => {
  const h = await setupHarness();
  let failed = 0;
  try {
    const poses = await makePoses(h.page);
    for (const { name, pose } of poses) {
      await h.setCamera(pose);
      const got = await h.snapshot();

      const refPath = resolve(REF_DIR, `${name}.png`);
      const refPng = PNG.sync.read(readFileSync(refPath));
      const gotPng = PNG.sync.read(got);

      if (refPng.width !== gotPng.width || refPng.height !== gotPng.height) {
        console.error(
          `FAIL ${name}: size mismatch (ref ${refPng.width}×${refPng.height} vs got ${gotPng.width}×${gotPng.height})`
        );
        failed++;
        continue;
      }

      const diffPng = new PNG({ width: refPng.width, height: refPng.height });
      const numDiff = pixelmatch(
        refPng.data,
        gotPng.data,
        diffPng.data,
        refPng.width,
        refPng.height,
        { threshold: 0.1 }
      );

      const totalPixels = refPng.width * refPng.height;
      const pct = numDiff / totalPixels;

      if (pct > TOLERANCE_PX_PCT) {
        console.error(
          `FAIL ${name}: ${(pct * 100).toFixed(2)}% pixels differ (>${TOLERANCE_PX_PCT * 100}%)`
        );
        // Save diff PNG so failures are debuggable without re-running.
        mkdirSync(DIFF_DIR, { recursive: true });
        const diffPath = resolve(DIFF_DIR, `${name}.png`);
        writeFileSync(diffPath, PNG.sync.write(diffPng));
        console.error(`     diff saved to ${diffPath}`);
        failed++;
      } else {
        console.log(`PASS ${name}: ${(pct * 100).toFixed(2)}% pixels differ`);
      }
    }
  } finally {
    await h.teardown();
  }
  process.exit(failed > 0 ? 1 : 0);
})();
