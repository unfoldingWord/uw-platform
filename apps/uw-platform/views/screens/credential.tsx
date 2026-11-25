import type { Child } from 'hono/jsx';
import type { Principal } from '@uw/core/principal';
import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { Badge } from '@uw/ui/components/badge.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { fieldLabel } from '@uw/ui/components/field.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import {
  seenCredential,
  type CredentialLine,
  type CredentialRecord,
  type GrantLine,
  type LogLine,
  type Managed,
} from '../../credentials/records.ts';
import type { AppEnv } from '../../deps.ts';
import { KeptOutcome } from '../parts/access-forms.tsx';
import {
  BindForm,
  GrantControls,
  GrantRevealForm,
  RevealControl,
  RevokeCredential,
  RotateForm,
  StandingBadge,
  UnbindControl,
  type Choice,
} from '../parts/credential-forms.tsx';
import {
  actionWord,
  actorWord,
  connectorWord,
  dayOrNone,
  instantOrNone,
  kindWord,
  outcomeWord,
  ownerOf,
  someoneOf,
  standingOf,
} from '../parts/credential-words.ts';
import { Who, type Reading } from '../parts/person.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { credentialPath, credentialsPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const quiet = 'm-0 text-sm text-text-3';
const otherWorkflow = 'A workflow you cannot open';

type Seen = {
  readonly record: CredentialRecord;
  readonly workflows: readonly Choice[];
  readonly at: Date;
  readonly reader: Principal;
};

