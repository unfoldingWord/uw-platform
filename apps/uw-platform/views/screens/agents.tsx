import type { Context } from 'hono';
import type { Harness } from '@uw/contracts';
import { formatMoney } from '@uw/core/money';
import type { AgentSummary, AgentsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import { can } from '@uw/core/acl';
import { accessTokensConfigOf } from '../../agents/access-tokens.ts';
import { readableRoutines } from '../../agents/routine-reads.ts';
import { routinesOnHarness } from '../../agents/routines.ts';
import { holdingOf } from '../parts/holder.tsx';
import type { AppEnv } from '../../deps.ts';
import { doesWords, runShapeWords } from '../parts/agent-words.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { agentsPath, newAgentPath, personaPath, queuePath } from '../parts/paths.ts';
import { Routines } from '../parts/routines.tsx';
import { StandingPermissions } from '../parts/standing-permissions.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const link =
  'font-semibold text-accent-text no-underline outline-offset-2 outline-accent-text hover:underline focus-visible:outline-2';

const statusWords: Readonly<Record<AgentSummary['status'], string>> = {
  draft: 'Draft',
  suggested: 'Not live yet',
  active: 'Live',
  retired: 'Retired',
};

function StatusBadge(props: { readonly status: AgentSummary['status'] }) {
  const tone = props.status === 'active' ? 'success' : 'neutral';
  return <Badge tone={tone}>{statusWords[props.status]}</Badge>;
}

function budgetText(agent: AgentSummary): string {
  if (agent.runShape === 'external-run') return 'Own subscription';
  return `${formatMoney({ amountMinor: agent.budgetMinor, currency: 'USD' })} a month`;
}

const agentColumns = [
  { key: 'agent', label: 'Agent' },
  { key: 'does', label: 'Does', wide: 'medium' as const },
  { key: 'runs', label: 'Runs on' },
  { key: 'model', label: 'Model' },
  { key: 'budget', label: 'Budget' },
  { key: 'status', label: 'Status' },
];

function AgentList(props: { readonly view: AgentsView }) {
  const { view } = props;
  const rows = view.agents.map((agent) => ({
    agent: (
      <a href={personaPath(agent.pageId)} class={link}>
        {agent.title}
      </a>
    ),
    does: doesWords[agent.capability],
    runs: runShapeWords[agent.runShape],
    model: agent.runShape === 'external-run' ? 'Their choice' : agent.model,
    budget: budgetText(agent),
    status: <StatusBadge status={agent.status} />,
  }));
  return (
    <Section title="Agents on this workflow" sub="Open an agent to see what it may do">
      {rows.length === 0 ? (
        <EmptyState
          title="No agents on this workflow yet."
          text="An admin of the area adds one from a template agent."
        />
      ) : (
        <Table caption="Agents on this workflow" columns={agentColumns} rows={rows} bare />
      )}
    </Section>
  );
}

function Reach(props: { readonly view: AgentsView }) {
  const { view } = props;
  const columns = [
    { key: 'agent', label: 'Agent' },
    ...view.stages.map((stage) => ({ key: stage.key, label: stage.title })),
  ];
  const rows = view.agents
    .filter((agent) => agent.status !== 'retired')
    .map((agent) => {
      const reach = new Set(agent.reach);
      const cells = view.stages.map((stage) => [
        stage.key,
        reach.has(stage.key) ? (
          <span class="font-semibold text-ok-text" aria-label="Can work here">
            ✓
          </span>
        ) : (
          <span class="text-text-3" aria-label="Cannot work here">
            ·
          </span>
        ),
      ]);
      return { agent: agent.title, ...Object.fromEntries(cells) };
    });
  return (
    <Section
      title="Where each agent can work"
      sub="Worked out from each stage's “agents pick up” and the agent's standing permissions"
    >
      {rows.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No agents to show.</p>
      ) : (
        <Table caption="Where each agent can work" columns={columns} rows={rows} bare />
      )}
    </Section>
  );
}

