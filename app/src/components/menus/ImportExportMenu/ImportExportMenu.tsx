// components/menus/ImportExportMenu — settings as a file you can keep, move to
// another browser, or hand to someone else. Both directions are a checklist, so
// neither is all-or-nothing. Groups come in as a prop: what is transferable, and
// under what name, is the app's call rather than this panel's.

import './ImportExportMenu.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { ArrowDownUp, FolderInput, Download } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/menus/Popover/Popover';
import {
  buildSettingsFile,
  parseSettingsFile,
  applySettingsFile,
  excludesOrigin,
  storePart,
  EXCLUDES_PART,
  SettingsFileError,
  TransferFamily,
  type ImportReport,
  type ParsedSettingsFile,
  type TransferGroup,
  type TransferPart,
} from '@/state/settings/transfer';

const PANEL_LABEL = 'Import & Export';

// Under the family it qualifies, the way ScanMenu footnotes its own excludes.
// Excludes are the one thing here whose scope is not the whole app.
const EXPORT_SCAN_NOTE = 'Only for the repo you have open.';

// One per menu these settings actually live in, so the picker names them the
// way you already know them.
const FAMILY_LABEL: Record<TransferFamily, string> = {
  [TransferFamily.Render]: 'Render Settings',
  [TransferFamily.Appearance]: 'Appearance',
  [TransferFamily.Scan]: 'Scan Settings',
};

/** One tickable line, and the parts behind it. Nothing here knows whether a
 *  part is a settings store or the exclude list. */
interface TransferRow {
  id: string;
  label: string;
  family: TransferFamily;
  parts: TransferPart[];
}

function groupRow(group: TransferGroup, parts: TransferPart[]): TransferRow {
  return { id: `group:${group.key}`, label: group.label, family: group.family, parts };
}

function excludesRow(): TransferRow {
  return {
    id: 'excludes',
    label: 'Excluded from city',
    family: EXCLUDES_PART.family,
    parts: [EXCLUDES_PART],
  };
}

function partsOf(group: TransferGroup): TransferPart[] {
  return group.stores.map((s) => storePart(s, group.family)).filter((p) => p !== null);
}

/** Everything this browser could send: every group, plus what the open project
 *  hides. Always offered, since "I hide nothing" is a thing worth sending. */
function exportRows(groups: readonly TransferGroup[]): TransferRow[] {
  return [...groups.map((g) => groupRow(g, partsOf(g))), excludesRow()];
}

/** Only what the file actually carries, so an import never offers to reset a
 *  section its author chose not to send. */
function importRows(groups: readonly TransferGroup[], parsed: ParsedSettingsFile): TransferRow[] {
  const carried = new Set(parsed.parts.map((p) => `${p.family}/${p.key}`));
  const held = (part: TransferPart) => carried.has(`${part.family}/${part.key}`);
  return exportRows(groups)
    .map((row) => ({ ...row, parts: row.parts.filter(held) }))
    .filter((row) => row.parts.length > 0);
}

function selectionFrom(rows: readonly TransferRow[], off: ReadonlySet<string>): TransferPart[] {
  return rows.filter((row) => !off.has(row.id)).flatMap((row) => row.parts);
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

  const rows = mode === 'import' && parsed ? importRows(groups, parsed) : exportRows(groups);
  // Naming the repo beats warning about it: the city on screen may well be it.
  const origin = mode === 'import' && parsed ? excludesOrigin(parsed) : null;
  const scanNote =
    mode !== 'import'
      ? EXPORT_SCAN_NOTE
      : origin
        ? `Saved for ${origin.src}${origin.branch ? `@${origin.branch}` : ''}`
        : 'Saved per repo.';
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
      // The catalogue is the authority on what may travel: a hand-edited file
      // naming something outside it (auto-refresh, say) resolves to nothing.
      setParsed(
        parseSettingsFile(
          await file.text(),
          exportRows(groups).flatMap((r) => r.parts)
        )
      );
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
          <div class="transfer-body">
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
                </li>
              ))}
            </ul>
            {family === TransferFamily.Scan && <p class="popover-hint popover-prose">{scanNote}</p>}
          </div>
        </section>
      );
    });

  const body = () => {
    if (mode === 'error') {
      return (
        <p class="transfer-message popover-prose" role="alert">
          {error}
        </p>
      );
    }
    if (mode === 'done') {
      return (
        <p class="transfer-message popover-prose" role="status">
          Settings imported.
          {report && report.skipped.length > 0 && (
            <>
              {` ${report.skipped.length} value${report.skipped.length === 1 ? '' : 's'} in the file did not fit this build and stayed at their defaults.`}
            </>
          )}
        </p>
      );
    }
    return <>{checklist()}</>;
  };

  const actions = (close: (refocus: boolean) => void) => {
    if (mode === 'error') {
      return (
        <button
          type="button"
          class="btn-secondary popover-action transfer-action"
          onClick={() => setMode('export')}
        >
          Back
        </button>
      );
    }
    if (mode === 'done') {
      return (
        <button
          type="button"
          class="btn-primary popover-action transfer-action"
          onClick={() => close(true)}
        >
          Done
        </button>
      );
    }
    if (mode === 'import') {
      return (
        <>
          <button
            type="button"
            class="btn-primary popover-action transfer-action"
            disabled={chosen.length === 0}
            onClick={onApply}
          >
            Apply selected
          </button>
          <button
            type="button"
            class="btn-secondary popover-action transfer-action"
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
          class="btn-primary popover-action transfer-action"
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
          class="btn-secondary popover-action transfer-action"
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
