import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  settingSignal,
  markSettingStore,
  _unregisterForTests,
  FieldKind,
  ChangeRoute,
  type FieldMap,
} from '@/state/settings/schema';
import { persistedSignal } from '@/state/persist';
import {
  buildSettingsFile,
  parseSettingsFile,
  applySettingsFile,
  SettingsFileError,
  SETTINGS_FILE_KIND,
  SETTINGS_FILE_VERSION,
  type TransferSelection,
} from '@/state/settings/transfer';
import { setDraft, getEffective, _resetForTests as resetDrafts } from '@/state/settings/drafts';
import { EXCLUDES, setExcludesFor } from '@/state/stores/source';
import { sourceKey } from '@/utils/sources';

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

beforeEach(() => {
  localStorage.clear();
  resetDrafts();
  STORE.value = { ...DEFAULTS };
  SCALAR.value = 'stock';
  EXCLUDES.value = {};
});

afterAll(() => {
  _unregisterForTests(STORE);
  _unregisterForTests(SCALAR);
});

const worldOnly: TransferSelection = { world: [STORE], scan: [], excludeSrcs: [] };

describe('buildSettingsFile', () => {
  it('stamps the kind and version every reader checks first', () => {
    const file = buildSettingsFile(worldOnly);
    expect(file.kind).toBe(SETTINGS_FILE_KIND);
    expect(file.version).toBe(SETTINGS_FILE_VERSION);
  });

  it('carries only the fields that differ from their defaults', () => {
    STORE.value = { A: 9, B: true };
    expect(buildSettingsFile(worldOnly).world).toEqual({ TEST_TRANSFER: { A: 9 } });
  });

  // An empty object is not noise: it is how the file says "this section
  // travelled, and it is stock", which is what lets an import reproduce a look.
  it('carries a selected store with no overrides as an empty object', () => {
    expect(buildSettingsFile(worldOnly).world).toEqual({ TEST_TRANSFER: {} });
  });

  it('carries a scalar store whole, since it has no diff to take', () => {
    SCALAR.value = 'nord';
    const file = buildSettingsFile({ world: [SCALAR], scan: [], excludeSrcs: [] });
    expect(file.world).toEqual({ TEST_TRANSFER_SCALAR: 'nord' });
  });

  it('leaves a family off entirely when nothing in it was selected', () => {
    const file = buildSettingsFile(worldOnly);
    expect(file.world).toBeDefined();
    expect(file.scan).toBeUndefined();
  });

  it('sends exclude lists under their src, not the hash they are stored by', () => {
    setExcludesFor(SRC, ['vendor', 'dist']);
    const file = buildSettingsFile({ world: [], scan: [], excludeSrcs: [SRC] });
    expect(file.scan).toEqual({ EXCLUDES: [{ src: SRC, paths: ['dist', 'vendor'] }] });
  });
});

describe('parseSettingsFile', () => {
  const text = (obj: unknown) => JSON.stringify(obj);

  it('refuses a file that is not JSON', () => {
    expect(() => parseSettingsFile('{nope')).toThrow(SettingsFileError);
  });

  it('refuses a JSON file that is not ours', () => {
    expect(() => parseSettingsFile(text({ version: 1, world: {} }))).toThrow(SettingsFileError);
  });

  // A file that outlives a shape change must refuse rather than half-apply.
  it('refuses a file written by a different version', () => {
    const file = { ...buildSettingsFile(worldOnly), version: SETTINGS_FILE_VERSION + 1 };
    expect(() => parseSettingsFile(text(file))).toThrow(/version/);
  });

  it('refuses a file whose stores this build no longer has', () => {
    const file = { kind: SETTINGS_FILE_KIND, version: SETTINGS_FILE_VERSION, world: { GONE: {} } };
    expect(() => parseSettingsFile(text(file))).toThrow(SettingsFileError);
  });

  it('resolves store names to the live stores', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parseSettingsFile(text(buildSettingsFile(worldOnly)));
    expect(parsed.world).toEqual([STORE]);
    expect(parsed.scan).toEqual([]);
  });

  it('reports a name it could not resolve beside the ones it could', () => {
    const file = buildSettingsFile(worldOnly);
    (file.world as Record<string, unknown>).GONE = {};
    const parsed = parseSettingsFile(text(file));
    expect(parsed.world).toEqual([STORE]);
    expect(parsed.unknownStores).toEqual(['GONE']);
  });

  it('reads exclude lists back out of the scan family', () => {
    setExcludesFor(SRC, ['vendor']);
    const file = buildSettingsFile({ world: [], scan: [], excludeSrcs: [SRC] });
    expect(parseSettingsFile(text(file)).excludes).toEqual([{ src: SRC, paths: ['vendor'] }]);
  });
});

describe('applySettingsFile', () => {
  const parse = (sel = worldOnly) => parseSettingsFile(JSON.stringify(buildSettingsFile(sel)));

  it('replaces the section: a field the file does not mention goes back to default', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse(); // carries A only
    STORE.value = { A: 1, B: false }; // ...and the importer has tuned B too
    applySettingsFile(parsed, worldOnly);
    expect(STORE.value).toEqual({ A: 9, B: true });
  });

  it('leaves a store the selection did not tick alone', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse();
    STORE.value = { A: 1, B: false };
    applySettingsFile(parsed, { world: [], scan: [], excludeSrcs: [] });
    expect(STORE.value).toEqual({ A: 1, B: false });
  });

  it('clamps a value the field still accepts rather than dropping it', () => {
    const parsed = parse();
    (parsed.file.world as Record<string, Record<string, unknown>>).TEST_TRANSFER.A = 99;
    const report = applySettingsFile(parsed, worldOnly);
    expect(STORE.value.A).toBe(10);
    expect(report.skipped).toEqual([]);
  });

  it('names a value the schema cannot accept and leaves that field at default', () => {
    const parsed = parse();
    (parsed.file.world as Record<string, Record<string, unknown>>).TEST_TRANSFER.A = 'wide';
    const report = applySettingsFile(parsed, worldOnly);
    expect(STORE.value.A).toBe(5);
    expect(report.skipped).toEqual(['TEST_TRANSFER.A']);
  });

  it('re-keys an exclude list onto this browser hash of the same src', () => {
    setExcludesFor(SRC, ['vendor']);
    const parsed = parse({ world: [], scan: [], excludeSrcs: [SRC] });
    EXCLUDES.value = {};
    applySettingsFile(parsed, { world: [], scan: [], excludeSrcs: [SRC] });
    expect(EXCLUDES.value).toEqual({ [sourceKey(SRC)]: ['vendor'] });
  });

  // The panel's Save is nowhere near this menu, so a staged edit left behind
  // would put the old value straight back on screen.
  it('drops a staged edit to a store it replaced', () => {
    STORE.value = { A: 9, B: true };
    const parsed = parse();
    STORE.value = { ...DEFAULTS };
    setDraft(STORE, 'A', 2);
    applySettingsFile(parsed, worldOnly);
    expect(getEffective(STORE, 'A')).toBe(9);
  });

  it('round-trips a tuned store through a file back to the same values', () => {
    STORE.value = { A: 7, B: false };
    SCALAR.value = 'nord';
    const sel = { world: [STORE, SCALAR], scan: [], excludeSrcs: [] };
    const parsed = parseSettingsFile(JSON.stringify(buildSettingsFile(sel)));
    STORE.value = { ...DEFAULTS };
    SCALAR.value = 'stock';
    applySettingsFile(parsed, sel);
    expect(STORE.value).toEqual({ A: 7, B: false });
    expect(SCALAR.value).toBe('nord');
  });
});
