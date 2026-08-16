// components/sources/UnreachableSource/UnreachableSource.tsx — why a source
// cannot be read here. Never claims the repo is private (GitHub 404s private and
// typo alike to an anonymous caller) or says "you don't have access", which
// blames the user for a property of this server.
import './UnreachableSource.css';
import { Info, AlertCircle } from 'lucide-preact';
import { CopyButton } from '@/components/buttons/CopyButton/CopyButton';
import { REPO_URL, LOCAL_DOCS_URL } from '@/constants/ui';

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

const RUN_DOCS_URL = `${REPO_URL}#run-it-yourself`;

const PREAMBLE: Record<NoticeReason, string | null> = {
  [NoticeReason.Standing]: null,
  [NoticeReason.Unreachable]: "Couldn't reach that repo.",
  [NoticeReason.PathBlocked]: 'Local paths are turned off',
};

export function UnreachableSource({ hosted, allowLocal, reason, src, id }: UnreachableSourceProps) {
  const preamble = PREAMBLE[reason];
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
      <p class="unreachable-remedy">
        Private and local repos need codecity running on your own machine.{' '}
        <DocsLink href={RUN_DOCS_URL} />
      </p>
    );
  }

  // Cloning is no help for a path already on this machine.
  if (reason === NoticeReason.Standing || reason === NoticeReason.PathBlocked) {
    return (
      <p class="unreachable-remedy">
        Turn on local paths to open a folder on this machine. <DocsLink href={LOCAL_DOCS_URL} />
      </p>
    );
  }

  if (allowLocal) {
    return (
      <>
        <p class="unreachable-remedy">
          If it's private, clone it yourself and open the folder instead.{' '}
          <DocsLink href={LOCAL_DOCS_URL} />
        </p>
        <CloneCommand src={src} />
      </>
    );
  }

  return (
    <>
      <p class="unreachable-remedy">
        If it's private, turn on local paths, clone it yourself and open the folder instead.{' '}
        <DocsLink href={LOCAL_DOCS_URL} />
      </p>
      <CloneCommand src={src} />
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

function DocsLink({ href }: { href: string }) {
  return (
    <a class="link--chrome" href={href} target="_blank" rel="noopener noreferrer">
      See&nbsp;docs
    </a>
  );
}