function Facts(props: { readonly seen: Seen }) {
  const { line, managed } = props.seen.record;
  const reading = { reader: props.seen.reader, at: props.seen.at };
  const facts: readonly (readonly [string, Child])[] = [
    ['Area', areaLabel(line.jdArea)],
    ['Category or ID', line.jdRef ?? 'The whole area'],
    ['Kind', kindWord(line.kind)],
    ['Owner', <Who reading={reading} who={ownerOf(line)} />],
    ['Rotate by', dayOrNone(line.rotateBy)],
    ['Expires', instantOrNone(line.expiresAt, 'No end')],
    ['Last used', instantOrNone(line.lastUsedAt, 'Never')],
    ...(managed === null
      ? []
      : [
          [
            'Version',
            `${managed.version}, sealed ${instantOrNone(managed.sealedAt, 'never')}`,
          ] as const,
        ]),
  ];
  return (
    <Section title="About" sub={<StandingBadge line={line} at={props.seen.at} />} tight>
      <ul aria-label="About this credential" class="m-0 flex list-none flex-col gap-3 p-0">
        {facts.map(([fact, value]) => (
          <li class="flex min-w-0 flex-col gap-1">
            <span class={fieldLabel}>{fact}</span>
            <span class="text-sm text-text">{value}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function revealWords(line: CredentialLine, at: Date): string {
  const standing = standingOf(line, at);
  if (standing === 'revoked') return 'This credential is revoked. Nobody can reveal its value.';
  if (standing === 'expired') return 'This credential has expired. Nobody can reveal its value.';
  return 'You hold no reveal grant for this credential. An admin of its area gives one, for a set time.';
}

function Reveal(props: { readonly seen: Seen }) {
  const { line } = props.seen.record;
  const open = line.revealable && standingOf(line, props.seen.at) === 'active';
  return (
    <Section title="Value" sub="Never shown unless you reveal it">
      {open ? (
        <RevealControl line={line} />
      ) : (
        <p class={quiet}>{revealWords(line, props.seen.at)}</p>
      )}
    </Section>
  );
}

const bindingColumns = [
  { key: 'workflow', label: 'Workflow' },
  { key: 'connector', label: 'Connector' },
  { key: 'unbind', label: 'Unbind' },
];

function Bindings(props: { readonly seen: Seen; readonly managed: Managed }) {
  const { seen, managed } = props;
  const { line } = seen.record;
  const titles = new Map(seen.workflows.map((choice) => [choice.value, choice.label]));
  const rows = managed.bindings.map((binding) => {
    const workflow = titles.get(binding.harnessId) ?? otherWorkflow;
    return {
      workflow,
      connector: connectorWord(binding.connectorKey),
      unbind: <UnbindControl credentialId={line.id} {...binding} workflow={workflow} />,
    };
  });
  return (
    <Section title="Where it can be used" sub="A workflow and a connector, and nowhere else">
      {rows.length === 0 ? (
        <EmptyState title="Bound nowhere, so nothing can use it." />
      ) : (
        <Table caption="Where it can be used" columns={bindingColumns} rows={rows} bare />
      )}
      {line.revokedAt === null ? (
        <BindForm credentialId={line.id} workflows={seen.workflows} />
      ) : null}
    </Section>
  );
}

const grantColumns = [
  { key: 'person', label: 'Person' },
  { key: 'by', label: 'Given by' },
  { key: 'ends', label: 'Ends' },
  { key: 'status', label: 'Status' },
  { key: 'change', label: 'Change' },
];

function GivenBy(props: { readonly reading: Reading; readonly grant: GrantLine }) {
  const { grant, reading } = props;
  const giver = <Who reading={reading} who={someoneOf(grant.giver, grant.grantedBy)} />;
  if (grant.secondBy === null) return giver;
  return (
    <span class="inline-flex flex-wrap items-center gap-2">
      {giver}
      <span>and</span>
      <Who reading={reading} who={someoneOf(grant.second, grant.secondBy)} />
    </span>
  );
}

function Grants(props: { readonly seen: Seen; readonly managed: Managed }) {
  const { seen, managed } = props;
  const { line } = seen.record;
  const reading = { reader: seen.reader, at: seen.at };
  const rows = managed.grants.map((grant) => ({
    person: <Who reading={reading} who={someoneOf(grant.holder, grant.person)} />,
    by: <GivenBy reading={reading} grant={grant} />,
    ends: formatInstant(grant.expiresAt),
    status: grant.waitsForSecond ? (
      <Badge tone="person">Waiting for a second org admin</Badge>
    ) : (
      <Badge tone="success">Live</Badge>
    ),
    change: <GrantControls grant={grant} />,
  }));
  return (
    <Section title="Reveal grants" sub="Who may see the value, and until when">
      {rows.length === 0 ? (
        <EmptyState title="Nobody holds a reveal grant." />
      ) : (
        <Table caption="Reveal grants" columns={grantColumns} rows={rows} bare />
      )}
      {line.revokedAt === null ? (
        <GrantRevealForm
          credentialId={line.id}
          alone={managed.alone}
          seers={managed.seers.map((person) => ({ value: person.personId, label: person.email }))}
        />
      ) : null}
    </Section>
  );
}

const logColumns = [
  { key: 'at', label: 'When' },
  { key: 'who', label: 'Who' },
  { key: 'what', label: 'What' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'where', label: 'Where' },
];

function Actor(props: { readonly reading: Reading; readonly entry: LogLine }) {
  const { entry, reading } = props;
  const who = someoneOf(entry.personName, entry.person ?? 'nobody');
  const word = actorWord(entry);
  if (entry.actor.startsWith('human:')) return <Who reading={reading} who={who} />;
  if (!entry.actor.startsWith('agent:')) return <>{word}</>;
  return (
    <span class="inline-flex flex-wrap items-center gap-2">
      <span>An agent for</span>
      <Who reading={reading} who={who} />
    </span>
  );
}

function Log(props: { readonly seen: Seen; readonly managed: Managed }) {
  const titles = new Map(props.seen.workflows.map((choice) => [choice.value, choice.label]));
  const reading = { reader: props.seen.reader, at: props.seen.at };
  const rows = props.managed.log.map((entry) => ({
    at: formatInstant(entry.at),
    who: <Actor reading={reading} entry={entry} />,
    what: actionWord(entry.action),
    outcome: outcomeWord(entry),
    where:
      entry.harnessId === null
        ? ''
        : `${titles.get(entry.harnessId) ?? otherWorkflow} · ${connectorWord(entry.connectorKey ?? '')}`,
  }));
  return (
    <Section title="Access log" sub="Every use, reveal and change, newest first" flush>
      <Table caption="Access log" columns={logColumns} rows={rows} bare />
    </Section>
  );
}

function Manage(props: { readonly seen: Seen; readonly managed: Managed }) {
  const { seen, managed } = props;
  const { line } = seen.record;
  const live = line.revokedAt === null;
  return (
    <>
      <Bindings seen={seen} managed={managed} />
      <Grants seen={seen} managed={managed} />
      {live ? (
        <Section title="Rotate" sub="Seal a new value; the old one stops being used">
          <RotateForm credentialId={line.id} />
        </Section>
      ) : null}
      {live ? (
        <Section title="Revoke" sub="For a credential that must never be used again">
          <RevokeCredential line={line} />
        </Section>
      ) : null}
      <Log seen={seen} managed={managed} />
    </>
  );
}

export async function credentialScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const credentialId = c.req.param('credentialId') ?? '';
  const record = await seenCredential(database.db, screen.caller.actor, credentialId, screen.at);
  if (record === null) return notFound(c);
  const { line, managed } = record;
  const counts = managed === null ? null : await screen.kernel.views.frame(screen.caller, screen);
  const workflows = (counts?.harnesses ?? []).map(({ harness }) => ({
    value: harness.id,
    label: harness.title,
  }));
  const seen = { record, workflows, at: screen.at, reader: screen.caller.actor };
  const spec = {
    title: `${line.name} · ${pageNames.credential}`,
    current: credentialsPath(),
    code: moduleCodes.credentials,
    crumbs: [
      { label: pageNames.infrastructure },
      { label: pageNames.credentials, href: credentialsPath() },
      { label: line.name, href: credentialPath(line.id) },
    ],
  };
  return renderScreen(
    c,
    spec,
    <DocumentShape
      head={{ title: line.name, eyebrow: areaLabel(line.jdArea), lede: kindWord(line.kind) }}
      rail={<Facts seen={seen} />}
    >
      <KeptOutcome />
      <Reveal seen={seen} />
      {managed === null ? null : <Manage seen={seen} managed={managed} />}
    </DocumentShape>,
  );
}
