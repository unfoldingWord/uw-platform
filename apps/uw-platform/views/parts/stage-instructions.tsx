import type { Stage } from '@uw/contracts';
import type { StageControlsView } from '@uw/harness';
import { Button } from '@uw/ui/components/button.tsx';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { fieldControl } from '@uw/ui/components/field.tsx';
import { controlsPath, pagePath } from './paths.ts';

const link =
  'text-sm font-semibold text-accent-text underline-offset-2 hover:underline outline-offset-2 outline-accent-text focus-visible:outline-2';
const input = `${fieldControl} min-w-0 flex-1`;

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
          <Button type="submit" size="sm" label={`Create an instructions page for ${stage.title}`}>
            New page
          </Button>
        </CommandForm>
      ) : null}
    </div>
  );
}
