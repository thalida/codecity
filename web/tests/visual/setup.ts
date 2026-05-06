// Visual regression harness. Spins up the codecity server + a Puppeteer
// browser, points it at the local URL, sets a deterministic camera pose,
// and snapshots the canvas. Used by capture-references.ts (one-shot,
// pre-refactor) and verify-references.ts (run after the refactor to
// confirm pixel parity).

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../..');

export interface CameraPose {
  name: string;
  pose: { posX: number; posY: number; posZ: number; tX: number; tY: number; tZ: number };
}

export interface VisualHarness {
  browser: Browser;
  page: Page;
  server: ChildProcess;
  port: number;
  setCamera(pose: CameraPose['pose']): Promise<void>;
  snapshot(): Promise<Buffer>;
  teardown(): Promise<void>;
}

const FIXTURE_PATH = resolve(REPO_ROOT, 'codecity/tests/fixtures/sample-repo');

export async function setupHarness(port = 18765): Promise<VisualHarness> {
  // Start the server pointing at the sample-repo fixture, port-pinned for
  // deterministic test runs.
  const server = spawn(
    'python3',
    ['-m', 'codecity.cli', 'serve', FIXTURE_PATH, '--no-window', '--port', String(port)],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  // Wait for "[codecity] serving on" line.
  await new Promise<void>((res, rej) => {
    let buf = '';
    server.stderr!.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.includes('[codecity] serving on')) res();
    });
    setTimeout(() => rej(new Error('server boot timeout')), 5000);
  });

  const browser = await puppeteer.launch({
    // puppeteer >= 22 uses headless: true (the old 'new' string form was
    // accepted through v21 but is rejected in v22+).
    headless: true,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/?path=${encodeURIComponent(FIXTURE_PATH)}`);
  // Wait for the canvas to render at least once.
  await page.waitForFunction(
    () => !!document.querySelector('canvas')?.getContext('webgl2'),
    { timeout: 5000 }
  );
  // Freeze the gem-bob / rotation clock for deterministic captures.
  // performance.now() is used only for time-driven animation (gem rotation
  // speed, bob frequency) — pinning it to a fixed value stops those effects
  // while leaving requestAnimationFrame and the main render loop running
  // normally. The page continues to re-render; we're just freezing the
  // animation state at t=1s.
  await page.evaluate(() => {
    (window as any).performance.now = () => 1000;
  });
  // Give the render loop one more frame to settle after the clock freeze.
  await new Promise((r) => setTimeout(r, 100));

  async function setCamera(pose: CameraPose['pose']): Promise<void> {
    await page.evaluate((p) => {
      // The CameraRig exposes its OrbitControls + camera via window for
      // testing. If not exposed, this needs a small main.ts hook.
      const rig = (window as any).__rig;
      if (!rig) throw new Error('camera rig not exposed; add window.__rig in main.ts');
      rig.camera.position.set(p.posX, p.posY, p.posZ);
      rig.controls.target.set(p.tX, p.tY, p.tZ);
      rig.controls.update();
    }, pose);
    // Wait two render frames to let the scene redraw at the new pose.
    await new Promise((r) => setTimeout(r, 100));
  }

  async function snapshot(): Promise<Buffer> {
    return Buffer.from(await page.screenshot({ type: 'png' }));
  }

  async function teardown(): Promise<void> {
    await browser.close();
    server.kill('SIGTERM');
  }

  return { browser, page, server, port, setCamera, snapshot, teardown };
}

export const POSES: CameraPose[] = [
  // Top-down — sees the whole city.
  { name: 'top-down', pose: { posX: 0, posY: 200, posZ: 0.01, tX: 0, tY: 0, tZ: 0 } },
  // 30° orbit — the typical first view.
  { name: 'orbit-30', pose: { posX: 80, posY: 100, posZ: 80, tX: 0, tY: 0, tZ: 0 } },
  // Close-up on one block — exposes window/door detail.
  { name: 'close-block', pose: { posX: 15, posY: 25, posZ: 15, tX: 5, tY: 0, tZ: 5 } },
];