function Access(props: { readonly view: AgentsView }) {
  if (props.view.admin) {
    return (
      <p class="m-0">
        <Badge tone="info">You can edit · area admin</Badge>
      </p>
    );
  }
  return (
    <div class="flex flex-wrap items-center gap-3">
      <Badge tone="neutral">View only</Badge>
      <p class="m-0 text-sm text-text-3">
        {`Only admins of area ${props.view.harness.jdArea} can add agents or grant permissions.`}
      </p>
    </div>
  );
}

const routineNotices: ReadonlyMap<string, string> = new Map([
  ['pause_routine', 'The routine is paused. Its next call is refused until you resume it.'],
  ['resume_routine', 'The routine is running again.'],
  ['revoked', 'The routine is revoked and its machine login is deleted.'],
  [
    'revoked_login_kept',
    'The routine is revoked, so the app refuses it. Its Cloudflare machine login could not be deleted; ask a Cloudflare admin to remove it.',
  ],
  ['grant_exists', 'You already have a live routine on this device or under this permission.'],
  ['delegation_lapsed', 'That standing permission has ended. Grant a new one first.'],
  ['delegation_not_found', 'A routine can only work under one of your own standing permissions.'],
  ['not_permitted', 'Only an admin of this area can set up a routine here.'],
  ['grant_not_found', 'That routine is already revoked.'],
  [
    'malformed_command',
    'Give the routine a name and a device made of lowercase letters, numbers and dashes.',
  ],
  ['not_switched_on', 'Routines are not switched on here yet.'],
  [
    'cloudflare_failed',
    'Cloudflare did not make the machine login. Nothing was set up; try again.',
  ],
]);

function routineNotice(key: string | undefined): string | null {
  if (key === undefined) return null;
  return routineNotices.get(key) ?? reasonText(key);
}

async function routineData(c: Context<AppEnv>, screen: ScreenKernel, harness: Harness) {
  const database = c.get('database');
  const stored =
    database === null ? [] : await routinesOnHarness(database.db, harness.id, screen.at);
  const rows = readableRoutines(screen.caller.actor, stored, harness.jdArea, screen.at);
  const viewer = {
    personId: screen.caller.actor.personId,
    orgAdmin: can(screen.caller.actor, 'admin', { kind: 'org' }, screen.at),
    switchedOn: accessTokensConfigOf(c.env, fetch) !== null,
    holding: await holdingOf(
      database?.db ?? null,
      { reader: screen.caller.actor, at: screen.at },
      rows.map((routine) => `human:${routine.personId}`),
    ),
  };
  return { rows, viewer };
}

async function permissionViewer(c: Context<AppEnv>, screen: ScreenKernel, view: AgentsView) {
  return {
    admin: view.admin,
    personId: screen.caller.actor.personId,
    holding: await holdingOf(
      c.get('database')?.db ?? null,
      { reader: screen.caller.actor, at: screen.at },
      view.permissions.map((permission) => `human:${permission.personId}`),
    ),
  };
}

export async function agentsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const read = { at: screen.at };
  const outcome = await screen.kernel.views.agents(screen.caller, { harnessId }, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const spec = {
    title: `${view.harness.title} ${pageNames.agents}`,
    current: agentsPath(harnessId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(view.harness.title, queuePath(harnessId), pageNames.agents),
    tabs: workflowTabs(harnessId, 'agents', await waitingCount(screen, harnessId)),
  };
  const viewer = await permissionViewer(c, screen, view);
  const routines = await routineData(c, screen, view.harness);
  const notice = routineNotice(c.req.query('routine'));
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        eyebrow: `Workflow · ${view.harness.template} template`,
        title: view.harness.title,
        lede: 'The agents on this workflow, what each may do, and where each can work.',
        actions: view.admin ? (
          <ButtonLink href={newAgentPath(harnessId)} variant="primary">
            Add an agent
          </ButtonLink>
        ) : undefined,
      }}
      filters={<Access view={view} />}
    >
      {notice === null ? null : <Note>{notice}</Note>}
      <AgentList view={view} />
      <StandingPermissions view={view} viewer={viewer} />
      <Routines view={view} viewer={routines.viewer} routines={routines.rows} at={screen.at} />
      <Reach view={view} />
    </ListShape>,
  );
}
