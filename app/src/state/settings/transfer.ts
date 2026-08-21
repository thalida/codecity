// state/settings/transfer.ts — settings as a file: what an export writes, and
// what an import is allowed to put back. Which settings are offered, and under
// what names, is the controls layer's call; this only moves them. See README.md.

import { getStoreName, getDefault, nonDefaultValue } from '@/state/persist';
import { EXCLUDES, setExcludesFor } from '@/state/stores/source';
import { sourceKey } from '@/utils/sources';
import { coerceFieldValue, forEachSettingStore, type SettingStore } from './schema';
import { dropDrafts } from './drafts';

/** Identifies the file as ours before anything reads its contents. */
export const SETTINGS_FILE_KIND = 'codecity-settings';

/** Bumped when a shape change would make an older file mean something else. A
 *  file from another version is refused rather than half-applied. */
export const SETTINGS_FILE_VERSION = 1;

/** One repo's hidden paths. The store keys these by a one-way hash of the src,
 *  so the src itself travels and the hash is re-derived on the far side. */
export interface RepoExcludes {
  src: string;
  paths: string[];
}

/** The reserved key under `scan` that carries exclude lists. Every other key in
 *  either family is a store's persisted name. */
const EXCLUDES_KEY = 'EXCLUDES';

/** The file. A store appears under its family iff it was selected, `{}` meaning
 *  "sent, and stock": that is what lets an import reproduce a whole look. */
export interface SettingsFile {
  kind: typeof SETTINGS_FILE_KIND;
  version: number;
  world?: Record<string, unknown>;
  scan?: Record<string, unknown>;
}

/** The file's two halves, kept apart everywhere because they answer different
 *  questions: what the city looks like, and what gets scanned. */
export enum TransferFamily {
  World = 'world',
  Scan = 'scan',
}

/** A named bundle of stores that travels as a unit. The bundles themselves are
 *  the controls layer's to name; this is only their shape. */
export interface TransferGroup {
  key: string;
  label: string;
  family: TransferFamily;
  stores: SettingStore[];
}

/** Which settings one export or import covers. The two directions take the same
 *  shape: an import applies the subset of the file the user ticked. */
export interface TransferSelection {
  world: readonly SettingStore[];
  scan: readonly SettingStore[];
  /** Repo srcs whose exclude lists travel. */
  excludeSrcs: readonly string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Name ↔ store ───────────────────────────────────────────────────────────

// Built on demand: every field module has to have run for the registry to be
// complete, and this module is imported by the UI long after that.
function storesByName(): Map<string, SettingStore> {
  const byName = new Map<string, SettingStore>();
  forEachSettingStore((store) => {
    const name = getStoreName(store);
    if (name) byName.set(name, store);
  });
  return byName;
}

// ── Export ─────────────────────────────────────────────────────────────────

function familyPayload(stores: readonly SettingStore[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const store of stores) {
    const name = getStoreName(store);
    if (!name) continue;
    // A diff reads as a list of choices and survives a later change to a default
    // it never mentions. A scalar has nothing to diff: its value IS the choice.
    out[name] = isPlainObject(getDefault(store)) ? (nonDefaultValue(store) ?? {}) : store.value;
  }
  return out;
}

/** Build the file for a selection. Families the selection does not touch are
 *  left off entirely, so a world-only export is a file with no `scan` key. */
export function buildSettingsFile(selection: TransferSelection): SettingsFile {
  const file: SettingsFile = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION };

  if (selection.world.length > 0) file.world = familyPayload(selection.world);

  const scan = familyPayload(selection.scan);
  if (selection.excludeSrcs.length > 0) {
    const map = EXCLUDES.peek();
    scan[EXCLUDES_KEY] = selection.excludeSrcs.map<RepoExcludes>((src) => ({
      src,
      paths: [...(map[sourceKey(src)] ?? [])],
    }));
  }
  if (Object.keys(scan).length > 0) file.scan = scan;

  return file;
}

// ── Import ─────────────────────────────────────────────────────────────────

export class SettingsFileError extends Error {}

/** A file, resolved against the running app: which of its stores still exist,
 *  and which exclude lists it carries. The UI offers exactly this. */
export interface ParsedSettingsFile {
  file: SettingsFile;
  /** Stores the file covers, by family. A store the file names but this build
   *  no longer has is dropped here and counted in `unknownStores`. */
  world: SettingStore[];
  scan: SettingStore[];
  excludes: RepoExcludes[];
  /** Names the file carried that resolve to nothing. Reported rather than
   *  ignored: a file that only half-applies should say so. */
  unknownStores: string[];
}

