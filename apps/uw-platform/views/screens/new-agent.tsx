import type { Context } from 'hono';
import { createPageCommandSchema } from '@uw/contracts';
import type { AgentsView } from '@uw/harness';
import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { ChoiceCards, type CardChoice } from '@uw/ui/components/segmented-control.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { FormActions, FormShape } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { createPage } from '../../pages/store.ts';
import { capabilityWord, doesWords, runShapeWord } from '../parts/agent-words.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { agentDraft, templateChoices } from '../parts/new-agent.ts';
import { idParam } from '../parts/params.ts';
import { agentsPath, newAgentPath, personaPath } from '../parts/paths.ts';
import { workflowCrumbs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const NAME_LIMIT = 60;
const MODEL_LIMIT = 200;

const refusalWords: ReadonlyMap<string, string> = new Map([
  ['slug_taken', 'An agent with this name already exists in this area. Choose another name.'],
  ['not_permitted', 'Only an admin of this area can add an agent.'],
  ['malformed_command', 'Give the agent a name made of letters or numbers.'],
]);

const templateHint =
  'Its actions, engine and instructions are copied in. You can change them on its page before it goes live.';
const notAdminWords = 'Only an admin of this area can add an agent. Ask an admin of the area.';

type Posted = { readonly template: string; readonly name: string; readonly model: string };

function cardChoices(): readonly CardChoice[] {
  return templateChoices().map((fixture) => ({
    value: fixture.slug,
    label: fixture.title,
    detail: `${capabilityWord(fixture.capability)} · ${runShapeWord(fixture.run_shape)}`,
    summary: doesWords[fixture.capability],
  }));
}

function AddForm(props: {
  readonly view: AgentsView;
  readonly posted: Posted | null;
  readonly pageId: string;
}) {
  const { view, posted } = props;
  const choices = cardChoices();
  const scope = `new-agent-${view.harness.id}`;
  return (
    <form method="post" action={newAgentPath(view.harness.id)} class="flex flex-col gap-5">
      <input type="hidden" name="pageId" value={props.pageId} />
      <ChoiceCards
        name="template"
        legend="Start from"
        hint={templateHint}
        choices={choices}
        selected={posted?.template ?? choices[0]?.value ?? ''}
      />
      <TextField
        name="name"
        label="Name"
        scope={scope}
        value={posted?.name ?? ''}
        required
        maxLength={NAME_LIMIT}
        placeholder="Scout"
      />
      <TextField
        name="model"
        label="Model (optional)"
        scope={scope}
        value={posted?.model ?? ''}
        maxLength={MODEL_LIMIT}
        hint="Leave it blank to keep the template's model."
      />
      <FormActions>
        <ButtonLink href={agentsPath(view.harness.id)} variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" variant="primary">
          Add the agent
        </Button>
      </FormActions>
    </form>
  );
}

function render(
  c: Context<AppEnv>,
  view: AgentsView,
  posted: Posted | null,
  refusal: string | null,
): Promise<Response> {
  const { harness } = view;
  const spec = {
    title: `${harness.title} ${pageNames.newAgent}`,
    current: agentsPath(harness.id),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(harness.title, agentsPath(harness.id), pageNames.newAgent),
  };
  return renderScreen(
    c,
    spec,
    <FormShape
      head={{
        eyebrow: `${harness.title} · ${pageNames.agents}`,
        title: pageNames.newAgent,
        lede: "Start from a template agent. It isn't live until an admin puts it live on its page.",
      }}
    >
      {view.admin ? (
        <>
          {refusal === null ? null : <Note>{refusal}</Note>}
          <AddForm view={view} posted={posted} pageId={crypto.randomUUID()} />
        </>
      ) : (
        <Note>{notAdminWords}</Note>
      )}
    </FormShape>,
  );
}

function viewOf(outcome: Awaited<ReturnType<ScreenKernel['kernel']['views']['agents']>>) {
  return outcome.status === 'accepted' ? outcome.value : null;
}

export async function newAgentScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const outcome = await screen.kernel.views.agents(screen.caller, { harnessId }, { at: screen.at });
  const view = viewOf(outcome);
  return view === null ? notFound(c) : render(c, view, null, null);
}

function postedOf(body: Record<string, unknown>): Posted & { readonly pageId: unknown } {
  const given = new Map(Object.entries(body));
  const field = (name: string): string => {
    const value = given.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    template: field('template'),
    name: field('name'),
    model: field('model'),
    pageId: given.get('pageId'),
  };
}

async function create(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  view: AgentsView,
  posted: ReturnType<typeof postedOf>,
): Promise<string> {
  const database = c.get('database');
  if (database === null || !view.admin) return 'not_permitted';
  const fixture = templateChoices().find((choice) => choice.slug === posted.template);
  const { harness } = view;
  const draft =
    fixture === undefined
      ? null
      : agentDraft({ fixture, harness, owner: screen.caller.actor.identity, ...posted });
  const command = createPageCommandSchema.safeParse({
    command: 'create_page',
    requestId: crypto.randomUUID(),
    pageId: posted.pageId,
    type: 'persona',
    jdArea: harness.jdArea,
    parentId: null,
    status: 'suggested',
    ...draft,
  });
  if (draft === null || !command.success) return 'malformed_command';
  const { actor, traceId } = screen.caller;
  const created = await createPage(database.db, actor, command.data, traceId, screen.at);
  return created.ok ? '' : created.reason;
}

export async function addAgent(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const outcome = await screen.kernel.views.agents(screen.caller, { harnessId }, { at: screen.at });
  const view = viewOf(outcome);
  if (view === null) return notFound(c);
  const posted = postedOf(await c.req.parseBody());
  const reason = await create(c, screen, view, posted);
  const pageId = typeof posted.pageId === 'string' ? posted.pageId : '';
  if (reason === '' || reason === 'page_exists') return c.redirect(personaPath(pageId), 303);
  return render(c, view, posted, refusalWords.get(reason) ?? reasonText(reason));
}
