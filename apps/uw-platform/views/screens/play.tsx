import type { Context } from 'hono';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { itemPath, runsPath } from '../parts/paths.ts';
import { workflowCrumbs } from '../parts/workflow-tabs.ts';
import { kindParam } from '../parts/timeline.tsx';
import { ItemHistory } from '../parts/item-history.tsx';
import { notFound } from './not-found.tsx';
import { zulipConfigOf } from '../../notify/zulip/config.ts';
import { itemTopicUrl } from '../../notify/zulip/links.ts';
import { HolderOf, holdingOf } from '../parts/holder.tsx';
import { eventIdentities } from '../parts/play-evidence.ts';
import { moduleCodes, pageNames } from '../parts/names.ts';

const wholeNumber = /^(?:0|[1-9]\d{0,15})$/;

function afterOf(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  return wholeNumber.test(raw) ? Number(raw) : null;
}

async function playOf(c: Context<AppEnv>, screen: ScreenKernel, harnessId: string | null) {
  const itemId = idParam(c.req.param('itemId'));
  const after = afterOf(c.req.query('after'));
  if (harnessId === null || itemId === null || after === null) return null;
  const read = { at: screen.at };
  const outcome = await screen.kernel.views.playByPlay(screen.caller, { itemId, after }, read);
  if (outcome.status !== 'accepted' || outcome.value.harness.id !== harnessId) return null;
  return outcome.value;
}

function itemCrumbs(harness: { readonly id: string; readonly title: string }) {
  return workflowCrumbs(harness.title, runsPath(harness.id), pageNames.item);
}

export async function playScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  const read = { at: screen.at };
  const cursor =
    harnessId === null ? 0 : await screen.kernel.views.cursor(screen.caller, { harnessId }, read);
  const play = await playOf(c, screen, harnessId);
  if (play === null) return notFound(c);
  const { harness, item, stage } = play;
  const zulipUrl = itemTopicUrl(zulipConfigOf(c.env), harness.jdArea, item.zulipTopic);
  const holding = await holdingOf(
    c.get('database')?.db ?? null,
    { reader: screen.caller.actor, at: screen.at },
    [play.holder?.identity, ...eventIdentities(play.events)],
  );
  const spec = {
    title: item.title,
    current: itemPath(harness.id, item.itemId),
    code: moduleCodes.agentQueues,
    crumbs: itemCrumbs(harness),
    live: {
      screen: 'item' as const,
      harnesses: [{ harnessId: harness.id, cursor }],
      itemId: item.itemId,
    },
  };
  return renderScreen(
    c,
    spec,
    <DocumentShape
      head={{ eyebrow: 'Item', title: item.title, lede: `At ${stage.title} on ${harness.title}` }}
      rail={
        <p class="m-0 text-sm text-text-3">
          Holder: <HolderOf holder={play.holder} holding={holding} />
        </p>
      }
    >
      <ItemHistory
        play={play}
        zulipUrl={zulipUrl}
        base={itemPath(harness.id, item.itemId)}
        kind={kindParam(c.req.query('kind'))}
        holding={holding}
      />
    </DocumentShape>,
  );
}
