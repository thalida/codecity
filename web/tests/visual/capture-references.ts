// One-shot: capture reference PNGs against the CURRENT renderer.
// Run BEFORE the InstancedMesh rewrite. Re-run only if you intentionally
// change visual output (and update the references in git).

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setupHarness, makePoses } from './setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUT_DIR = resolve(__dirname, 'references');

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const h = await setupHarness();
  try {
    // I4: use makePoses() to get a top-down pose that targets the actual
    // scene centre (read from __rig after the city has loaded), not world origin.
    const poses = await makePoses(h.page);
    for (const { name, pose } of poses) {
      await h.setCamera(pose);
      const png = await h.snapshot();
      writeFileSync(resolve(OUT_DIR, `${name}.png`), png);
      console.log(`captured ${name}.png (${png.length} bytes)`);
    }
  } finally {
    await h.teardown();
  }
})();
