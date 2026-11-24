import type { PersonaDashboard } from '@uw/harness';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';

export type SavedToolset = { readonly accepted: true } | { readonly reason: string };

export function ActivateForm(props: { readonly dashboard: PersonaDashboard }) {
  const { page, harness } = props.dashboard;
  return (
    <CommandForm harnessId={harness.id} command="activate_persona" itemId={page.id}>
      <input type="hidden" name="pageId" value={page.id} />
      <input type="hidden" name="expectedVersion" value={String(page.version)} />
      <HumanActionButton itemId={page.id} label="Activate" name="activate" value="activate" />
    </CommandForm>
  );
}
