// views/InfoPane/ReadmePane.tsx — renders the body of the README panel:
// finds the root README in the manifest, fetches + renders it as markdown,
// and shows appropriate empty states. No <Pane> wrapper — InfoPane owns the chrome.

import './InfoPane.css';
import { useState, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { fetchFileText } from '@/api/file';
import { BookOpen, FileWarning, FolderOpen } from 'lucide-preact';
import { Marked } from 'marked';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest } from '@/types';
import { PaneEmpty } from '@/components/Pane';
import { isEmptyManifest } from '@/utils/manifest';
import { resolveReadmeAssetUrl, rewriteHtmlImageUrls } from '@/utils/readmeAssets';

/**
 * Render README markdown to HTML, rewriting relative image refs to route
 * through /api/file (resolved against the README's directory) so they load
 * instead of 404ing against the app origin. The href is mutated on the image
 * token before rendering, so marked's default renderer still handles all HTML
 * escaping.
 */
function _renderReadme(text: string, readmeFullPath: string): string {
  const md = new Marked();
  md.use({
    walkTokens(token) {
      if (token.type === 'image') {
        token.href = resolveReadmeAssetUrl(token.href, readmeFullPath);
      } else if (token.type === 'html') {
        // READMEs often use raw <img src="…"> (for width/align) rather than
        // markdown ![](…); those arrive as html tokens, not image tokens.
        token.text = rewriteHtmlImageUrls(token.text, readmeFullPath);
      }
    },
  });
  return md.parse(text) as string;
}

// Match README, README.md, readme.markdown, README.txt — any file whose
// stem (case-insensitive) is "readme". GitHub/VSCode use the same rule.
const README_BASE_NAME = 'readme';

function _findRootReadme(manifest: Manifest | DirNode | null): FileNode | null {
  // Callers gate on isEmptyManifest first, so by here `manifest` is always a
  // real Manifest (has `tree`) — never a bare DirNode.
  const tree = manifest && 'tree' in manifest ? manifest.tree : null;
  if (!tree || !tree.children) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i];
    if (c.type !== NodeKind.File) continue;
    const name = (c.name || '').toLowerCase();
    if (name === README_BASE_NAME || name.indexOf(`${README_BASE_NAME}.`) === 0) return c;
  }
  return null;
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

export interface ReadmePaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function ReadmePane({ manifest }: ReadmePaneProps) {
  const [body, setBody] = useState<InfoBodyState>({ kind: InfoBodyKind.NoProject });

  useEffect(() => {
    let cancelled = false;

    const doFetch = (m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null) => {
      if (isEmptyManifest(m)) {
        setBody({ kind: InfoBodyKind.NoProject });
        return;
      }
      const readme = _findRootReadme(m as Manifest | DirNode | null);
      if (!readme || !readme.fullPath) {
        setBody({ kind: InfoBodyKind.NoReadme });
        return;
      }
      setBody({ kind: InfoBodyKind.Loading });
      const readmePath = readme.fullPath;
      fetchFileText(readmePath)
        .then((text) => {
          if (!cancelled)
            setBody({ kind: InfoBodyKind.Markdown, html: _renderReadme(text, readmePath) });
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
    <>
      {body.kind === InfoBodyKind.NoProject && (
        <PaneEmpty icon={FolderOpen} title="No project loaded" sub="Open one to read its README." />
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
        <article class="info-markdown" dangerouslySetInnerHTML={{ __html: body.html }} />
      )}
    </>
  );
}
