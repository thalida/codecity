import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  settingSignal,
  markSettingStore,
  unregisterSettingStore,
  FieldKind,
  ChangeRoute,
  type FieldMap,
} from '@/features/settings/state/schema';
import { persistedSignal } from '@/lib/persist';
import {
  buildSettingsFile,
  parseSettingsFile,
  applySettingsFile,
  SettingsFileError,
  SETTINGS_FILE_KIND,
  SETTINGS_FILE_VERSION,
  storePart,
  EXCLUDES_PART,
  TransferFamily,
  type TransferPart,
} from '@/features/settings/state/transfer';
import { setDraft, getEffective, discard as resetDrafts } from '@/features/settings/state/drafts';
import { ACTIVE_EXCLUDES, EXCLUDES, setExcludesFor } from '@/state/excludes';
import { CURRENT_SOURCE } from '@/state/source';
import { sourceKey } from '@codecity/city';

const FIELDS = {
  A: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 5,
    min: 0,
    max: 10,
    step: 1,
    label: 'A',
  },
  B: { route: ChangeRoute.Refresh, kind: FieldKind.ToggleField, default: true, label: 'B' },
} satisfies FieldMap;

const STORE = settingSignal('TEST_TRANSFER', FIELDS);
const SCALAR = persistedSignal<string>('TEST_TRANSFER_SCALAR', 'stock');
markSettingStore(SCALAR);

const DEFAULTS = { A: 5, B: true };
const SRC = 'https://github.com/thalida/codecity';
const OTHER_SRC = '/Users/someone/else/codecity';
const THIRD_SRC = 'https://github.com/thalida/other';

beforeEach(() => {
  localStorage.clear();
  resetDrafts();
  STORE.value = { ...DEFAULTS };
  SCALAR.value = 'stock';
  EXCLUDES.value = {};
  CURRENT_SOURCE.value = { src: SRC };
});

afterAll(() => {
  unregisterSettingStore(STORE);
  unregisterSettingStore(SCALAR);
});

const STORE_PART = storePart(STORE, TransferFamily.Render)!;
const SCALAR_PART = storePart(SCALAR, TransferFamily.Appearance)!;

// The catalogue: everything these tests allow to travel. Anything outside it is
// not resolvable by a file, which is the point of passing it to the parser.
const CATALOGUE: TransferPart[] = [STORE_PART, SCALAR_PART, EXCLUDES_PART];

const renderOnly = [STORE_PART];
const excludesOnly = [EXCLUDES_PART];

describe('buildSettingsFile', () => {
  it('stamps the kind and version every reader checks first', () => {
    const file = buildSettingsFile(renderOnly);
    expect(file.kind).toBe(SETTINGS_FILE_KIND);
    expect(file.version).toBe(SETTINGS_FILE_VERSION);
  });

  // A snapshot, not a changelist: the file says what everything IS, so it
  // reproduces a look without depending on what the defaults were that day.
  it('carries every value, defaults included', () => {
    STORE.value = { A: 9, B: true };
    expect(buildSettingsFile(renderOnly).render).toEqual({ TEST_TRANSFER: { A: 9, B: true } });
  });

  it('carries a wholly untouched store at its full default values', () => {
    expect(buildSettingsFile(renderOnly).render).toEqual({ TEST_TRANSFER: DEFAULTS });
  });

  it('carries a scalar store whole, since it has no fields to walk', () => {
    SCALAR.value = 'nord';
    expect(buildSettingsFile([SCALAR_PART]).appearance).toEqual({
      TEST_TRANSFER_SCALAR: 'nord',
    });
  });

  it('leaves a family off entirely when nothing in it was selected', () => {
    const file = buildSettingsFile(renderOnly);
    expect(file.render).toBeDefined();
    expect(file.scan).toBeUndefined();
  });

  it("sends the open repo's hidden paths, and the repo they were tuned against", () => {
    CURRENT_SOURCE.value = { src: SRC, branch: 'main' };
    setExcludesFor(SRC, ['vendor', 'dist']);
    expect(buildSettingsFile(excludesOnly).scan).toEqual({
      EXCLUDES: { src: SRC, branch: 'main', paths: ['dist', 'vendor'] },
    });
  });

  // Not a missing answer: "I hide nothing here" is worth sending, and under
  // replace semantics it is what clears the importer's list.
  it('sends an empty list when the repo hides nothing', () => {
    expect(buildSettingsFile(excludesOnly).scan).toEqual({
      EXCLUDES: { src: SRC, paths: [] },
    });
  });
});

