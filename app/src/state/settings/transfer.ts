// state/settings/transfer.ts — settings as a file: what an export writes, and
// what an import is allowed to put back. Everything that can travel is a part,
// so nothing downstream knows a settings store from a hidden-path list. Which
// parts are offered, and under what names, is the controls layer's. See README.

import { batch } from '@preact/signals';
import { getStoreName, getDefault } from '@/state/persist';
import { CURRENT_SOURCE, activeExcludePathsFor, setExcludesFor } from '@/state/stores/source';
import { coerceFieldValue, type SettingStore } from './schema';
import { dropDrafts } from './drafts';

/** Identifies the file as ours before anything reads its contents. */
export const SETTINGS_FILE_KIND = 'codecity-settings';

/** Bumped when a shape change would make an older file mean something else. A
 *  file from another version is refused rather than half-applied. */
export const SETTINGS_FILE_VERSION = 1;

/** The file's top-level parts, one per menu the settings actually live in.
 *  Each is a key in the file; adding one is this line. */
export enum TransferFamily {
  Render = 'render',
  Appearance = 'appearance',
  Scan = 'scan',
}

/** The file. A part appears under its family iff it was selected, carrying its
 *  whole value: a snapshot of how things look, not a list of what was changed. */
export interface SettingsFile extends Partial<Record<TransferFamily, Record<string, unknown>>> {
  kind: typeof SETTINGS_FILE_KIND;
  version: number;
}

/** One thing a file can carry. A settings store is one kind and the exclude
 *  list is another; past this interface nothing tells them apart. */
export interface TransferPart {
  /** Its key under its family in the file. Stable across builds. */
  key: string;
  family: TransferFamily;
  /** What goes into the file. */
  read(): unknown;
  /** What a file's value does on the way back in, returning whatever it could
   *  not use as `KEY.field` strings so the UI can say what didn't land. */
  write(value: unknown): string[];
}

/** A named bundle of stores that travels as a unit. The bundles themselves are
 *  the controls layer's to name; this is only their shape. */
export interface TransferGroup {
  key: string;
  label: string;
  family: TransferFamily;
  stores: SettingStore[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const partId = (part: TransferPart): string => `${part.family}/${part.key}`;

// ── A settings store, as a part ─────────────────────────────────────────────

// Replaced, not merged: defaults first, then the file over the top, so "import
// the trees" means their trees rather than theirs crossed with yours.
function writeStore(store: SettingStore, key: string, payload: unknown): string[] {
  const skipped: string[] = [];
  const defaults = getDefault(store);

  if (!isPlainObject(defaults)) {
    const coerced = typeof payload === typeof defaults ? payload : undefined;
    if (payload !== undefined && coerced === undefined) skipped.push(key);
    store.value = coerced ?? defaults;
  } else {
    const next: Record<string, unknown> = { ...defaults };
    if (isPlainObject(payload)) {
      for (const field of Object.keys(payload)) {
        const coerced = coerceFieldValue(store, field, payload[field]);
        if (coerced === undefined) skipped.push(`${key}.${field}`);
        else next[field] = coerced;
      }
    }
    store.value = next;
  }

  // Written straight to the signal, nowhere near the pane's Save, so a draft
  // left staged would put the old value back on screen.
  dropDrafts([store]);
  return skipped;
}

/** A settings store as a part. Null when it is not registered with persistence,
 *  so it has no stable name to travel under. */
export function storePart(store: SettingStore, family: TransferFamily): TransferPart | null {
  const key = getStoreName(store);
  if (!key) return null;
  return {
    key,
    family,
    read: () => store.value,
    write: (value) => writeStore(store, key, value),
  };
}

// ── The open repo's hidden paths, as a part ────────────────────────────────

/** A hidden-path list and the repo it belongs to. An import files it under that
 *  repo, so it is waiting there the next time you open it. */
export interface TransferExcludes {
  src?: string;
  branch?: string;
  paths: string[];
}

function readExcludes(raw: unknown): TransferExcludes | null {
  if (!isPlainObject(raw)) return null;
  const { src, branch, paths } = raw;
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) return null;
  return {
    ...(typeof src === 'string' && src ? { src } : {}),
    ...(typeof branch === 'string' && branch ? { branch } : {}),
    paths: paths as string[],
  };
}

export const EXCLUDES_PART: TransferPart = {
  key: 'EXCLUDES',
  family: TransferFamily.Scan,
  read: () => {
    const current = CURRENT_SOURCE.peek();
    // An empty list is a real answer, not a missing one: "I hide nothing here".
    return {
      ...(current ? { src: current.src } : {}),
      ...(current?.branch ? { branch: current.branch } : {}),
      paths: current ? activeExcludePathsFor(current.src) : [],
    } satisfies TransferExcludes;
  },
  write: (value) => {
    // Onto the repo the list is FOR, which is the exporter's, not whichever
    // city is on screen. Nothing here opens it: it is there when you next go.
    const excludes = readExcludes(value);
    if (excludes?.src) setExcludesFor(excludes.src, excludes.paths);
    return [];
  },
};

// ── Export ─────────────────────────────────────────────────────────────────

/** Build the file from the parts that travel. A family nothing was selected
 *  from is left off entirely, so a render-only export has no `scan` key. */
export function buildSettingsFile(parts: readonly TransferPart[]): SettingsFile {
  const file: SettingsFile = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION };
  for (const part of parts) {
    (file[part.family] ??= {})[part.key] = part.read();
  }
  return file;
}

// ── Import ─────────────────────────────────────────────────────────────────

export class SettingsFileError extends Error {}

/** A file resolved against a catalogue of what may travel. The UI offers
 *  exactly `parts`, and nothing outside the catalogue can ever be applied. */
export interface ParsedSettingsFile {
  file: SettingsFile;
  parts: TransferPart[];
  /** Keys the file carried that the catalogue does not offer. Reported rather
   *  than ignored: a file that only half-applies should say so. */
  unknownKeys: string[];
}

/** Read a file against the catalogue of parts that may travel. Throws with a
 *  message for the user: an untrustworthy file is refused, never guessed at. */
export function parseSettingsFile(
  text: string,
  catalogue: readonly TransferPart[]
): ParsedSettingsFile {
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
  const offered = new Map(catalogue.map((part) => [partId(part), part]));
  const parts: TransferPart[] = [];
  const unknownKeys: string[] = [];
  for (const family of Object.values(TransferFamily)) {
    const payload = file[family];
    if (!isPlainObject(payload)) continue;
    for (const key of Object.keys(payload)) {
      const part = offered.get(`${family}/${key}`);
      if (part) parts.push(part);
      else unknownKeys.push(key);
    }
  }
  if (parts.length === 0) {
    throw new SettingsFileError('That file holds no settings this build recognises.');
  }
  return { file, parts, unknownKeys };
}

/** What an import could not use: a field the file set to something the schema
 *  does not allow, or one this build has dropped. */
export interface ImportReport {
  /** `KEY.field` for each value skipped, so the UI can name what didn't land. */
  skipped: string[];
}

/** Apply the ticked parts of a parsed file. Batched, so the scene reacts once
 *  to a whole import rather than once per store it touches. */
export function applySettingsFile(
  parsed: ParsedSettingsFile,
  selection: readonly TransferPart[]
): ImportReport {
  const carried = new Set(parsed.parts.map(partId));
  const skipped: string[] = [];
  batch(() => {
    for (const part of selection) {
      if (!carried.has(partId(part))) continue;
      skipped.push(...part.write(parsed.file[part.family]?.[part.key]));
    }
  });
  return { skipped };
}
