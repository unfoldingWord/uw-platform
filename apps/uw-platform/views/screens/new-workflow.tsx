import type { Context } from 'hono';
import { templates } from '@uw/harness';
import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { NewHarnessForm } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { ChoiceCards, type CardChoice } from '@uw/ui/components/segmented-control.tsx';
import { FormActions, FormShape } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import { agentQueuesPath, newWorkflowPath } from '../parts/paths.ts';

const SCOPE = 'new-workflow';
const NAME_LIMIT = 80;
const REPOSITORY_LIMIT = 140;

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
      <FormActions>
        <p
          data-outcome
          role="status"
          aria-live="polite"
          class="m-0 mr-auto text-sm text-text-3"
        ></p>
        <ButtonLink href={agentQueuesPath()} variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" variant="primary">
          Create and open in Flow
        </Button>
      </FormActions>
    </NewHarnessForm>
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
    <FormShape
      head={{
        eyebrow: pageNames.agentQueues,
        title: pageNames.newWorkflow,
        lede: 'A workflow is a set of stages that work moves through. Start from a template, then shape its stages in Flow.',
      }}
    >
      {areas.length === 0 ? <Note>{notAdminWords}</Note> : <NewWorkflowForm areas={areas} />}
    </FormShape>,
  );
}
