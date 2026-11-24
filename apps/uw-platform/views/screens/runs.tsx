import type { Context } from 'hono';
import type { RunSummary, RunsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { formatInstant } from '@uw/core/dates';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { queuePath, runPath, runsPath } from '../parts/paths.ts';
import { agentName, spendText, statusOf } from '../parts/run-words.ts';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const link =
  'font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';

const columns = [
  { key: 'agent', label: 'Agent' },
  { key: 'item', label: 'Item' },
  { key: 'status', label: 'Status' },
  { key: 'started', label: 'Started' },
  { key: 'cost', label: 'Cost', numeric: true },
];

function rowOf(harnessId: string, run: RunSummary) {
  const status = statusOf(run);
  const agent = agentName(run);
  const item = run.itemTitle ?? 'an item';
  return {
    agent: (
      <a
        href={runPath(harnessId, run.runId)}
        class={link}
        aria-label={`Open the run of ${agent} on ${item}`}
      >
        {agent}
      </a>
    ),
    item,
    status: <Badge tone={status.tone}>{status.text}</Badge>,
    started: formatInstant(run.startedAt),
    cost: spendText(run.spend),
  };
}

function RecentRuns(props: { readonly view: RunsView }) {
  const { view } = props;
  const rows = view.runs.map((run) => rowOf(view.harness.id, run));
  return (
    <Card title="Recent runs" sub="Newest first. Open a run to see each step it took" flush>
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No agent has run on this workflow yet.</p>
      ) : (
        <Table caption="Recent runs" columns={columns} rows={rows} bare />
      )}
      <p class="m-0 border-t border-line px-4 py-3 text-sm text-text-3">
        Runs on the platform are paid from the shared cap and show dollars. Runs on a person’s own
        Claude Code show tokens marked “own subscription”. The two are never added together.
      </p>
    </Card>
  );
}

export async function runsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const read = { at: screen.at };
  const outcome = await screen.kernel.views.runs(screen.caller, { harnessId }, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId }, read);
  const spec = {
    title: `${view.harness.title} ${pageNames.runs}`,
    current: runsPath(harnessId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(view.harness.title, queuePath(harnessId), pageNames.runs),
    tabs: workflowTabs(harnessId, 'runs', await waitingCount(screen, harnessId)),
    live: { screen: 'runs' as const, harnesses: [{ harnessId, cursor }] },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={`Workflow · ${view.harness.template} template`}
        title={view.harness.title}
        lede="What agents did on this workflow, what each run cost, and where each one is now."
      />
      <RecentRuns view={view} />
    </>,
  );
}
