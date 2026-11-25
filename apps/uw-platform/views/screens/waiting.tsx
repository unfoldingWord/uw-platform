import type { Context } from 'hono';
import type { Harness } from '@uw/contracts';
import type { DelegatedMergeList } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { SidePanel } from '@uw/ui/components/side-panel.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { ApproveAll } from '../parts/approve-all.tsx';
import { workflowCapNote } from '../parts/caps.ts';
import { DelegatedMerges } from '../parts/delegated-merges.tsx';
import { holdingOf, type Holding } from '../parts/holder.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { approvable, panelsOf, type Shown } from '../parts/gate-rows.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { agentQueuesPath, gatePath, queuePath, waitingPath } from '../parts/paths.ts';
import { ShadowList } from '../parts/shadow-list.tsx';
import { ShipRules } from '../parts/ship-rules.tsx';
import { WaitingTable } from '../parts/waiting-table.tsx';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const REFRESH_EVERY_MS = 60_000;
const eyebrow = 'A person decides · an agent cannot advance these';
const empty = 'Nothing in this workflow is waiting for you to decide.';

type Body = {
  readonly shown: readonly Shown[];
  readonly capped: boolean;
  readonly shadow: Readonly<{ harness: Harness; list: Awaited<ReturnType<typeof shadowOf>> }>;
  readonly merged: DelegatedMergeList;
  readonly holding: Holding;
  readonly peek: string | null;
};

function lede(count: number, capped: boolean): string {
  const counted = count === 1 ? '1 gate is waiting' : `${count} gates are waiting`;
  return `${capped ? 'At least ' : ''}${counted} for you to decide in this workflow`;
}

async function shadowOf(screen: ScreenKernel, harness: Harness) {
  if (!harness.shadow) return null;
  const input = { harnessId: harness.id };
  const comparison = await screen.kernel.views.shadow(screen.caller, input, { at: screen.at });
  return comparison.status === 'accepted' ? comparison.value : null;
}

function Peek(props: { readonly shown: Shown | undefined }) {
  if (props.shown === undefined) return null;
  const { row, gate } = props.shown;
  const { harness, item } = row;
  const waited = gate.place?.waited ?? null;
  return (
    <SidePanel
      id={item.itemId}
      title={item.title}
      reference={gate.place?.number ?? undefined}
      closeHref={waitingPath(harness.id)}
      openHref={gatePath(harness.id, item.itemId)}
    >
      <p class="m-0 text-sm text-text-3">
        {waited === null ? `At ${row.stage.title}` : `At ${row.stage.title} · waiting ${waited}`}
      </p>
      <ShipRules view={gate.view} />
    </SidePanel>
  );
}

function Empty(props: { readonly capped: boolean }) {
  return <Note>{props.capped ? workflowCapNote : empty}</Note>;
}

function WaitingBody(props: Body) {
  const { shown, capped, shadow, merged, peek } = props;
  const opened = peek === null ? undefined : shown.find((one) => one.row.item.itemId === peek);
  const batches = approvable(shown);
  const head = {
    eyebrow,
    title: pageNames.waiting,
    lede: shown.length === 0 ? undefined : lede(shown.length, capped),
    actions:
      batches.length === 0 ? undefined : batches.map((batch) => <ApproveAll batch={batch} />),
  };
  return (
    <ListShape head={head} peek={opened === undefined ? undefined : <Peek shown={opened} />}>
      {shown.length === 0 ? (
        <Empty capped={capped} />
      ) : (
        <>
          {capped ? <Note>{workflowCapNote}</Note> : null}
          <WaitingTable shown={shown} peek={opened === undefined ? null : peek} />
        </>
      )}
      {shadow.list === null ? null : (
        <ShadowList comparison={shadow.list} harnessTitle={shadow.harness.title} />
      )}
      <DelegatedMerges merged={merged} holding={props.holding} />
    </ListShape>
  );
}

async function harnessOf(screen: ScreenKernel, harnessId: string): Promise<Harness | null> {
  const scene = await screen.kernel.reads.harness(screen.caller, { harnessId }, { at: screen.at });
  return scene.status === 'accepted' ? scene.value.harness : null;
}

function specOf(harness: Harness, cursor: number, waiting: number) {
  return {
    title: `${harness.title} ${pageNames.waiting}`,
    current: waitingPath(harness.id),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(harness.title, queuePath(harness.id), pageNames.waiting),
    tabs: workflowTabs(harness.id, 'waiting', waiting),
    live: {
      screen: 'gates' as const,
      harnesses: [{ harnessId: harness.id, cursor }],
      refreshEveryMs: REFRESH_EVERY_MS,
    },
  };
}

export async function waitingScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  const harness = harnessId === null ? null : await harnessOf(screen, harnessId);
  if (harness === null) return notFound(c);
  const read = { at: screen.at };
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId: harness.id }, read);
  const gates = await screen.kernel.views.workflowGates(
    screen.caller,
    { harnessId: harness.id },
    read,
  );
  const rows = gates.rows;
  const shown = await panelsOf(screen, rows);
  const all = await screen.kernel.views.delegatedMerges(screen.caller, read);
  const merged = { ...all, rows: all.rows.filter((row) => row.harness.id === harness.id) };
  const shadow = { harness, list: await shadowOf(screen, harness) };
  const holding = await holdingOf(
    c.get('database')?.db ?? null,
    { reader: screen.caller.actor, at: screen.at },
    merged.rows.map((row) => `human:${row.personId}`),
  );
  return renderScreen(
    c,
    specOf(harness, cursor, rows.length),
    <WaitingBody
      shown={shown}
      capped={gates.capped}
      shadow={shadow}
      merged={merged}
      holding={holding}
      peek={idParam(c.req.query('peek'))}
    />,
  );
}

export async function oldWaitingAddress(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  return c.redirect(agentQueuesPath(), 301);
}
