// ControlsPane/partials/ExcludesSection.tsx — the "Excluded from city" list in
// the Scan settings tab. Shows the loaded repo's UI excludes (rel-paths hidden
// from the city, saved in this browser), each individually restorable. The
// header reset button (same chrome as every other section) restores them all.
// Autosave: removeExclude/clearExcludes write straight through, no draft/Save
// step. Renders its own Section chrome (a render-based SectionNode supplies its
// own header) so it collapses like every other Scan/World section.
import './ExcludesSection.css';
import { EyeOff, RotateCcw } from 'lucide-preact';
import { ACTIVE_EXCLUDES, removeExclude, clearExcludes } from '@/state/stores/excludes';
import { Section } from '@/components/Section/Section';

export function ExcludesSection() {
  const paths = ACTIVE_EXCLUDES.value;
  return (
    <Section
      name="Excluded from city"
      hint={
        <>
          Paths you hide from the city, saved in this browser. This does not change the repo.{' '}
          <a
            class="link--chrome"
            href="https://github.com/thalida/codecity#skipped-by-default"
            target="_blank"
            rel="noopener noreferrer"
          >
            See what&rsquo;s excluded by default.
          </a>
        </>
      }
      onReset={clearExcludes}
      resetEnabled={paths.length > 0}
      resetTitle="Restore all excluded paths"
      defaultOpen
    >
      {paths.length === 0 ? (
        <p class="text-card-sub excludes-empty">
          Nothing excluded. Select a road or building and choose Exclude from city.
        </p>
      ) : (
        <ul class="excludes-list">
          {paths.map((p) => (
            <li key={p} class="excludes-row">
              <EyeOff class="icon excludes-row-icon" aria-hidden="true" />
              <span class="excludes-path text-mono text-truncate" title={p}>
                {p}
              </span>
              <button
                type="button"
                class="setting-row-reset"
                title={`Restore ${p}`}
                aria-label={`Restore ${p}`}
                onClick={() => removeExclude(p)}
              >
                <RotateCcw class="icon" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
