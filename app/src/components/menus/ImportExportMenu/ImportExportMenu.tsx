// components/menus/ImportExportMenu — settings as a file you can keep, move to
// another browser, or hand to someone else. Both directions are a checklist, so
// neither is all-or-nothing. Groups come in as a prop: what is transferable, and
// under what name, is the app's call rather than this panel's.

import './ImportExportMenu.css';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { ArrowDownUp, FolderInput, Download } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/menus/Popover/Popover';
import { useCity } from '@/state/city/context';
import {
  buildSettingsFile,
  parseSettingsFile,
  applySettingsFile,
  excludesOrigin,
  storePart,
  excludesPart,
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
const EXPORT_SCAN_NOTE = 'Only for the repo you have open';

// What the dot beside a row means, which is a different thing per direction.
const DOT_TITLE: Record<'export' | 'import', string> = {
  export: 'Changed from default',
  import: 'Would change what you have now',
};

/** Which face the panel is showing. Export is where it opens and where every
 *  other face goes back to. */
enum Mode {
  Export = 'export',
  Import = 'import',
  Error = 'error',
  Done = 'done',
}

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
  /** Said under the label, for a row whose scope is not what you would assume. */
  note?: string;
}

const EXCLUDES_ROW = 'excludes';

function groupRow(group: TransferGroup, parts: TransferPart[]): TransferRow {
  return { id: `group:${group.key}`, label: group.label, family: group.family, parts };
}

function excludesRow(part: TransferPart, note: string): TransferRow {
  return {
    id: EXCLUDES_ROW,
    label: 'Excluded from City',
    family: part.family,
    parts: [part],
    note,
  };
}

function partsOf(group: TransferGroup): TransferPart[] {
  return group.stores.map((s) => storePart(s, group.family)).filter((p) => p !== null);
}

/** Every part this build will accept from a file. Nothing outside it can be
 *  applied, however a hand-edited file names it. */
function catalogueOf(groups: readonly TransferGroup[], excludes: TransferPart): TransferPart[] {
  return [...groups.flatMap(partsOf), excludes];
}

/** Everything this browser could send: every group, plus what the open project
 *  hides. Always offered, since "I hide nothing" is a thing worth sending. */
function exportRows(
  groups: readonly TransferGroup[],
  excludes: TransferPart,
  note: string
): TransferRow[] {
  return [...groups.map((g) => groupRow(g, partsOf(g))), excludesRow(excludes, note)];
}

/** Only what the file actually carries, so an import never offers to reset a
 *  section its author chose not to send. */
function importRows(
  groups: readonly TransferGroup[],
  excludes: TransferPart,
  parsed: ParsedSettingsFile,
  note: string
): TransferRow[] {
  const carried = new Set(parsed.parts.map((p) => `${p.family}/${p.key}`));
  const held = (part: TransferPart) => carried.has(`${part.family}/${part.key}`);
  return exportRows(groups, excludes, note)
    .map((row) => ({ ...row, parts: row.parts.filter(held) }))
    .filter((row) => row.parts.length > 0);
}

/** What to say under the excludes row. Naming the repo beats warning about it:
 *  the city on screen may well be the one the file came from. */
function scanNoteFor(mode: Mode, parsed: ParsedSettingsFile | null): string {
  if (mode !== Mode.Import || !parsed) return EXPORT_SCAN_NOTE;
  const origin = excludesOrigin(parsed);
  if (!origin) return 'Saved per repo';
  const branch = origin.branch ? `@${origin.branch}` : '';
  return `Saved for ${origin.src}${branch}`;
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

export interface ImportExportMenuProps {
  groups: readonly TransferGroup[];
}

export function ImportExportMenu({ groups }: ImportExportMenuProps) {
  const { source } = useCity();
  // This project's hidden paths: whose list travels is a question about which
  // repo is open, so the part is made here rather than imported ready-made.
  const excludes = useMemo(() => excludesPart(source), [source]);
  const open = useSignal(false);
  const [mode, setMode] = useState<Mode>(Mode.Export);
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
    setMode(Mode.Export);
    setParsed(null);
    setError(null);
    setReport(null);
  }, [isOpen]);

  const scanNote = scanNoteFor(mode, parsed);
  // Against the file on the way in, against the defaults on the way out: the
  // same question, and the same dot, asked of two different baselines.
  const payloadFor = (part: TransferPart): unknown =>
    mode === Mode.Import && parsed ? parsed.file[part.family]?.[part.key] : undefined;
  const dotTitle = mode === Mode.Import ? DOT_TITLE.import : DOT_TITLE.export;
  const rows =
    mode === Mode.Import && parsed
      ? importRows(groups, excludes, parsed, scanNote)
      : exportRows(groups, excludes, scanNote);
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
      setParsed(parseSettingsFile(await file.text(), catalogueOf(groups, excludes)));
      setOff(new Set());
      setMode(Mode.Import);
    } catch (e) {
      setError(e instanceof SettingsFileError ? e.message : 'That file could not be read.');
      setMode(Mode.Error);
    }
  };

  const onApply = () => {
    if (!parsed) return;
    setReport(applySettingsFile(parsed, selectionFrom(rows, off)));
    setMode(Mode.Done);
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
                  aria-describedby={row.note ? `transfer-note-${row.id}` : undefined}
                  onChange={(e) => toggleRow(row.id, e.currentTarget.checked)}
                />
                <span class="transfer-row-text">
                  <label class="transfer-row-label" for={`transfer-${row.id}`}>
                    {row.label}
                  </label>
                  {row.note && (
                    <span class="transfer-row-note popover-prose" id={`transfer-note-${row.id}`}>
                      {row.note}
                    </span>
                  )}
                </span>
                {row.parts.some((part) => part.differsFrom(payloadFor(part))) && (
                  <span class="transfer-row-dot" title={dotTitle}>
                    <span class="sr-only">{dotTitle}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      );
    });

  const skipped = report?.skipped.length ?? 0;

  const body = () => {
    if (mode === Mode.Error) {
      return (
        <p class="transfer-message popover-prose" role="alert">
          {error}
        </p>
      );
    }
    if (mode === Mode.Done) {
      return (
        <p class="transfer-message popover-prose" role="status">
          Settings imported.
          {skipped > 0 && ` ${skipped} value${skipped === 1 ? '' : 's'} skipped.`}
        </p>
      );
    }
    return <>{checklist()}</>;
  };

  const actions = (close: (refocus: boolean) => void) => {
    if (mode === Mode.Error) {
      return (
        <button
          type="button"
          class="btn-secondary popover-action transfer-action"
          onClick={() => setMode(Mode.Export)}
        >
          Back
        </button>
      );
    }
    if (mode === Mode.Done) {
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
    if (mode === Mode.Import) {
      return (
        <>
          <button
            type="button"
            class="btn-primary popover-action transfer-action"
            disabled={chosen.length === 0}
            onClick={onApply}
          >
            Apply
          </button>
          <button
            type="button"
            class="btn-secondary popover-action transfer-action"
            onClick={() => setMode(Mode.Export)}
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
          Export
        </button>
        <button
          type="button"
          class="btn-secondary popover-action transfer-action"
          onClick={() => fileRef.current?.click()}
        >
          <FolderInput class="icon" aria-hidden="true" />
          Import
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
