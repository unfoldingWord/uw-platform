import type { Stage } from '@uw/contracts';
import type { StageControlsView } from '@uw/harness';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { controlsPath, pagePath } from './paths.ts';

const link =
  'text-sm font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';
const input =
  'min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2';

export function InstructionsExtras(props: {
  readonly view: StageControlsView;
  readonly stage: Stage;
}) {
  const { view, stage } = props;
  const back = controlsPath(view.harness.id);
  const pageId = stage.instructionsPageId;
  return (
    <div class="flex flex-col gap-2">
      {pageId === null ? null : (
        <a href={`${pagePath(pageId)}?back=${encodeURIComponent(back)}`} class={link}>
          Open
          <span class="sr-only">{` the instructions for ${stage.title}`}</span>
        </a>
      )}
      {view.admin ? (
        <CommandForm harnessId={view.harness.id} command="add_stage_instructions" itemId={stage.id}>
          <input type="hidden" name="stageId" value={stage.id} />
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            placeholder="New page title"
            aria-label={`Title of a new instructions page for ${stage.title}`}
            class={input}
          />
          <button
            type="submit"
            class={commandButton}
            aria-label={`Create an instructions page for ${stage.title}`}
          >
            New page
          </button>
        </CommandForm>
      ) : null}
    </div>
  );
}
