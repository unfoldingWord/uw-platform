import type { EvidenceLabel as Label, HarnessEvent } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { Chip } from '@uw/ui/components/chip.tsx';
import { HumanDot } from '@uw/ui/components/human-action.tsx';
import type { Holding } from './holder.tsx';
import { PlayRow } from './play-row.tsx';

const eventKinds = ['gate', 'run', 'comment', 'lease'] as const;
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

export function KindFilters(props: { readonly base: string; readonly kind: EventKind | null }) {
  return (
    <nav aria-label="Kinds of event" class="flex flex-wrap gap-2">
      <Chip label="All events" href={props.base} selected={props.kind === null} />
      {eventKinds.map((kind) => (
        <Chip
          label={kindWords.get(kind) ?? kind}
          href={`${props.base}?kind=${kind}`}
          selected={props.kind === kind}
        />
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
  readonly holding: Holding;
}) {
  return (
    <div class="flex flex-col gap-6">
      {daysOf(props.events).map((group) => (
        <section aria-label={group.day} class="flex flex-col gap-2">
          <h2 class="m-0 font-mono text-xs font-regular text-text-3">{group.day}</h2>
          <ol class="m-0 flex list-none flex-col p-0">
            {group.events.map((event) => (
              <PlayRow
                event={event}
                learnings={props.learnings}
                personaPages={props.personaPages}
                holding={props.holding}
                dot={<Dot kind={kindOf(event.name)} />}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
