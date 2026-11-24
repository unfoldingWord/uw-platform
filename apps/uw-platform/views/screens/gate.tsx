import type { Context } from 'hono';
import type { Harness, ItemState, Stage } from '@uw/contracts';
import type { GateRow } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { showsDecisions } from '../parts/decider.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { GatePanel, type PanelGate } from '../parts/gate-panel.tsx';
import { idParam } from '../parts/params.ts';
import { gatePath, itemPath, queuePath, waitingPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { Inbox, placeOf } from '../parts/gate-rows.tsx';
import { workflowCrumbs } from '../parts/workflow-tabs.ts';
import { pageNames } from '../parts/names.ts';
import { moduleCodes } from '../parts/names.ts';

type ItemScene = { readonly item: ItemState; readonly harness: Harness; readonly stage: Stage };

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function notAtGate(gate: PanelGate): boolean {
  return !gate.ability.can && gate.ability.reason === 'item_not_at_gate';
}

async function noticeOf(screen: ScreenKernel, scene: ItemScene, gate: PanelGate) {
  if (!notAtGate(gate)) return null;
  const input = { itemId: scene.item.itemId };
  const decided = await screen.kernel.views.decided(screen.caller, input, { at: screen.at });
  return decided
    ? 'This gate has been decided'
    : 'This item is not waiting at a gate a person decides';
}

async function sceneOf(c: Context<AppEnv>, screen: ScreenKernel): Promise<ItemScene | null> {
  const harnessId = idParam(c.req.param('harnessId'));
  const itemId = idParam(c.req.param('itemId'));
  if (harnessId === null || itemId === null) return null;
  const scene = await screen.kernel.reads.item(screen.caller, { itemId }, { at: screen.at });
  if (scene.status !== 'accepted' || scene.value.harness.id !== harnessId) return null;
  return scene.value;
}

async function gateOf(screen: ScreenKernel, scene: ItemScene): Promise<PanelGate | null> {
  const read = { at: screen.at };
  const { itemId } = scene.item;
  const view = await screen.kernel.views.gate(screen.caller, { itemId }, read);
  if (view.status !== 'accepted') return null;
  const ability = screen.kernel.views.decideAbility(screen.caller, scene, read);
  const title = `${scene.item.title} at ${scene.stage.title}`;
  const decides =
    scene.item.gateStatus === 'parked' && showsDecisions(screen.caller.actor, ability);
  const place = placeOf(scene, screen.at);
  return { view: view.value, title, ability, decides, place };
}

function GateBody(props: {
  readonly scene: ItemScene;
  readonly gate: PanelGate;
  readonly notice: string | null;
  readonly rows: readonly GateRow[];
  readonly at: Date;
}) {
  const { scene, gate, notice, rows } = props;
  const { harness, item } = scene;
  const head = {
    eyebrow: 'Gate',
    title: item.title,
    lede: `At ${scene.stage.title} on ${harness.title}`,
  };
  return (
    <DocumentShape
      head={head}
      rail={<Inbox rows={rows} at={props.at} selected={item.itemId} phone="hidden" />}
      railLabel="Decisions waiting"
      railOnPhone={false}
    >
      {notice === null ? null : <Note>{notice}</Note>}
      <GatePanel gate={notice === null ? gate : { ...gate, decides: false }} />
      <p class="m-0">
        <a href={itemPath(harness.id, item.itemId)} class={`text-accent-text underline ${focus}`}>
          See everything that happened on this item
        </a>
      </p>
    </DocumentShape>
  );
}

export async function gateScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const named = idParam(c.req.param('harnessId'));
  const read = { at: screen.at };
  const cursor =
    named === null
      ? 0
      : await screen.kernel.views.cursor(screen.caller, { harnessId: named }, read);
  const scene = await sceneOf(c, screen);
  const gate = scene === null ? null : await gateOf(screen, scene);
  if (scene === null || gate === null) return notFound(c);
  const { harness, item } = scene;
  const notice = await noticeOf(screen, scene, gate);
  const input = { harnessId: harness.id };
  const { rows } = await screen.kernel.views.workflowGates(screen.caller, input, read);
  const spec = {
    title: `${item.title} ${pageNames.gate}`,
    current: gatePath(harness.id, item.itemId),
    code: moduleCodes.agentQueues,
    crumbs: [
      ...workflowCrumbs(harness.title, queuePath(harness.id), pageNames.waiting).slice(0, -1),
      { label: pageNames.waiting, href: waitingPath(harness.id) },
      { label: pageNames.gate },
    ],
    live: {
      screen: 'gates' as const,
      harnesses: [{ harnessId: harness.id, cursor }],
      refreshEveryMs: REFRESH_EVERY_MS,
    },
  };
  return renderScreen(
    c,
    spec,
    <GateBody scene={scene} gate={gate} notice={notice} rows={rows} at={screen.at} />,
  );
}
