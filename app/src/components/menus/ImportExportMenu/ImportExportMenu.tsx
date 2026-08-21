// components/menus/ImportExportMenu — settings as a file you can keep, move to
// another browser, or hand to someone else. Both directions are a checklist, so
// neither is all-or-nothing. Groups come in as a prop: what is transferable, and
// under what name, is the app's call rather than this panel's.

import './ImportExportMenu.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { ArrowDownUp, FolderInput, Download } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/menus/Popover/Popover';
import { NAMED_EXCLUDES } from '@/state/stores/source';
import type { SettingStore } from '@/state/settings/schema';
import {
  buildSettingsFile,
  parseSettingsFile,
  applySettingsFile,
  SettingsFileError,
  TransferFamily,
  type ImportReport,
  type ParsedSettingsFile,
  type TransferGroup,
  type TransferSelection,
} from '@/state/settings/transfer';

const PANEL_LABEL = 'Import & Export';

const FAMILY_LABEL: Record<TransferFamily, string> = {
  [TransferFamily.World]: 'World',
  [TransferFamily.Scan]: 'Scan',
};

/** One tickable line: a settings group, or one repo's exclude list. */
interface TransferRow {
  id: string;
  label: string;
  hint?: string;
  family: TransferFamily;
  stores: readonly SettingStore[];
  excludeSrc?: string;
}

function pathsHint(count: number): string {
  return `${count} ${count === 1 ? 'path' : 'paths'}`;
}

function groupRow(group: TransferGroup, stores: readonly SettingStore[]): TransferRow {
  return { id: `group:${group.key}`, label: group.label, family: group.family, stores };
}

function excludeRow(src: string, label: string, count: number): TransferRow {
  return {
    id: `exclude:${src}`,
    label,
    hint: pathsHint(count),
    family: TransferFamily.Scan,
    stores: [],
    excludeSrc: src,
  };
}

/** Everything this browser could send: every group, plus each exclude list that
 *  can still be named. */
function exportRows(
  groups: readonly TransferGroup[],
  excludes: readonly { src: string; label: string; paths: string[] }[]
): TransferRow[] {
  return [
    ...groups.map((g) => groupRow(g, g.stores)),
    ...excludes.map((e) => excludeRow(e.src, e.label, e.paths.length)),
  ];
}

/** Only what the file actually carries, so an import never offers to reset a
 *  section its author chose not to send. */
function importRows(groups: readonly TransferGroup[], parsed: ParsedSettingsFile): TransferRow[] {
  const covered = new Set<SettingStore>([...parsed.world, ...parsed.scan]);
  const rows: TransferRow[] = [];
  for (const group of groups) {
    const stores = group.stores.filter((s) => covered.has(s));
    if (stores.length > 0) rows.push(groupRow(group, stores));
  }
  for (const entry of parsed.excludes) {
    rows.push(excludeRow(entry.src, entry.src, entry.paths.length));
  }
  return rows;
}

function selectionFrom(rows: readonly TransferRow[], off: ReadonlySet<string>): TransferSelection {
  const world: SettingStore[] = [];
  const scan: SettingStore[] = [];
  const excludeSrcs: string[] = [];
  for (const row of rows) {
    if (off.has(row.id)) continue;
    if (row.excludeSrc) excludeSrcs.push(row.excludeSrc);
    else if (row.family === TransferFamily.World) world.push(...row.stores);
    else scan.push(...row.stores);
  }
  return { world, scan, excludeSrcs };
}

