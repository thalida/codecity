// components/app/SetupGuideLink — the README's run-it-yourself section, named
// once. Two surfaces send people there and each used to name it differently.
import { RUN_DOCS_URL } from '@/constants/ui';

export function SetupGuideLink() {
  return (
    <a class="link--chrome" href={RUN_DOCS_URL} target="_blank" rel="noopener noreferrer">
      Setup&nbsp;guide
    </a>
  );
}
