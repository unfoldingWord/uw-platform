import { deviceOwnerSegment, type EvidenceLabel as Label, type HarnessEvent } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { EvidenceLabel } from '@uw/ui/components/evidence-label.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { personaPath } from './paths.ts';
import { evidenceOf } from './play-evidence.ts';

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
  if (label === undefined) return <p class="m-0 text-sm text-muted">A learning you cannot read</p>;
  return <EvidenceLabel label={label} showDefinition />;
}

function Evidence(props: { readonly event: HarnessEvent }) {
  const shown = evidenceOf(props.event);
  return (
    <>
      {shown.facts.length === 0 ? null : (
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {shown.facts.map((fact) => (
            <li class="flex flex-wrap gap-x-2">
              <span class="text-muted">{fact.label}</span>
              <span class="break-words text-ink">{fact.value}</span>
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

function Comment(props: { readonly event: HarnessEvent }) {
  const text = props.event.evidence['text'];
  return (
    <>
      <Evidence event={props.event} />
      <blockquote class="m-0 whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-ink">
        {typeof text === 'string' ? text : ''}
      </blockquote>
    </>
  );
}

function Detail(props: {
  readonly event: HarnessEvent;
  readonly learnings: ReadonlyMap<string, Label>;
}) {
  if (props.event.name === 'learning_attached') {
    return <Learning event={props.event} learnings={props.learnings} />;
  }
  if (props.event.name === 'comment_recorded') return <Comment event={props.event} />;
  return <Evidence event={props.event} />;
}

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

function Actor(props: { readonly actor: string; readonly pageId: string | undefined }) {
  const name = <code class="break-all font-mono text-sm text-ink">{props.actor}</code>;
  if (props.pageId === undefined) return name;
  return (
    <a href={personaPath(props.pageId)} class={`text-link underline ${focus}`}>
      {name}
    </a>
  );
}

export function PlayRow(props: {
  readonly event: HarnessEvent;
  readonly learnings: ReadonlyMap<string, Label>;
  readonly personaPages: ReadonlyMap<string, string>;
}) {
  const { event } = props;
  return (
    <li class="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="font-bold text-ink">{reasonText(event.name)}</span>
        <span class="text-sm text-muted">{formatInstant(new Date(event.at))}</span>
        <Actor actor={event.actor} pageId={props.personaPages.get(event.actor)} />
        <span class="text-sm text-muted">{hostOf(event.actor)}</span>
      </div>
      <Detail event={event} learnings={props.learnings} />
    </li>
  );
}