// In the document, and revoked a tick late: some browsers cancel the download if
// the anchor is detached, or if its blob goes away in the same task as the click.
function downloadJson(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportFilename(): string {
  return `codecity-settings-${new Date().toISOString().slice(0, 10)}.json`;
}

type Mode = 'export' | 'import' | 'error' | 'done';

export interface ImportExportMenuProps {
  groups: readonly TransferGroup[];
}

export function ImportExportMenu({ groups }: ImportExportMenuProps) {
  const open = useSignal(false);
  const [mode, setMode] = useState<Mode>('export');
  const [parsed, setParsed] = useState<ParsedSettingsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  // Rows the user turned OFF, so a list that grows (a new group, a newly
  // excluded repo) arrives ticked instead of silently left out.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const isOpen = open.value;
  // Reopening starts at the export list: an import's outcome belongs to the run
  // that produced it, not to the next time you reach for the panel.
  useEffect(() => {
    if (!isOpen) return;
    setMode('export');
    setParsed(null);
    setError(null);
    setReport(null);
  }, [isOpen]);

  const rows =
    mode === 'import' && parsed
      ? importRows(groups, parsed)
      : exportRows(groups, NAMED_EXCLUDES.value);
  const chosen = rows.filter((r) => !off.has(r.id));

  const toggleRow = (id: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(id);
    else next.add(id);
    setOff(next);
  };

  const toggleFamily = (family: TransferFamily, on: boolean) => {
    const next = new Set(off);
    for (const row of rows) {
      if (row.family !== family) continue;
      if (on) next.delete(row.id);
      else next.add(row.id);
    }
    setOff(next);
  };

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ''; // so re-picking the same file fires change again
    if (!file) return;
    try {
      setParsed(parseSettingsFile(await file.text()));
      setOff(new Set());
      setMode('import');
    } catch (e) {
      setError(e instanceof SettingsFileError ? e.message : 'That file could not be read.');
      setMode('error');
    }
  };

  const onApply = () => {
    if (!parsed) return;
    setReport(applySettingsFile(parsed, selectionFrom(rows, off)));
    setMode('done');
  };

  const families = Object.values(TransferFamily).filter((f) => rows.some((r) => r.family === f));

  const checklist = () =>
    families.map((family) => {
      const inFamily = rows.filter((r) => r.family === family);
      const onCount = inFamily.filter((r) => !off.has(r.id)).length;
      return (
        <section key={family} class="popover-group">
          <div class="popover-group-head">
            <input
              type="checkbox"
              class="setting-toggle"
              id={`transfer-family-${family}`}
              checked={onCount === inFamily.length}
              indeterminate={onCount > 0 && onCount < inFamily.length}
              onChange={(e) => toggleFamily(family, e.currentTarget.checked)}
            />
            <label class="popover-group-title" for={`transfer-family-${family}`}>
              {FAMILY_LABEL[family]}
            </label>
          </div>
          <ul class="transfer-list">
            {inFamily.map((row) => (
              <li key={row.id} class="transfer-row">
                <input
                  type="checkbox"
                  class="setting-toggle"
                  id={`transfer-${row.id}`}
                  checked={!off.has(row.id)}
                  onChange={(e) => toggleRow(row.id, e.currentTarget.checked)}
                />
                <label class="transfer-row-label" for={`transfer-${row.id}`}>
                  {row.label}
                </label>
                {row.hint && <span class="transfer-row-hint">{row.hint}</span>}
              </li>
            ))}
          </ul>
        </section>
      );
    });

  const body = () => {
    if (mode === 'error') {
      return (
        <p class="transfer-message" role="alert">
          {error}
        </p>
      );
    }
    if (mode === 'done') {
      return (
        <p class="transfer-message" role="status">
          Settings imported.
          {report && report.skipped.length > 0 && (
            <>
              {` ${report.skipped.length} value${report.skipped.length === 1 ? '' : 's'} in the file did not fit this build and stayed at their defaults.`}
            </>
          )}
        </p>
      );
    }
    return (
      <>
        {/* Above the list in import, not under it: it changes what you tick. */}
        {mode === 'import' && (
          <p class="transfer-lede">
            Each ticked section is replaced by the file&rsquo;s version of it. Sections the file
            does not carry are left alone.
          </p>
        )}
        {checklist()}
        {mode === 'export' && (
          <p class="popover-hint">
            Settings live in this browser only, so a file is how they travel.
          </p>
        )}
      </>
    );
  };

  const actions = (close: (refocus: boolean) => void) => {
    if (mode === 'error') {
      return (
        <button
          type="button"
          class="btn-secondary popover-action"
          onClick={() => setMode('export')}
        >
          Back
        </button>
      );
    }
    if (mode === 'done') {
      return (
        <button type="button" class="btn-primary popover-action" onClick={() => close(true)}>
          Done
        </button>
      );
    }
    if (mode === 'import') {
      return (
        <>
          <button
            type="button"
            class="btn-primary popover-action"
            disabled={chosen.length === 0}
            onClick={onApply}
          >
            Apply selected
          </button>
          <button
            type="button"
            class="btn-secondary popover-action"
            onClick={() => setMode('export')}
          >
            Cancel
          </button>
        </>
      );
    }
    return (
      <>
        <button
          type="button"
          class="btn-primary popover-action"
          disabled={chosen.length === 0}
          onClick={() =>
            downloadJson(
              exportFilename(),
              JSON.stringify(buildSettingsFile(selectionFrom(rows, off)), null, 2)
            )
          }
        >
          <Download class="icon" aria-hidden="true" />
          Export selected
        </button>
        <button
          type="button"
          class="btn-secondary popover-action"
          onClick={() => fileRef.current?.click()}
        >
          <FolderInput class="icon" aria-hidden="true" />
          Import from a file
        </button>
      </>
    );
  };

  return (
    <Popover
      label={PANEL_LABEL}
      placement={PopoverPlacement.AboveStart}
      triggerTitle={PANEL_LABEL}
      openSignal={open}
      trigger={<ArrowDownUp class="icon" aria-hidden="true" />}
      footer={actions}
    >
      {() => (
        <>
          {body()}
          {/* Outside the mode branches: unmounting the input mid-pick would drop
              the change event that carries the chosen file. */}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onFile(e.currentTarget)}
          />
        </>
      )}
    </Popover>
  );
}
