import type { HarnessEvent } from '@uw/contracts';
import type { PlayByPlay } from '@uw/harness';
import { checksUrl, issueUrl, pullRequestUrl, reviewUrl } from './paths.ts';
import { KindFilters, Timeline, kindOf, type EventKind } from './timeline.tsx';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const link = `text-accent-text underline ${focus}`;

function ZulipSlot(props: { readonly topic: string | null; readonly url: string | null }) {
  if (props.url !== null) {
    return (
      <a href={props.url} class={link}>
        Open the Zulip topic
      </a>
    );
  }
  const text = props.topic === null ? 'No Zulip topic yet' : `Zulip topic: ${props.topic}`;
  return <span class="text-sm text-text-3">{text}</span>;
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

function ofKind(events: readonly HarnessEvent[], kind: EventKind | null): readonly HarnessEvent[] {
  return kind === null ? events : events.filter((event) => kindOf(event.name) === kind);
}

export function ItemHistory(props: {
  readonly play: PlayByPlay;
  readonly zulipUrl: string | null;
  readonly base: string;
  readonly kind: EventKind | null;
}) {
  const { play, base, kind } = props;
  return (
    <>
      <Links play={play} zulipUrl={props.zulipUrl} />
      <KindFilters base={base} kind={kind} />
      <Timeline
        events={ofKind(play.events, kind)}
        learnings={new Map(Object.entries(play.learnings))}
        personaPages={new Map(Object.entries(play.personaPages))}
      />
      {play.next === null ? null : (
        <p class="mt-4">
          <a href={`${base}?after=${String(play.next)}`} class={link}>
            Show later events
          </a>
        </p>
      )}
    </>
  );
}
