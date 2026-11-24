import type { Child } from 'hono/jsx';
import { deviceOwnerSegment, type EvidenceLabel as Label, type HarnessEvent } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { EvidenceLabel } from '@uw/ui/components/evidence-label.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { personaPath } from './paths.ts';
import type { Holding } from './holder.tsx';
import { evidenceOf } from './play-evidence.ts';
import { Person, personIdOf, shownIdentity, Who } from './person.tsx';

function hostOf(identity: string): string {
  if (identity.startsWith('human:')) return 'Person';
  return deviceOwnerSegment(identity) === null ? 'Platform' : 'Own machine';
}

function Learning(props: {
  readonly event: HarnessEvent;
  readonly learnings: ReadonlyMap<string, Label>;
}) {
  const pageId = props.event.evidence['pageId'];
  const label = typeof pageId === 'string' ? props.learnings.get(pageId) : undefined;
  if (label === undefined) return <p class="m-0 text-sm text-text-3">A learning you cannot read</p>;
  return <EvidenceLabel label={label} showDefinition />;
}

function FactValue(props: {
  readonly value: string;
  readonly identity: string | undefined;
  readonly holding: Holding;
}) {
  const { holding } = props;
  const who = shownIdentity(props.identity ?? null, holding.names, () => props.value);
  return <Who reading={holding.reading} who={who} />;
}

function Evidence(props: { readonly event: HarnessEvent; readonly holding: Holding }) {
  const shown = evidenceOf(props.event);
  return (
    <>
      {shown.facts.length === 0 ? null : (
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {shown.facts.map((fact) => (
            <li class="flex flex-wrap gap-x-2">
              <span class="text-text-3">{fact.label}</span>
              <span class="break-words text-text">
                <FactValue value={fact.value} identity={fact.identity} holding={props.holding} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown.list.length === 0 ? null : (
        <ul class="m-0 pl-5 text-sm">
          {shown.list.map((entry) => (
            <li class="break-words">{entry}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Comment(props: { readonly event: HarnessEvent; readonly holding: Holding }) {
  const text = props.event.evidence['text'];
  return (
    <>
      <Evidence event={props.event} holding={props.holding} />
      <blockquote class="m-0 whitespace-pre-wrap break-words border-l-2 border-line-soft pl-3 text-text">
        {typeof text === 'string' ? text : ''}
      </blockquote>
    </>
  );
}

function Detail(props: {
  readonly event: HarnessEvent;
  readonly learnings: ReadonlyMap<string, Label>;
  readonly holding: Holding;
}) {
  if (props.event.name === 'learning_attached') {
    return <Learning event={props.event} learnings={props.learnings} />;
  }
  if (props.event.name === 'comment_recorded') {
    return <Comment event={props.event} holding={props.holding} />;
  }
  return <Evidence event={props.event} holding={props.holding} />;
}

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function Actor(props: {
  readonly actor: string;
  readonly pageId: string | undefined;
  readonly holding: Holding;
}) {
  const id = personIdOf(props.actor);
  const person = id === null ? undefined : props.holding.names.get(id);
  if (person !== undefined) return <Person reading={props.holding.reading} person={person} />;
  const name = <code class="break-all font-mono text-sm text-text">{props.actor}</code>;
  if (props.pageId === undefined) return name;
  return (
    <a href={personaPath(props.pageId)} class={`text-accent-text underline ${focus}`}>
      {name}
    </a>
  );
}

export function PlayRow(props: {
  readonly event: HarnessEvent;
  readonly learnings: ReadonlyMap<string, Label>;
  readonly personaPages: ReadonlyMap<string, string>;
  readonly holding: Holding;
  readonly dot?: Child | undefined;
}) {
  const { event } = props;
  return (
    <li class="flex gap-3 border-b border-line-soft py-3 last:border-b-0">
      {props.dot}
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="font-semibold text-text">{reasonText(event.name)}</span>
          <span class="text-sm text-text-3">{formatInstant(new Date(event.at))}</span>
          <Actor
            actor={event.actor}
            pageId={props.personaPages.get(event.actor)}
            holding={props.holding}
          />
          <span class="text-sm text-text-3">{hostOf(event.actor)}</span>
        </div>
        <Detail event={event} learnings={props.learnings} holding={props.holding} />
      </div>
    </li>
  );
}