function parseExcludes(raw: unknown): RepoExcludes[] {
  if (!Array.isArray(raw)) return [];
  const out: RepoExcludes[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const { src, paths } = entry;
    if (typeof src !== 'string' || !src) continue;
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) continue;
    out.push({ src, paths: paths as string[] });
  }
  return out;
}

function resolveFamily(
  raw: unknown,
  byName: Map<string, SettingStore>,
  unknown: string[]
): SettingStore[] {
  if (!isPlainObject(raw)) return [];
  const stores: SettingStore[] = [];
  for (const name of Object.keys(raw)) {
    if (name === EXCLUDES_KEY) continue;
    const store = byName.get(name);
    if (store) stores.push(store);
    else unknown.push(name);
  }
  return stores;
}

/** Read a settings file. Throws SettingsFileError with a message meant for the
 *  user: a file that cannot be trusted is refused, never partially guessed at. */
export function parseSettingsFile(text: string): ParsedSettingsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SettingsFileError('That file is not JSON.');
  }
  if (!isPlainObject(raw) || raw.kind !== SETTINGS_FILE_KIND) {
    throw new SettingsFileError('That is not a codecity settings file.');
  }
  if (raw.version !== SETTINGS_FILE_VERSION) {
    throw new SettingsFileError(
      `That file is version ${String(raw.version)}; this build reads version ${SETTINGS_FILE_VERSION}.`
    );
  }

  const file = raw as unknown as SettingsFile;
  const byName = storesByName();
  const unknownStores: string[] = [];
  const parsed: ParsedSettingsFile = {
    file,
    world: resolveFamily(file.world, byName, unknownStores),
    scan: resolveFamily(file.scan, byName, unknownStores),
    excludes: parseExcludes(isPlainObject(file.scan) ? file.scan[EXCLUDES_KEY] : undefined),
    unknownStores,
  };
  if (parsed.world.length + parsed.scan.length + parsed.excludes.length === 0) {
    throw new SettingsFileError('That file holds no settings this build recognises.');
  }
  return parsed;
}

/** How many of a store's values an import could not use — a field the file set
 *  to something the schema does not allow, or one this build has dropped. */
export interface ImportReport {
  /** `STORE.KEY` for each value skipped, so the UI can name what didn't land. */
  skipped: string[];
}

function payloadFor(family: unknown, name: string): unknown {
  return isPlainObject(family) ? family[name] : undefined;
}

// Replaced, not merged: defaults first, then the file over the top, so "import
// the trees" means their trees rather than theirs crossed with yours.
function applyStore(store: SettingStore, payload: unknown, skipped: string[]): void {
  const name = getStoreName(store) ?? '?';
  const defaults = getDefault(store);
  if (!isPlainObject(defaults)) {
    const coerced = typeof payload === typeof defaults ? payload : undefined;
    if (payload !== undefined && coerced === undefined) skipped.push(name);
    store.value = coerced ?? defaults;
    return;
  }

  const next: Record<string, unknown> = { ...defaults };
  if (isPlainObject(payload)) {
    for (const key of Object.keys(payload)) {
      const coerced = coerceFieldValue(store, key, payload[key]);
      if (coerced === undefined) skipped.push(`${name}.${key}`);
      else next[key] = coerced;
    }
  }
  store.value = next;
}

/** Apply the ticked part of a parsed file, straight to the signals: this runs
 *  from the app bar, nowhere near the pane's Save, so drafts on it are dropped. */
export function applySettingsFile(
  parsed: ParsedSettingsFile,
  selection: TransferSelection
): ImportReport {
  const skipped: string[] = [];
  const touched: SettingStore[] = [];

  for (const store of selection.world) {
    if (!parsed.world.includes(store)) continue;
    applyStore(store, payloadFor(parsed.file.world, getStoreName(store) ?? ''), skipped);
    touched.push(store);
  }
  for (const store of selection.scan) {
    if (!parsed.scan.includes(store)) continue;
    applyStore(store, payloadFor(parsed.file.scan, getStoreName(store) ?? ''), skipped);
    touched.push(store);
  }
  for (const src of selection.excludeSrcs) {
    const entry = parsed.excludes.find((e) => e.src === src);
    if (entry) setExcludesFor(entry.src, entry.paths);
  }

  dropDrafts(touched);
  return { skipped };
}
