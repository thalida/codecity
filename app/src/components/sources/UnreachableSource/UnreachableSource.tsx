// components/sources/UnreachableSource/UnreachableSource.tsx — why a source
// cannot be read here. Never claims the repo is private (GitHub 404s private and
// typo alike to an anonymous caller) or says "you don't have access", which
// blames the user for a property of this server.
import './UnreachableSource.css';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Info, AlertCircle, ChevronDown } from 'lucide-preact';
import { CopyButton } from '@/components/buttons/CopyButton/CopyButton';
import { RUN_DOCS_URL } from '@/constants/ui';

/** Why the notice is on screen. `Standing` is the resting state and carries no
 *  failure; the other two each name a distinct thing that went wrong. */
export enum NoticeReason {
  /** Nothing typed or tried: what this instance can open. */
  Standing = 'standing',
  /** A repo was pasted and the server couldn't reach it. */
  Unreachable = 'unreachable',
  /** A local path was typed where local paths are off. */
  PathBlocked = 'path-blocked',
}

export interface UnreachableSourceProps {
  /** This is the public deployment, where a local path can never resolve. */
  hosted: boolean;
  /** This instance can read local paths. Standing and PathBlocked only arise
   *  when it's false, so only Unreachable reads it. */
  allowLocal: boolean;
  reason: NoticeReason;
  /** The source that failed, used for the `git clone` line. */
  src?: string;
  /** So a field can point aria-describedby at it when the notice IS the
   *  field's error. */
  id?: string;
}

// The plain `docker run` is not the answer: with no git credentials the server
// clones anonymously, so a private repo needs the mount a local folder does.
const RUN_COMMAND = `docker run --rm --init --pull=always \\
    -e CODECITY_ALLOW_LOCAL_REPOS=1 \\
    -v "$HOME/Repos:$HOME/Repos:ro" \\
    -v codecity-cache:/cache \\
    -p 8080:8080 \\
    ghcr.io/thalida/codecity`;

/** What just failed. Hosted phrases the blocked path as a fact about this
 *  deployment: there is no switch here to have turned off. */
function preambleFor(reason: NoticeReason, hosted: boolean): string | null {
  if (reason === NoticeReason.Unreachable) return "Couldn't reach that repo.";
  if (reason !== NoticeReason.PathBlocked) return null;
  return hosted
    ? "codecity.io can't reach a folder on your machine."
    : 'Local paths are turned off';
}

export function UnreachableSource({ hosted, allowLocal, reason, src, id }: UnreachableSourceProps) {
  const preamble = preambleFor(reason, hosted);
  const failed = reason !== NoticeReason.Standing;
  const Glyph = failed ? AlertCircle : Info;

  return (
    <div
      id={id}
      class={`unreachable unreachable--${failed ? 'error' : 'standing'}`}
      role={failed ? 'alert' : undefined}
    >
      <span class="unreachable-glyph-slot">
        <Glyph class="icon unreachable-glyph" aria-hidden="true" />
      </span>
      <div class="unreachable-text">
        {preamble && <p class="unreachable-preamble">{preamble}</p>}
        <Remedy hosted={hosted} allowLocal={allowLocal} reason={reason} src={src} />
      </div>
    </div>
  );
}

function Remedy({ hosted, allowLocal, reason, src }: Omit<UnreachableSourceProps, 'id'>) {
  if (hosted) {
    return (
      <>
        <p class="unreachable-remedy">
          <strong>Private and local repos work.</strong> Clone one yourself, then run codecity on
          your own machine with that folder mounted.
        </p>
        <RunItYourself />
      </>
    );
  }

  // Cloning is no help for a path already on this machine.
  if (reason === NoticeReason.Standing || reason === NoticeReason.PathBlocked) {
    return (
      <p class="unreachable-remedy">
        Turn on local paths to open a folder on this machine. <DocsLink>See&nbsp;docs</DocsLink>
      </p>
    );
  }

  if (allowLocal) {
    return (
      <>
        <p class="unreachable-remedy">
          If it's private, clone it yourself and open the folder instead.{' '}
          <DocsLink>See&nbsp;docs</DocsLink>
        </p>
        <CloneCommand src={src} />
      </>
    );
  }

  return (
    <>
      <p class="unreachable-remedy">
        If it's private, turn on local paths, clone it yourself and open the folder instead.{' '}
        <DocsLink>See&nbsp;docs</DocsLink>
      </p>
      <CloneCommand src={src} />
    </>
  );
}

/** The command, behind a disclosure. Collapsed it is one control; open it is the
 *  real answer, mount and all, rather than a link to go and find it. */
function RunItYourself() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div class="unreachable-actions">
        <button
          type="button"
          class="unreachable-disclose"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Run it yourself
          <ChevronDown class={`icon unreachable-chevron${open ? ' is-open' : ''}`} />
        </button>
        <DocsLink>Full&nbsp;setup</DocsLink>
      </div>
      {open && (
        <div class="unreachable-detail">
          <div class="unreachable-command unreachable-command--block">
            <pre>{RUN_COMMAND}</pre>
            <CopyButton text={RUN_COMMAND} label="Copy run command" />
          </div>
          <p class="unreachable-hint">
            Point <code>-v</code> at the folder your repos live in, then open localhost:8080.
          </p>
        </div>
      )}
    </>
  );
}

function CloneCommand({ src }: { src?: string }) {
  if (!src) return null;
  const command = `git clone ${src}`;
  return (
    <div class="unreachable-command">
      <code>{command}</code>
      <CopyButton text={command} label="Copy clone command" />
    </div>
  );
}

function DocsLink({ children }: { children: ComponentChildren }) {
  return (
    <a class="link--chrome" href={RUN_DOCS_URL} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
