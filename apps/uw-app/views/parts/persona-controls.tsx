import type { PersonaDashboard } from '@uw/harness';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { personaPath } from './paths.ts';

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

function Outcome(props: { readonly saved: SavedToolset | null }) {
  const { saved } = props;
  if (saved === null) return <p role="status" class="m-0 text-sm text-muted"></p>;
  if ('accepted' in saved) return <Note>Done.</Note>;
  return (
    <p role="status" class="m-0 text-sm text-muted">
      {reasonText(saved.reason)}
    </p>
  );
}

export function ToolsetForm(props: {
  readonly dashboard: PersonaDashboard;
  readonly options: readonly string[];
  readonly requestId: string;
  readonly saved: SavedToolset | null;
}) {
  const { page, toolset } = props.dashboard;
  const held = new Set(toolset);
  return (
    <form method="post" action={`${personaPath(page.id)}/toolset`} class="mb-6 flex flex-col gap-3">
      <input type="hidden" name="expectedVersion" value={String(page.version)} />
      <input type="hidden" name="requestId" value={props.requestId} />
      <fieldset class="m-0 flex flex-col gap-2 rounded-lg border border-line p-4">
        <legend class="px-1 font-bold text-ink">Toolset</legend>
        {props.options.map((verb) => (
          <label class="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="verb"
              value={verb}
              checked={held.has(verb)}
              class="accent-ocean outline-offset-2 outline-focus focus-visible:outline-2"
            />
            {verb}
          </label>
        ))}
      </fieldset>
      {page.status === 'active' ? (
        <p class="m-0 text-sm text-muted">
          Saving returns this persona to suggested; an admin activates it again.
        </p>
      ) : null}
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class={commandButton}>
          Save toolset
        </button>
        <Outcome saved={props.saved} />
      </div>
    </form>
  );
}
