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
  // C1 fix: clear the timeout on success so the event loop is not held open;
  // kill the process + reject on both timeout and unexpected early exit so no
  // zombie is left behind when something goes wrong.
  await new Promise<void>((res, rej) => {
    let buf = '';
    const timeout = setTimeout(() => {
      server.kill('SIGTERM');
      rej(new Error('server boot timeout'));
    }, 5000);
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      if (buf.includes('[codecity] serving on')) {
        clearTimeout(timeout);
        server.stderr!.off('data', onData);
        res();
      }
    };
    server.stderr!.on('data', onData);
    server.once('exit', (code) => {
      clearTimeout(timeout);
      rej(new Error(`server exited with code ${code} before ready: ${buf}`));
    });
  });

  const browser = await puppeteer.launch({
    // puppeteer >= 22 uses headless: true (the old 'new' string form was
    // accepted through v21 but is rejected in v22+).
    headless: true,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/?src=${encodeURIComponent(FIXTURE_PATH)}`);

  // I3 fix: wait for window.__rig (set in main.ts after startRenderLoop, which
  // runs AFTER the manifest fetch + cityScene.applyManifest). Checking
  // __rig.controls.target confirms OrbitControls is fully initialised.
  // This is strictly stronger than just waiting for WebGL2 context, which
  // resolves as soon as Three.js initialises — well before buildings are in
  // the scene.
  await page.waitForFunction(() => {
    const w = window as any;
    return !!document.querySelector('canvas')?.getContext('webgl2')
        && !!w.__rig?.controls?.target;
  }, { timeout: 10000 });

  // Freeze the gem-bob / rotation clock for deterministic captures.
  // The gem animation in main.ts computes:
  //   const t = (performance.now() - startTime) / 1000
  // where `startTime` is captured at render-loop boot. Pinning
  // performance.now() to a fixed value freezes t so gem rotation and bob
  // are deterministic across runs.
  //
  // WARNING for future test authors: cameraRig.ts _animateCamera() also uses
  // performance.now() to drive its LERP. With the freeze in place, calling
  // rig.reset() or rig.focusBuilding() after this point would compute
  // elapsed=0 forever and hang the rAF loop. Do NOT call those methods after
  // this freeze — setCamera() directly assigns camera.position/controls.target
  // and bypasses _animateCamera, so it is safe.
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

  // C2 fix: use try/finally so the server is always killed even if
  // browser.close() throws (e.g. if the browser was already disconnected).
  async function teardown(): Promise<void> {
    try { await browser.close(); } finally { server.kill('SIGTERM'); }
  }

  return { browser, page, server, port, setCamera, snapshot, teardown };
}

// I4 fix: top-down pose reads the scene's auto-framed center from __rig
// so the camera is directly above the actual city, not world origin.
// orbit-30 and close-block are content-rich enough that they show buildings
// regardless of the exact city offset.
export async function makePoses(page: Page): Promise<CameraPose[]> {
  const center = await page.evaluate(() => {
    const r = (window as any).__rig;
    return {
      tX: r.controls.target.x as number,
      tY: r.controls.target.y as number,
      tZ: r.controls.target.z as number,
    };
  });

  return [
    // Top-down — positioned directly above the scene's auto-framed centre so
    // the whole city is visible. Before this fix the target was world-origin
    // and the render was mostly black.
    {
      name: 'top-down',
      pose: {
        posX: center.tX,
        posY: 200,
        posZ: center.tZ + 0.01,
        tX: center.tX,
        tY: center.tY,
        tZ: center.tZ,
      },
    },
    // 30° orbit — the typical first view.
    { name: 'orbit-30', pose: { posX: 80, posY: 100, posZ: 80, tX: 0, tY: 0, tZ: 0 } },
    // Close-up on one block — exposes window/door detail.
    { name: 'close-block', pose: { posX: 15, posY: 25, posZ: 15, tX: 5, tY: 0, tZ: 5 } },
  ];
}

// Legacy static export kept for callers that don't need the dynamic top-down
// fix. capture-references.ts now uses makePoses() instead.
export const POSES: CameraPose[] = [
  { name: 'top-down', pose: { posX: 0, posY: 200, posZ: 0.01, tX: 0, tY: 0, tZ: 0 } },
  { name: 'orbit-30', pose: { posX: 80, posY: 100, posZ: 80, tX: 0, tY: 0, tZ: 0 } },
  { name: 'close-block', pose: { posX: 15, posY: 25, posZ: 15, tX: 5, tY: 0, tZ: 5 } },
];
