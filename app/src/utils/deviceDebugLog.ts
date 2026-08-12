// utils/deviceDebugLog.ts — DEV-only telemetry pipe for debugging on devices
// whose console isn't reachable (a phone over a tunnel). Events batch here and
// POST to the vite dev server's /__debuglog middleware (vite.config.js), which
// appends NDJSON to app/.local-debuglog.ndjson on the host machine.

const ACTIVE =
  typeof window !== 'undefined' && import.meta.env.DEV && import.meta.env.MODE !== 'test';

const queue: string[] = [];
let timer: number | null = null;

function flush(): void {
  if (!queue.length) return;
  const body = queue.join('\n');
  queue.length = 0;
  void fetch('/__debuglog', { method: 'POST', body, keepalive: true }).catch(() => {});
}

export function debugLog(type: string, data: Record<string, unknown> = {}): void {
  if (!ACTIVE) return;
  queue.push(JSON.stringify({ ts: Math.round(performance.now()), type, ...data }));
  if (queue.length > 200) flush();
  if (timer === null) timer = window.setInterval(flush, 1000);
}

/** Install once at boot: global error/warn capture + device fingerprint. */
export function installDeviceDebugLog(): void {
  if (!ACTIVE) return;
  debugLog('boot', {
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    w: window.innerWidth,
    h: window.innerHeight,
  });
  window.addEventListener('error', (e) => debugLog('window-error', { msg: String(e.message) }));
  window.addEventListener('unhandledrejection', (e) =>
    debugLog('unhandled-rejection', { msg: String(e.reason).slice(0, 300) })
  );
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    debugLog('console-warn', { msg: args.map(String).join(' ').slice(0, 300) });
    origWarn(...args);
  };
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    debugLog('console-error', { msg: args.map(String).join(' ').slice(0, 300) });
    origError(...args);
  };
}
