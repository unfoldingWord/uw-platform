import type { Context } from 'hono';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { VIEW_LIMIT, type FlowStage, type FlowView } from '@uw/harness';
import { HumanGateMark } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { costText } from '../parts/costs.ts';
import { bracketText, FlowDiagram } from '../parts/flow-diagram.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { boardPath, flowPath, homePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const cappedNote = `This harness has at least ${formatCount(VIEW_LIMIT)} open items. The counts and costs cover the ${formatCount(VIEW_LIMIT)} with the highest priority.`;

const columns = [
  { key: 'stage', label: 'Stage' },
  { key: 'bracket', label: 'Bracket' },
  { key: 'items', label: 'Items', numeric: true },
  { key: 'progress', label: 'In progress', numeric: true },
  { key: 'oldest', label: 'Oldest' },
  { key: 'metered', label: 'Metered cost', numeric: true },
  { key: 'subscription', label: 'Subscription tokens', numeric: true },
  { key: 'status', label: 'Status' },
];

function StageCell(props: { readonly harnessId: string; readonly entry: FlowStage }) {
  const { stage } = props.entry;
  return (
    <span class="flex flex-wrap items-center gap-2">
      <a href={boardPath(props.harnessId, stage.key)} class={`text-link underline ${focus}`}>
        {stage.title}
      </a>
      {stage.exitGate === 'human_approval' ? <HumanGateMark label="Person decides" /> : null}
    </span>
  );
}

function rowOf(view: FlowView, entry: FlowStage, at: Date) {
  const { stage } = entry;
  const cost = costText(entry.cost);
  const oldest = entry.oldestEnteredAt;
  return {
    stage: <StageCell harnessId={view.harness.id} entry={entry} />,
    bracket: bracketText(stage.bracket),
    items: formatCount(entry.count),
    progress: `${formatCount(entry.held)} of ${formatCount(stage.wipLimit)}`,
    oldest: oldest === null ? 'None' : formatDuration(at.getTime() - oldest.getTime()),
    metered: cost.metered,
    subscription: cost.subscription,
    status: stage.paused ? 'Paused' : 'Running',
  };
}

export async function flowScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const read = { at: screen.at };
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId }, read);
  const outcome = await screen.kernel.views.flow(screen.caller, { harnessId }, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const spec = {
    title: `${view.harness.key} flow`,
    current: flowPath(harnessId),
    crumbs: [{ label: 'Home', href: homePath() }, { label: view.harness.key }],
    live: { screen: 'flow' as const, harnesses: [{ harnessId, cursor }] },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Flow"
        title={view.harness.key}
        lede={`Built from the ${view.harness.template} template`}
      />
      <div class="flex flex-col gap-6">
        {view.capped ? <Note>{cappedNote}</Note> : null}
        <FlowDiagram harnessId={harnessId} harnessKey={view.harness.key} stages={view.stages} />
        <Table
          caption="Stages"
          columns={columns}
          rows={view.stages.map((entry) => rowOf(view, entry, screen.at))}
        />
      </div>
    </>,
  );
}