describe('parseSettingsFile', () => {
  const text = (obj: unknown) => JSON.stringify(obj);

  it('refuses a file that is not JSON', () => {
    expect(() => parseSettingsFile('{nope', CATALOGUE)).toThrow(SettingsFileError);
  });

  it('refuses a JSON file that is not ours', () => {
    expect(() => parseSettingsFile(text({ version: 1, render: {} }), CATALOGUE)).toThrow(
      SettingsFileError
    );
  });

  // A file that outlives a shape change must refuse rather than half-apply.
  it('refuses a file written by a different version', () => {
    const file = { ...buildSettingsFile(renderOnly), version: SETTINGS_FILE_VERSION + 1 };
    expect(() => parseSettingsFile(text(file), CATALOGUE)).toThrow(/version/);
  });

  it('refuses a file whose stores this build no longer has', () => {
    const file = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION, render: { GONE: {} } };
    expect(() => parseSettingsFile(text(file), CATALOGUE)).toThrow(SettingsFileError);
  });

  it('resolves a key to the part that owns it', () => {
    STORE.value = { A: 9, B: true };
    expect(parseSettingsFile(text(buildSettingsFile(renderOnly)), CATALOGUE).parts).toEqual([
      STORE_PART,
    ]);
  });

  // The catalogue, not the settings registry, is the authority: a hand-edited
  // file naming something that deliberately never travels resolves to nothing.
  it('refuses a key the catalogue does not offer, even for a real store', () => {
    const file = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION, render: {} };
    (file.render as Record<string, unknown>).LIVE_UPDATES = { POLL_SECONDS: 1 };
    expect(() => parseSettingsFile(text(file), CATALOGUE)).toThrow(SettingsFileError);
  });

  it('reports a key it could not resolve beside the ones it could', () => {
    const file = buildSettingsFile(renderOnly);
    (file.render as Record<string, unknown>).GONE = {};
    const parsed = parseSettingsFile(text(file), CATALOGUE);
    expect(parsed.parts).toEqual([STORE_PART]);
    expect(parsed.unknownKeys).toEqual(['GONE']);
  });

  it('reads the exclude list back out of the scan family', () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parseSettingsFile(text(buildSettingsFile(excludesOnly)), CATALOGUE);
    expect(parsed.parts).toEqual([EXCLUDES_PART]);
    expect(parsed.file.scan?.EXCLUDES).toEqual({ src: SRC, paths: ['vendor'] });
  });
});

describe('applySettingsFile', () => {
  const parse = (sel = renderOnly) =>
    parseSettingsFile(JSON.stringify(buildSettingsFile(sel)), CATALOGUE);

  it('replaces the section, so the importer keeps none of their own tuning', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse();
    STORE.value = { A: 1, B: false };
    applySettingsFile(parsed, renderOnly);
    expect(STORE.value).toEqual({ A: 9, B: true });
  });

  it('leaves a part the selection did not tick alone', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse();
    STORE.value = { A: 1, B: false };
    applySettingsFile(parsed, []);
    expect(STORE.value).toEqual({ A: 1, B: false });
  });

  it('clamps a value the field still accepts rather than dropping it', () => {
    const parsed = parse();
    (parsed.file.render as Record<string, Record<string, unknown>>).TEST_TRANSFER.A = 99;
    const report = applySettingsFile(parsed, renderOnly);
    expect(STORE.value.A).toBe(10);
    expect(report.skipped).toEqual([]);
  });

  it('names a value the schema cannot accept and leaves that field at default', () => {
    const parsed = parse();
    (parsed.file.render as Record<string, Record<string, unknown>>).TEST_TRANSFER.A = 'wide';
    const report = applySettingsFile(parsed, renderOnly);
    expect(STORE.value.A).toBe(5);
    expect(report.skipped).toEqual(['TEST_TRANSFER.A']);
  });

  // The list is about the exporter's repo, so that is where it is filed. The
  // city on screen at import time has nothing to do with it.
  it('files the hidden paths under the repo the file names', () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parse(excludesOnly);
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(EXCLUDES.value).toEqual({ [sourceKey(SRC)]: ['vendor'] });
  });

  // The whole point of filing it rather than applying it: import from anywhere,
  // and the paths are hidden when you actually go to that repo.
  it('has the paths waiting when you later open the repo the file named', () => {
    setExcludesFor(SRC, ['vendor', 'dist']);
    const parsed = parse(excludesOnly);
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(ACTIVE_EXCLUDES.value).toEqual([]);

    CURRENT_SOURCE.value = { src: SRC };
    expect(ACTIVE_EXCLUDES.value).toEqual(['dist', 'vendor']);
  });

  it('leaves the open repo untouched when the file names a different one', () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parse(excludesOnly);
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(EXCLUDES.value[sourceKey(OTHER_SRC)]).toBeUndefined();
  });

  // One slot written, the rest of the map copied across: an import can only
  // ever change the hidden paths of the one repo its list is for.
  it("leaves every other repo's hidden paths alone", () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parse(excludesOnly);
    EXCLUDES.value = { [sourceKey(THIRD_SRC)]: ['keep-me'] };
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(EXCLUDES.value).toEqual({
      [sourceKey(THIRD_SRC)]: ['keep-me'],
      [sourceKey(SRC)]: ['vendor'],
    });
  });

  it('never moves you to the repo the file names', () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parse(excludesOnly);
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(CURRENT_SOURCE.value).toEqual({ src: OTHER_SRC });
  });

  // Exported with nothing open, so the list names no repo to be filed under.
  it('files nothing when the file names no repo', () => {
    CURRENT_SOURCE.value = null;
    const parsed = parse(excludesOnly);
    CURRENT_SOURCE.value = { src: OTHER_SRC };
    applySettingsFile(parsed, excludesOnly);
    expect(EXCLUDES.value).toEqual({});
  });

  // The panel's Save is nowhere near this menu, so a staged edit left behind
  // would put the old value straight back on screen.
  it('drops a staged edit to a store it replaced', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse();
    STORE.value = { ...DEFAULTS };
    setDraft(STORE, 'A', 2);
    applySettingsFile(parsed, renderOnly);
    expect(getEffective(STORE, 'A')).toBe(9);
  });

  it('round-trips a tuned store through a file back to the same values', () => {
    STORE.value = { A: 7, B: false };
    SCALAR.value = 'nord';
    const sel = [STORE_PART, SCALAR_PART];
    const parsed = parseSettingsFile(JSON.stringify(buildSettingsFile(sel)), CATALOGUE);
    STORE.value = { ...DEFAULTS };
    SCALAR.value = 'stock';
    applySettingsFile(parsed, sel);
    expect(STORE.value).toEqual({ A: 7, B: false });
    expect(SCALAR.value).toBe('nord');
  });
});
