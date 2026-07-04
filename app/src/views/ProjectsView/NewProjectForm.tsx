// views/ProjectsView/NewProjectForm.tsx — stub; real form (Git URL / local path
// tabs, branch select, skip-cache) arrives in Task 8. Props are typed to match
// what ProjectsView already passes so the shell compiles against the real
// contract, not a loosened placeholder.

import type { SourcePayload } from '@/state/stores/ui';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
  onCancel: () => void;
}

export function NewProjectForm(_props: NewProjectFormProps) {
  return null;
}
