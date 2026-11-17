import type { Context } from 'hono';
import { formatMoney } from '@uw/core/money';
import type { AgentSummary, AgentsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { primaryButton } from '@uw/ui/components/command-form.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { doesWords, runShapeWords } from '../parts/agent-words.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { agentsPath, newAgentPath, personaPath, queuePath } from '../parts/paths.ts';
import { StandingPermissions } from '../parts/standing-permissions.tsx';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const link =
  'font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';

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
  { key: 'does', label: 'Does' },
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
    <Card title="Agents on this workflow" sub="Open an agent to see what it may do" flush>
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No agents on this workflow yet.</p>
      ) : (
        <Table caption="Agents on this workflow" columns={agentColumns} rows={rows} bare />
      )}
    </Card>
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
          <span class="font-heavy text-ok-text" aria-label="Can work here">
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
    <Card
      title="Where each agent can work"
      sub="Worked out from each stage's “agents pick up” and the agent's standing permissions"
      flush
    >
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No agents to show.</p>
      ) : (
        <Table caption="Where each agent can work" columns={columns} rows={rows} bare />
      )}
    </Card>
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
      <p class="m-0 text-sm font-semibold text-text-3">
        {`Only admins of area ${props.view.harness.jdArea} can add agents or grant permissions.`}
      </p>
    </div>
  );
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
  const viewer = { admin: view.admin, personId: screen.caller.actor.personId };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={`Workflow · ${view.harness.template} template`}
        title={view.harness.title}
        lede="The agents on this workflow, what each may do, and where each can work."
        actions={
          view.admin ? (
            <a href={newAgentPath(harnessId)} class={primaryButton}>
              Add an agent
            </a>
          ) : undefined
        }
      />
      <div class="flex flex-col gap-5">
        <Access view={view} />
        <AgentList view={view} />
        <StandingPermissions view={view} viewer={viewer} />
        <Reach view={view} />
      </div>
    </>,
  );
}
