import { holdingOf, type Holding } from '../parts/holder.tsx';
import type { Context } from 'hono';
import { can } from '@uw/core/acl';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { VIEW_LIMIT, type FlowStage, type FlowView, type WorkflowDraftView } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { HumanGateMark } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { costText } from '../parts/costs.ts';
import { DraftSection } from '../parts/draft-editor.tsx';
import { bracketText, FlowDiagram } from '../parts/flow-diagram.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { queuePath, flowPath } from '../parts/paths.ts';
import { moduleCodes } from '../parts/names.ts';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';
import { pageNames } from '../parts/names.ts';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

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
      <a href={queuePath(props.harnessId, stage.key)} class={`text-accent-text underline ${focus}`}>
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

const fixedWords =
  'The four phases and the option lists are set in the platform and can’t be changed here.';
const yoursWords =
  'Stages, their order, their phase and the loop arrows are yours to change in a draft.';

function Diagram(props: {
  readonly harnessId: string;
  readonly view: FlowView;
  readonly admin: boolean;
  readonly at: Date;
}) {
  return (
    <Card
      title="Flow"
      sub="the live map of this workflow: stages in four phases, with forward and loop arrows"
    >
      <div class="flex flex-col gap-3">
        <FlowDiagram
          harnessId={props.harnessId}
          harnessTitle={props.view.harness.title}
          stages={props.view.stages}
          at={props.at}
        />
        <p data-fixed-note class="m-0 text-sm text-text-2">
          {props.admin ? `${fixedWords} ${yoursWords}` : fixedWords}
        </p>
      </div>
    </Card>
  );
}

function summaryOf(view: FlowView): string {
  const brackets = new Set(view.stages.map((entry) => entry.stage.bracket)).size;
  const gates = view.stages.filter((entry) => entry.stage.exitGate === 'human_approval').length;
  const gateWords =
    gates === 1 ? '1 gate where a person decides' : `${gates} gates where a person decides`;
  return `${view.stages.length} stages in ${brackets} brackets, with ${gateWords}.`;
}

function FlowBody(props: {
  readonly harnessId: string;
  readonly view: FlowView;
  readonly draft: WorkflowDraftView | null;
  readonly admin: boolean;
  readonly at: Date;
  readonly holding: Holding;
}) {
  return (
    <div class="flex flex-col gap-5">
      {props.view.capped ? <Note>{cappedNote}</Note> : null}
      <Diagram harnessId={props.harnessId} view={props.view} admin={props.admin} at={props.at} />
      <DraftSection
        harnessId={props.harnessId}
        harnessTitle={props.view.harness.title}
        draft={props.draft}
        admin={props.admin}
        at={props.at}
        holding={props.holding}
      />
      <Card title="Stage details" sub="what each stage holds, costs and waits on" flush>
        <Table
          caption="Stages"
          columns={columns}
          rows={props.view.stages.map((entry) => rowOf(props.view, entry, props.at))}
          bare
        />
      </Card>
    </div>
  );
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
  const drafted = await screen.kernel.views.workflowDraft(screen.caller, { harnessId }, read);
  const draft = drafted.status === 'accepted' ? drafted.value : null;
  const { actor } = screen.caller;
  const area = { kind: 'area', area: view.harness.jdArea } as const;
  const admin = actor.kind === 'person' && can(actor, 'admin', area, screen.at);
  const holding = await holdingOf(c.get('database')?.db ?? null, { reader: actor, at: screen.at }, [
    draft === null ? null : `human:${draft.holder.personId}`,
  ]);
  const spec = {
    title: `${view.harness.title} ${pageNames.flow}`,
    current: flowPath(harnessId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(view.harness.title, queuePath(harnessId), pageNames.flow),
    tabs: workflowTabs(harnessId, 'flow', await waitingCount(screen, harnessId)),
    live: { screen: 'flow' as const, harnesses: [{ harnessId, cursor }] },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={`Workflow · ${view.harness.template} template`}
        title={view.harness.title}
        lede={summaryOf(view)}
      />
      <FlowBody
        harnessId={harnessId}
        view={view}
        draft={draft}
        admin={admin}
        at={screen.at}
        holding={holding}
      />
    </>,
  );
}
