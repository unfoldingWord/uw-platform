import type { Context } from 'hono';
import type { Harness, ItemState, Stage } from '@uw/contracts';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { showsDecisions } from '../parts/decider.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { GatePanel, type PanelGate } from '../parts/gate-panel.tsx';
import { idParam } from '../parts/params.ts';
import { flowPath, gatePath, homePath, itemPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

type ItemScene = { readonly item: ItemState; readonly harness: Harness; readonly stage: Stage };

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

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
  return { view: view.value, title, ability, decides };
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
  const spec = {
    title: `${item.title} gate`,
    current: gatePath(harness.id, item.itemId),
    crumbs: [
      { label: 'Home', href: homePath() },
      { label: harness.key, href: flowPath(harness.id) },
      { label: 'Gate' },
    ],
    live: { harnesses: [{ harnessId: harness.id, cursor }], refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Gate"
        title={item.title}
        lede={`At ${scene.stage.title} on ${harness.key}`}
      />
      <div class="flex flex-col gap-4">
        {notice === null ? null : <Note>{notice}</Note>}
        <GatePanel gate={notice === null ? gate : { ...gate, decides: false }} />
        <p class="m-0">
          <a href={itemPath(harness.id, item.itemId)} class={`text-link underline ${focus}`}>
            See everything that happened on this item
          </a>
        </p>
      </div>
    </>,
  );
}
