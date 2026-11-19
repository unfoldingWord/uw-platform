import type { Context } from 'hono';
import type { Harness } from '@uw/contracts';
import type { DelegatedMergeList } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { ApproveAll } from '../parts/approve-all.tsx';
import { workflowCapNote } from '../parts/caps.ts';
import { DelegatedMerges } from '../parts/delegated-merges.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { approvable, panelsOf, type Shown } from '../parts/gate-rows.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { agentQueuesPath, queuePath, waitingPath } from '../parts/paths.ts';
import { ShadowList } from '../parts/shadow-list.tsx';
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

function WaitingBody(props: Body) {
  const { shown, capped, shadow, merged } = props;
  const note = capped ? <Note>{workflowCapNote}</Note> : null;
  const list =
    shadow.list === null ? null : (
      <ShadowList comparison={shadow.list} harnessTitle={shadow.harness.title} />
    );
  const head =
    shown.length === 0 ? (
      <PageHead eyebrow={eyebrow} title={pageNames.waiting} />
    ) : (
      <PageHead eyebrow={eyebrow} title={pageNames.waiting} lede={lede(shown.length, capped)} />
    );
  return (
    <>
      {head}
      {note ?? (shown.length === 0 ? <Note>{empty}</Note> : null)}
      {shown.length === 0 ? null : <WaitingTable shown={shown} />}
      {approvable(shown).map((batch) => (
        <ApproveAll batch={batch} />
      ))}
      {list}
      <DelegatedMerges merged={merged} />
    </>
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
  return renderScreen(
    c,
    specOf(harness, cursor, rows.length),
    <WaitingBody shown={shown} capped={gates.capped} shadow={shadow} merged={merged} />,
  );
}

export async function oldWaitingAddress(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  return c.redirect(agentQueuesPath(), 301);
}
