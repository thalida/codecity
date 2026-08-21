import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ImportExportMenu } from '@/components/menus/ImportExportMenu/ImportExportMenu';
import {
  settingSignal,
  _unregisterForTests,
  FieldKind,
  ChangeRoute,
  type FieldMap,
} from '@/state/settings/schema';
import { TransferFamily, type TransferGroup } from '@/state/settings/transfer';
import { CURRENT_SOURCE, EXCLUDES, setExcludesFor } from '@/state/stores/source';
import { flush } from '../_helpers/preact';
import { popoverPanel } from '../_helpers/popover';

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
} satisfies FieldMap;

const LOOK = settingSignal('TEST_MENU_LOOK', FIELDS);
const SCAN = settingSignal('TEST_MENU_SCAN', FIELDS);

const REPO = 'https://github.com/thalida/codecity';

const GROUPS: TransferGroup[] = [
  { key: 'look', label: 'Look', family: TransferFamily.Render, stores: [LOOK] },
  { key: 'theme', label: 'Theme', family: TransferFamily.Appearance, stores: [SCAN] },
];

describe('ImportExportMenu', () => {
  let container: HTMLDivElement;
  let downloaded: string;

  const mount = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => render(<ImportExportMenu groups={GROUPS} />, container));
    act(() => container.querySelector<HTMLButtonElement>('.popover-trigger')!.click());
  };

  const panel = () => popoverPanel()!;
  const rowLabels = () =>
    Array.from(panel().querySelectorAll('.transfer-row-label')).map((el) => el.textContent);
  const box = (label: string): HTMLInputElement => {
    const row = Array.from(panel().querySelectorAll('.transfer-row')).find(
      (li) => li.querySelector('.transfer-row-label')?.textContent === label
    )!;
    return row.querySelector('input')!;
  };
  const button = (text: string): HTMLButtonElement =>
    Array.from(panel().querySelectorAll('button')).find((b) => b.textContent?.includes(text))!;

  const pickFile = async (body: string) => {
    const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([body], 'settings.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await act(async () => {
      await flush();
    });
  };

  beforeEach(() => {
    localStorage.clear();
    LOOK.value = { A: 5 };
    SCAN.value = { A: 5 };
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = { src: REPO };
    downloaded = '';
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        void blob.text().then((t) => (downloaded = t));
        return 'blob:stub';
      },
      revokeObjectURL: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    render(null, container);
    container.remove();
  });

  // Named for the menus these settings live in, and the excludes row is always
  // offered: whether anything is hidden is the export's answer, not its gate.
  it('lists a row per group, under a head per family', () => {
    mount();
    expect(rowLabels()).toEqual(['Look', 'Theme', 'Excluded from city']);
    const heads = Array.from(panel().querySelectorAll('.popover-group-title')).map(
      (el) => el.textContent
    );
    expect(heads).toEqual(['Render Settings', 'Appearance', 'Scan Settings']);
  });

  it('starts with everything ticked, so an export covers what you can see', () => {
    mount();
    expect(box('Look').checked).toBe(true);
    expect(box('Theme').checked).toBe(true);
    expect(box('Excluded from city').checked).toBe(true);
  });

  it('writes only the ticked groups into the file', async () => {
    mount();
    LOOK.value = { A: 9 };
    SCAN.value = { A: 3 };
    act(() => {
      box('Theme').checked = false;
      box('Theme').dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => button('Export selected').click());
    await flush();
    const file = JSON.parse(downloaded);
    expect(file.render).toEqual({ TEST_MENU_LOOK: { A: 9 } });
    expect(file.appearance).toBeUndefined();
  });

  it('turns a whole family off from its head checkbox', () => {
    mount();
    const head = panel().querySelector<HTMLInputElement>('#transfer-family-render')!;
    act(() => {
      head.checked = false;
      head.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(box('Look').checked).toBe(false);
    expect(box('Theme').checked).toBe(true);
  });

  // Naming the repo beats warning about it, since the city on screen may be it.
  it('names the repo an imported exclude list will be filed under', async () => {
    CURRENT_SOURCE.value = { src: REPO, branch: 'main' };
    setExcludesFor(REPO, ['vendor']);
    mount();
    act(() => button('Export selected').click());
    await flush();

    await pickFile(downloaded);
    const note = panel().querySelector('.popover-hint')!;
    expect(note.textContent).toBe(`Saved for ${REPO}@main`);
  });

  it('refuses a file that is not ours, and says why', async () => {
    mount();
    await pickFile('{"hello":true}');
    expect(panel().querySelector('.transfer-message')?.textContent).toMatch(/not a codecity/i);
  });

  it('offers only the sections the file carries', async () => {
    mount();
    LOOK.value = { A: 9 };
    for (const label of ['Theme', 'Excluded from city']) {
      act(() => {
        box(label).checked = false;
        box(label).dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    act(() => button('Export selected').click());
    await flush();
    const body = downloaded;

    LOOK.value = { A: 5 };
    await pickFile(body);
    expect(rowLabels()).toEqual(['Look']);
  });

  it("sends the open project's hidden paths, and nothing about the project", async () => {
    setExcludesFor(REPO, ['vendor']);
    mount();
    act(() => button('Export selected').click());
    await flush();
    expect(JSON.parse(downloaded).scan.EXCLUDES).toEqual({ src: REPO, paths: ['vendor'] });
  });

  it('sends an empty list when the repo hides nothing', async () => {
    mount();
    act(() => button('Export selected').click());
    await flush();
    expect(JSON.parse(downloaded).scan.EXCLUDES).toEqual({ src: REPO, paths: [] });
  });

  it('applies the ticked sections and reports it', async () => {
    mount();
    LOOK.value = { A: 9 };
    act(() => button('Export selected').click());
    await flush();
    const body = downloaded;

    LOOK.value = { A: 1 };
    await pickFile(body);
    act(() => button('Apply selected').click());

    expect(LOOK.value.A).toBe(9);
    expect(panel().querySelector('.transfer-message')?.textContent).toMatch(/imported/i);
  });
});

// The disposable stores must not outlive this file, or they leak into every
// other suite's view of the settings registry.
afterAll(() => {
  _unregisterForTests(LOOK);
  _unregisterForTests(SCAN);
});
