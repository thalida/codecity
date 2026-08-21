// state/settings/transfer.ts — settings as a file: what an export writes, and
// what an import is allowed to put back. Which settings are offered, and under
// what names, is the controls layer's call; this only moves them. See README.md.

import { getStoreName, getDefault } from '@/state/persist';
import { CURRENT_SOURCE, activeExcludePathsFor, setExcludesFor } from '@/state/stores/source';
import { cityHref, navigate } from '@/router/location';
import { coerceFieldValue, forEachSettingStore, type SettingStore } from './schema';
import { dropDrafts } from './drafts';

/** Identifies the file as ours before anything reads its contents. */
export const SETTINGS_FILE_KIND = 'codecity-settings';

/** Bumped when a shape change would make an older file mean something else. A
 *  file from another version is refused rather than half-applied. */
export const SETTINGS_FILE_VERSION = 1;

/** Reserved keys under `source`: the project itself, and what it hides. Every
 *  other key in a family is a store's persisted name. */
const EXCLUDES_KEY = 'EXCLUDES';
const PROJECT_KEY = 'PROJECT';

/** The project a file was exported from, and that importing it opens. */
export interface TransferProject {
  src: string;
  branch?: string;
}

/** The file. A store appears under its family iff it was selected, `{}` meaning
 *  "sent, and stock": that is what lets an import reproduce a whole look. */
export interface SettingsFile extends Partial<Record<TransferFamily, Record<string, unknown>>> {
  kind: typeof SETTINGS_FILE_KIND;
  version: number;
}

/** The file's top-level parts, one per menu the settings actually live in.
 *  Each is a key in the file; adding one is this line. */
export enum TransferFamily {
  Render = 'render',
  Appearance = 'appearance',
  Source = 'source',
}

export const TRANSFER_FAMILIES: readonly TransferFamily[] = Object.values(TransferFamily);

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
export type TransferSelection = Record<TransferFamily, readonly SettingStore[]> & {
  /** Whether the open project's exclude list travels. */
  excludes: boolean;
  /** Whether the project itself travels, so importing opens it. */
  project: boolean;
};

/** An empty selection, to spread a partial one over. */
export function noSelection(): TransferSelection {
  const sel = { excludes: false, project: false } as unknown as TransferSelection;
  for (const family of TRANSFER_FAMILIES) sel[family] = [];
  return sel;
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

// Every value, defaults included: the file is a snapshot of how things look
// right now, not a list of what was changed away from stock.
function familyPayload(stores: readonly SettingStore[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const store of stores) {
    const name = getStoreName(store);
    if (name) out[name] = store.value;
  }
  return out;
}

/** Build the file for a selection. Families the selection does not touch are
 *  left off entirely, so a render-only export is a file with no `scan` key. */
export function buildSettingsFile(selection: TransferSelection): SettingsFile {
  const file: SettingsFile = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION };

  const current = CURRENT_SOURCE.peek();
  for (const family of TRANSFER_FAMILIES) {
    const payload = familyPayload(selection[family]);
    if (family === TransferFamily.Source) {
      // An empty list is a real answer, not a missing one: "I hide nothing here".
      if (selection.excludes) {
        payload[EXCLUDES_KEY] = current ? activeExcludePathsFor(current.src) : [];
      }
      if (selection.project && current) {
        payload[PROJECT_KEY] = {
          src: current.src,
          ...(current.branch ? { branch: current.branch } : {}),
        } satisfies TransferProject;
      }
    }
    if (Object.keys(payload).length > 0) file[family] = payload;
  }

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
  stores: Record<TransferFamily, SettingStore[]>;
  /** Hidden paths the file carries, or null if it carries none at all. */
  excludes: string[] | null;
  /** The project the file was exported from, or null if it carries none. */
  project: TransferProject | null;
  /** Names the file carried that resolve to nothing. Reported rather than
   *  ignored: a file that only half-applies should say so. */
  unknownStores: string[];
}

function parseExcludes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.every((p) => typeof p === 'string')) return null;
  return raw as string[];
}

function parseProject(raw: unknown): TransferProject | null {
  if (!isPlainObject(raw)) return null;
  const { src, branch } = raw;
  if (typeof src !== 'string' || !src) return null;
  return typeof branch === 'string' && branch ? { src, branch } : { src };
}

function resolveFamily(
  raw: unknown,
  byName: Map<string, SettingStore>,
  unknown: string[]
): SettingStore[] {
  if (!isPlainObject(raw)) return [];
  const stores: SettingStore[] = [];
  for (const name of Object.keys(raw)) {
    if (name === EXCLUDES_KEY || name === PROJECT_KEY) continue;
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
  const stores = {} as Record<TransferFamily, SettingStore[]>;
  let found = 0;
  for (const family of TRANSFER_FAMILIES) {
    stores[family] = resolveFamily(file[family], byName, unknownStores);
    found += stores[family].length;
  }
  const source = file[TransferFamily.Source];
  const excludes = parseExcludes(isPlainObject(source) ? source[EXCLUDES_KEY] : undefined);
  const project = parseProject(isPlainObject(source) ? source[PROJECT_KEY] : undefined);
  if (found === 0 && excludes === null && project === null) {
    throw new SettingsFileError('That file holds no settings this build recognises.');
  }
  return { file, stores, excludes, project, unknownStores };
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

  for (const family of TRANSFER_FAMILIES) {
    for (const store of selection[family]) {
      if (!parsed.stores[family].includes(store)) continue;
      applyStore(store, payloadFor(parsed.file[family], getStoreName(store) ?? ''), skipped);
      touched.push(store);
    }
  }
  // Onto the project this import lands you in: the one it opens if the project
  // travelled, else the one already open. The list itself names no project.
  const opening = selection.project ? parsed.project : null;
  const src = opening?.src ?? CURRENT_SOURCE.peek()?.src;
  if (selection.excludes && parsed.excludes && src) setExcludesFor(src, parsed.excludes);
  if (opening) navigate(cityHref(opening.src, opening.branch));

  dropDrafts(touched);
  return { skipped };
}
