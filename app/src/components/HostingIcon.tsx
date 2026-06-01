// components/HostingIcon.tsx — Brand glyph for a git-hosting provider
// (GitHub, GitLab, Bitbucket) with a generic globe fallback, picked from a
// source URL and rendered inline as JSX (no innerHTML). Brand glyphs only —
// for UI affordances elsewhere use <LucideIcon name=… />.

export interface HostingIconProps {
  /** Source URL — provider is sniffed from the host. */
  src: string;
}

function GithubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GitlabGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.875.875 0 0 0-.998.054.875.875 0 0 0-.29.434l-2.207 6.756H7.538L5.33 1.063a.857.857 0 0 0-.29-.435.875.875 0 0 0-.999-.054.86.86 0 0 0-.336.405L.434 9.502.4 9.588a6.064 6.064 0 0 0 2.011 7.012l.011.008.03.022 4.976 3.726 2.462 1.863 1.5 1.135a1.008 1.008 0 0 0 1.222 0l1.5-1.135 2.461-1.863 5.006-3.748.013-.01A6.064 6.064 0 0 0 23.6 9.593z" />
    </svg>
  );
}

function BitbucketGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
    </svg>
  );
}

function GlobeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function HostingIcon({ src }: HostingIconProps) {
  const lower = src.toLowerCase();
  if (/github\.com/.test(lower)) return <GithubGlyph />;
  if (/gitlab\.com/.test(lower) || /\.gitlab\.io/.test(lower)) return <GitlabGlyph />;
  if (/bitbucket\.org/.test(lower)) return <BitbucketGlyph />;
  return <GlobeGlyph />;
}
