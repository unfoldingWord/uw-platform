import type { Context } from 'hono';
import { templates } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { NewHarnessForm, commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { ChoiceCards, type CardChoice } from '@uw/ui/components/segmented-control.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames, platformAreas } from '../parts/names.ts';
import { agentQueuesPath, newWorkflowPath } from '../parts/paths.ts';

const SCOPE = 'new-workflow';
const NAME_LIMIT = 80;
const REPOSITORY_LIMIT = 140;
const DECADES = 10;

const templateSummaries: ReadonlyMap<string, string> = new Map([
  ['software', 'From a backlog issue to merged, deployed and learned from.'],
  ['bml', 'Build, measure, learn: from a goal to what the feedback taught you.'],
  ['check-only', 'Review a pull request and merge it, nothing more.'],
]);

const areaHint =
  'Only areas you’re an admin of. Who has access to the area decides who sees and works this workflow.';
const templateHint = 'Its stages are copied in. You can change them in Flow afterwards.';
const repositoryHint =
  'Optional, one per workflow. Linking a repository means its issues can become items, its merge stage merges there, and agents’ code work happens there.';
const notAdminWords =
  'Only an area admin can create a workflow. Ask an admin of the area your work belongs to.';

function decadeOf(code: string): readonly [number, number] {
  const [from = '', to = ''] = code.split('-');
  return [Number(from), Number(to)];
}

function areaLabel(area: string): string {
  const [from] = decadeOf(area);
  const named = platformAreas.find((platform) => {
    const [start, end] = decadeOf(platform.code);
    return from >= start && from <= end;
  });
  return named === undefined ? area : `${area} ${named.name}`;
}

function everyArea(): readonly string[] {
  return Array.from({ length: DECADES }, (_, decade) => `${decade}0-${decade}9`);
}

function templateChoices(): readonly CardChoice[] {
  return [...templates.values()].map((template) => ({
    value: template.key,
    label: template.title,
    detail: `${template.stages.length} stages`,
    summary: templateSummaries.get(template.key) ?? '',
  }));
}

function NewWorkflowForm(props: { readonly areas: readonly string[] }) {
  return (
    <Card>
      <NewHarnessForm command="activate_template">
        <TextField
          name="title"
          label="Name"
          scope={SCOPE}
          required
          maxLength={NAME_LIMIT}
          placeholder="Translation helps review"
        />
        <SelectField
          name="jdArea"
          label="Area"
          scope={SCOPE}
          choices={props.areas.map((area) => ({ value: area, label: areaLabel(area) }))}
          hint={areaHint}
        />
        <ChoiceCards
          name="template"
          legend="Start from"
          hint={templateHint}
          choices={templateChoices()}
          selected="software"
        />
        <TextField
          name="repository"
          label="GitHub repository"
          scope={SCOPE}
          maxLength={REPOSITORY_LIMIT}
          placeholder="unfoldingWord/repo-name"
          hint={repositoryHint}
        />
        <div class="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          <button type="submit" class={primaryButton}>
            Create and open in Flow
          </button>
          <a href={agentQueuesPath()} class={commandButton}>
            Cancel
          </a>
          <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
        </div>
      </NewHarnessForm>
    </Card>
  );
}

export async function newWorkflowScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const held = await screen.kernel.views.creatableAreas(screen.caller, { at: screen.at });
  const areas = held.kind === 'all' ? everyArea() : held.areas;
  const spec = {
    title: pageNames.newWorkflow,
    current: newWorkflowPath(),
    code: moduleCodes.agentQueues,
    crumbs: [
      { label: pageNames.infrastructure },
      { label: pageNames.agentQueues, href: agentQueuesPath() },
      { label: pageNames.newWorkflow },
    ],
  };
  return renderScreen(
    c,
    spec,
    <div class="flex max-w-content flex-col gap-5">
      <PageHead
        eyebrow={pageNames.agentQueues}
        title={pageNames.newWorkflow}
        lede="A workflow is a set of stages that work moves through. Start from a template, then shape its stages in Flow."
        flush
      />
      {areas.length === 0 ? <Note>{notAdminWords}</Note> : <NewWorkflowForm areas={areas} />}
    </div>,
  );
}
