// panes/ExplorePane/tabs/ReadmeTab — Explore's Readme tab: fetches the
// manifest's readmePath and renders it as markdown, with the empty states
// around it. No <Pane> wrapper; the pane owns that.

import './ReadmeTab.css';
import { useState, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { fetchFileText } from '@/city/session/api/file';
import { BookOpen, FileWarning, FolderOpen } from 'lucide-preact';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { DirNode, Manifest, SourceRef } from '@/types';
import { PaneEmpty } from '@/components/panes/PaneEmpty/PaneEmpty';
import { sourceOf } from '@/utils/manifest';
import { useCity } from '@/city/CityProvider';
import {
  resolveReadmeAssetUrl,
  rewriteHtmlImageUrls,
} from '@/views/CityView/panes/ExplorePane/tabs/ReadmeTab/readmeAssets';

/** Markdown → HTML, relative image refs routed through /api/file so they load
 *  instead of 404ing. The href is mutated on the token, so marked escapes. */
export function renderReadme(text: string, source: SourceRef, readmePath: string): string {
  const md = new Marked();
  md.use({
    walkTokens(token) {
      if (token.type === 'image') {
        token.href = resolveReadmeAssetUrl(source, token.href, readmePath);
      } else if (token.type === 'html') {
        // READMEs often use raw <img src="…"> (for width/align) rather than
        // markdown ![](…); those arrive as html tokens, not image tokens.
        token.text = rewriteHtmlImageUrls(source, token.text, readmePath);
      }
    },
  });
  // A README is somebody else's file, and this lands in innerHTML: marked
  // stopped sanitizing at v5 and says to bring your own.
  return DOMPurify.sanitize(md.parse(text) as string);
}

// ── State shape ───────────────────────────────────────────────────────────────

// Discriminant for the README panel body state. Enum (not an inline string
// union) to match the NodeKind discriminant pattern used elsewhere.
export enum InfoBodyKind {
  NoProject = 'no-project',
  NoReadme = 'no-readme',
  Loading = 'loading',
  Markdown = 'markdown',
  Error = 'error',
}

type InfoBodyState =
  | { kind: InfoBodyKind.NoProject }
  | { kind: InfoBodyKind.NoReadme }
  | { kind: InfoBodyKind.Loading }
  | { kind: InfoBodyKind.Markdown; html: string }
  | { kind: InfoBodyKind.Error; message: string };

export interface ReadmeTabProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function ReadmeTab({ manifest }: ReadmeTabProps) {
  const { timeline } = useCity();
  const [body, setBody] = useState<InfoBodyState>({ kind: InfoBodyKind.NoProject });

  useEffect(() => {
    let cancelled = false;

    const doFetch = (m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null) => {
      if (!m) {
        setBody({ kind: InfoBodyKind.NoProject });
        return;
      }
      const readmePath = (m as Manifest).readmePath;
      const source = sourceOf(m as Manifest);
      if (!readmePath || !source) {
        setBody({ kind: InfoBodyKind.NoReadme });
        return;
      }
      // No README yet at this commit: say so rather than fetching HEAD's.
      if (timeline.hasNoContentAtScrub(readmePath)) {
        setBody({ kind: InfoBodyKind.NoReadme });
        return;
      }
      setBody({ kind: InfoBodyKind.Loading });
      // mtime busts the browser cache after a live edit (doFetch re-runs per manifest).
      fetchFileText(
        source,
        readmePath,
        (m as Manifest).readmeModified ?? undefined,
        timeline.scrubbedBlobShaFor(readmePath)
      )
        .then((text) => {
          if (!cancelled)
            setBody({
              kind: InfoBodyKind.Markdown,
              html: renderReadme(text, source, readmePath),
            });
        })
        .catch((err) => {
          if (!cancelled)
            setBody({ kind: InfoBodyKind.Error, message: (err && err.message) || 'Unknown error' });
        });
    };

    // effect() fires once immediately + on every manifest change.
    const unsub = effect(() => {
      doFetch(manifest.value);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [manifest]);

  return (
    <div class="pane readme-tab">
      <div class="pane-body">
        {body.kind === InfoBodyKind.NoProject && (
          <PaneEmpty
            icon={FolderOpen}
            title="No project loaded"
            sub="Open one to read its README."
          />
        )}
        {body.kind === InfoBodyKind.NoReadme && (
          <PaneEmpty
            icon={BookOpen}
            title="No README"
            sub="Add a README at the project root to fill this panel."
          />
        )}
        {body.kind === InfoBodyKind.Error && (
          <PaneEmpty icon={FileWarning} title="Couldn't load README" sub={body.message} />
        )}
        {body.kind === InfoBodyKind.Markdown && (
          <article
            class="readme-markdown pane-inset"
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        )}
      </div>
    </div>
  );
}
