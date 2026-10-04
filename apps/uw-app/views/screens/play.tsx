import type { Context } from 'hono';
import type { PlayByPlay } from '@uw/harness';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import {
  checksUrl,
  flowPath,
  homePath,
  issueUrl,
  itemPath,
  pullRequestUrl,
  reviewUrl,
} from '../parts/paths.ts';
import { PlayRow } from '../parts/play-row.tsx';
import { notFound } from './not-found.tsx';
import { zulipConfigOf } from '../../notify/zulip/config.ts';
import { itemTopicUrl } from '../../notify/zulip/links.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';
const link = `text-link underline ${focus}`;
const wholeNumber = /^(?:0|[1-9]\d{0,15})$/;

function afterOf(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  return wholeNumber.test(raw) ? Number(raw) : null;
}

function ZulipSlot(props: { readonly topic: string | null; readonly url: string | null }) {
  if (props.url !== null) {
    return (
      <a href={props.url} class={link}>
        Open the Zulip topic
      </a>
    );
  }
  const text = props.topic === null ? 'No Zulip topic yet' : `Zulip topic: ${props.topic}`;
  return <span class="text-sm text-muted">{text}</span>;
}

function Links(props: { readonly play: PlayByPlay; readonly zulipUrl: string | null }) {
  const { item } = props.play;
  const pull = item.pullRequest;
  return (
    <nav aria-label="Links for this item" class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {pull === null ? null : (
        <>
          <a href={pullRequestUrl(pull)} class={link}>
            Pull request
          </a>
          <a href={checksUrl(pull)} class={link}>
            Checks
          </a>
          <a href={reviewUrl(pull)} class={link}>
            Reviews
          </a>
        </>
      )}
      {item.issue === null ? null : (
        <a href={issueUrl(item.issue)} class={link}>
          Issue
        </a>
      )}
      <ZulipSlot topic={item.zulipTopic} url={props.zulipUrl} />
    </nav>
  );
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
  const learnings = new Map(Object.entries(play.learnings));
  const personaPages = new Map(Object.entries(play.personaPages));
  const zulipUrl = itemTopicUrl(zulipConfigOf(c.env), harness.jdArea, item.zulipTopic);
  const spec = {
    title: item.title,
    current: itemPath(harness.id, item.itemId),
    crumbs: [
      { label: 'Home', href: homePath() },
      { label: harness.key, href: flowPath(harness.id) },
      { label: 'Item' },
    ],
    live: {
      screen: 'item' as const,
      harnesses: [{ harnessId: harness.id, cursor }],
      itemId: item.itemId,
    },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow="Item" title={item.title} lede={`At ${stage.title} on ${harness.key}`} />
      <Links play={play} zulipUrl={zulipUrl} />
      <ol class="m-0 flex list-none flex-col gap-2 p-0">
        {play.events.map((event) => (
          <PlayRow event={event} learnings={learnings} personaPages={personaPages} />
        ))}
      </ol>
      {play.next === null ? null : (
        <p class="mt-4">
          <a href={`${itemPath(harness.id, item.itemId)}?after=${play.next}`} class={link}>
            Show later events
          </a>
        </p>
      )}
    </>,
  );
}
