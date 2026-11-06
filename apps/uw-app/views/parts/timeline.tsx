import type { EvidenceLabel as Label, HarnessEvent } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { HumanDot } from '@uw/ui/components/human-action.tsx';
import { PlayRow } from './play-row.tsx';

export const eventKinds = ['gate', 'run', 'comment', 'lease'] as const;
export type EventKind = (typeof eventKinds)[number] | 'other';

const kindWords = new Map<EventKind, string>([
  ['gate', 'Gates'],
  ['run', 'Runs'],
  ['comment', 'Comments and learnings'],
  ['lease', 'Claims and leases'],
]);

const commentNames = new Set([
  'comment_recorded',
  'zulip_topic_linked',
  'learning_attached',
  'nothing_learned',
]);
const leaseNames = new Set(['item_claimed', 'item_released', 'lease_renewed', 'lease_expired']);

export function kindOf(name: string): EventKind {
  if (name.startsWith('gate_') || name === 'submitted_to_gate' || name.startsWith('checks_'))
    return 'gate';
  if (name.startsWith('run_')) return 'run';
  if (commentNames.has(name)) return 'comment';
  return leaseNames.has(name) ? 'lease' : 'other';
}

export function kindParam(value: string | undefined): EventKind | null {
  return eventKinds.find((kind) => kind === value) ?? null;
}

const dots: Readonly<Record<Exclude<EventKind, 'gate'>, string>> = {
  run: 'bg-accent',
  comment: 'bg-ok',
  lease: 'bg-text-3',
  other: 'bg-line-strong',
};

function Dot(props: { readonly kind: EventKind }) {
  if (props.kind === 'gate') return <HumanDot />;
  const tone = new Map(Object.entries(dots)).get(props.kind) ?? 'bg-line-strong';
  return <span aria-hidden="true" class={`mt-1 size-size-1 shrink-0 rounded-full ${tone}`}></span>;
}

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

export function KindFilters(props: { readonly base: string; readonly kind: EventKind | null }) {
  const chip = `rounded-full px-3 py-1 text-sm font-semibold text-text-3 hover:text-text aria-[current=true]:bg-hover aria-[current=true]:text-text ${focus}`;
  return (
    <nav aria-label="Kinds of event" class="mb-4 flex flex-wrap gap-1">
      <a href={props.base} aria-current={props.kind === null ? 'true' : undefined} class={chip}>
        All events
      </a>
      {eventKinds.map((kind) => (
        <a
          href={`${props.base}?kind=${kind}`}
          aria-current={props.kind === kind ? 'true' : undefined}
          class={chip}
        >
          {kindWords.get(kind) ?? kind}
        </a>
      ))}
    </nav>
  );
}

type Day = { readonly day: string; readonly events: readonly HarnessEvent[] };

function daysOf(events: readonly HarnessEvent[]): readonly Day[] {
  const days: { day: string; events: HarnessEvent[] }[] = [];
  for (const event of events) {
    const day = formatDate(new Date(event.at));
    const last = days.at(-1);
    if (last !== undefined && last.day === day) last.events.push(event);
    else days.push({ day, events: [event] });
  }
  return days;
}

export function Timeline(props: {
  readonly events: readonly HarnessEvent[];
  readonly learnings: ReadonlyMap<string, Label>;
  readonly personaPages: ReadonlyMap<string, string>;
}) {
  return (
    <div class="flex flex-col gap-5">
      {daysOf(props.events).map((group) => (
        <section aria-label={group.day} class="flex flex-col gap-2">
          <h2 class="m-0 font-mono text-xs font-regular text-text-3">{group.day}</h2>
          <ol class="m-0 flex list-none flex-col gap-2 border-l border-line p-0 pl-4">
            {group.events.map((event) => (
              <PlayRow
                event={event}
                learnings={props.learnings}
                personaPages={props.personaPages}
                dot={<Dot kind={kindOf(event.name)} />}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
