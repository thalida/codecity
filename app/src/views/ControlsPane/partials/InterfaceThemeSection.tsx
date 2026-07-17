// views/ControlsPane/partials/InterfaceThemeSection.tsx — Accent + surface
// preset pickers for the Appearance tab. Each axis is a radiogroup of color
// swatches: one tab stop, arrow keys move focus AND selection (the WAI-ARIA
// radio pattern). Picking one write-through-applies (autosave, no Save step).
// A chip
// carries the same data-cc-* attribute its preset uses, so its color resolves
// from themes.css via var(--cc-accent) / var(--cc-bg-app) with no duplicated
// hex. Reset is hand-rolled (ResetButton only supports keyed object stores;
// these are scalar signals, so we stageReset with a null key like the syntax
// picker).

import './InterfaceThemeSection.css';
import { useRef } from 'preact/hooks';
import { RotateCcw } from 'lucide-preact';
import { getEffective, setDraft, stageReset, DRAFTS_REV } from '@/state/settingsDrafts';
import {
  ACCENT_THEME,
  ACCENT_THEME_DEFAULT,
  ACCENT_PRESETS,
  SURFACE_THEME,
  SURFACE_THEME_DEFAULT,
  SURFACE_PRESETS,
  type ThemePresetOption,
} from '@/state/stores/settings/theme';
import { SettingRow } from '@/components/SettingRow/SettingRow';
import { Section } from '@/components/Section/Section';

interface SignalLike {
  get value(): string;
  set value(v: string);
}

interface SwatchRowProps {
  label: string;
  tip: string;
  axis: 'accent' | 'surface';
  store: SignalLike;
  options: ThemePresetOption[];
  defaultValue: string;
}

function SwatchRow({ label, tip, axis, store, options, defaultValue }: SwatchRowProps) {
  const current = (getEffective(store, null) as string) ?? defaultValue;
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current)
  );
  // Accent chips show the flat accent; surface chips show the full surface
  // ladder as a gradient (app -> chrome -> sidebar) so the otherwise near-black
  // tint reads at the lighter sidebar end and the presets are distinguishable.
  const chipVar =
    axis === 'accent'
      ? 'var(--cc-accent)'
      : 'linear-gradient(135deg, var(--cc-bg-app), var(--cc-bg-chrome), var(--cc-bg-sidebar))';
  const defaultLabel = options.find((o) => o.value === defaultValue)?.label ?? defaultValue;

  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (value: string) => setDraft(store, null, value);

  const onKeyDown = (e: KeyboardEvent) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    // Move selection AND focus together (WAI-ARIA radiogroup): flipping
    // tabIndex on re-render doesn't move the browser's focus, so do it here.
    const next = (activeIndex + delta + options.length) % options.length;
    select(options[next].value);
    btnRefs.current[next]?.focus();
  };

  // Per-row reset lives in SettingRow's head slot (right of the label), the same
  // place every schema-driven row's reset sits, so all tabs line up.
  const resetBtn = (
    <button
      type="button"
      class="theme-row-reset"
      title={`Default: ${defaultLabel}`}
      aria-label={`Reset ${label.toLowerCase()} to default`}
      disabled={current === defaultValue}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stageReset(store, null);
      }}
    >
      <RotateCcw class="icon" />
    </button>
  );
  return (
    <SettingRow label={label} tip={tip} resetSlot={resetBtn}>
      <span class="swatch-group" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((opt, i) => {
          const checked = opt.value === current;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={opt.label}
              title={opt.label}
              tabIndex={i === activeIndex ? 0 : -1}
              class={checked ? 'swatch is-active' : 'swatch'}
              onClick={() => select(opt.value)}
            >
              <span
                class="swatch-chip"
                style={{ background: chipVar }}
                {...{ [`data-cc-${axis}`]: opt.value }}
              />
              <span class="swatch-label">{opt.label}</span>
            </button>
          );
        })}
      </span>
    </SettingRow>
  );
}

export function InterfaceThemeSection() {
  void DRAFTS_REV.value; // re-render on write-through / reset
  const accentDiffers = getEffective(ACCENT_THEME, null) !== ACCENT_THEME_DEFAULT;
  const surfaceDiffers = getEffective(SURFACE_THEME, null) !== SURFACE_THEME_DEFAULT;
  return (
    <Section
      name="Interface theme"
      defaultOpen
      onReset={() => {
        stageReset(ACCENT_THEME, null);
        stageReset(SURFACE_THEME, null);
      }}
      resetEnabled={accentDiffers || surfaceDiffers}
      resetTitle="Reset interface theme to defaults"
    >
      <SwatchRow
        label="Accent"
        tip="Accent color for buttons, links, and highlights; applies immediately."
        axis="accent"
        store={ACCENT_THEME}
        options={ACCENT_PRESETS}
        defaultValue={ACCENT_THEME_DEFAULT}
      />
      <SwatchRow
        label="Surface"
        tip="Background palette for panels and chrome; applies immediately."
        axis="surface"
        store={SURFACE_THEME}
        options={SURFACE_PRESETS}
        defaultValue={SURFACE_THEME_DEFAULT}
      />
    </Section>
  );
}
