import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import {
  seenCredential,
  type CredentialLine,
  type CredentialRecord,
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
  standingOf,
} from '../parts/credential-words.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { credentialPath, credentialsPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const empty = 'm-0 px-4 py-3 text-sm text-text-3';
const quiet = 'm-0 text-sm text-text-3';
const otherWorkflow = 'A workflow you cannot open';

type Seen = {
  readonly record: CredentialRecord;
  readonly workflows: readonly Choice[];
  readonly at: Date;
};

const factColumns = [
  { key: 'fact', label: 'Fact' },
  { key: 'value', label: 'Value' },
];

function Facts(props: { readonly seen: Seen }) {
  const { line, managed } = props.seen.record;
  const facts: readonly (readonly [string, string])[] = [
    ['Area', areaLabel(line.jdArea)],
    ['Category or ID', line.jdRef ?? 'The whole area'],
    ['Kind', kindWord(line.kind)],
    ['Owner', line.owner],
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
    <Card title="About" sub={<StandingBadge line={line} at={props.seen.at} />} flush>
      <Table
        caption="About this credential"
        columns={factColumns}
        rows={facts.map(([fact, value]) => ({ fact, value }))}
        bare
      />
    </Card>
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
    <Card title="Value" sub="Never shown unless you reveal it">
      {open ? (
        <RevealControl line={line} />
      ) : (
        <p class={quiet}>{revealWords(line, props.seen.at)}</p>
      )}
    </Card>
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
    <Card title="Where it can be used" sub="A workflow and a connector, and nowhere else" flush>
      {rows.length === 0 ? (
        <p class={empty}>Bound nowhere, so nothing can use it.</p>
      ) : (
        <Table caption="Where it can be used" columns={bindingColumns} rows={rows} bare />
      )}
      {line.revokedAt === null ? (
        <div class="border-t border-line px-4 py-3">
          <BindForm credentialId={line.id} workflows={seen.workflows} />
        </div>
      ) : null}
    </Card>
  );
}

const grantColumns = [
  { key: 'person', label: 'Person' },
  { key: 'by', label: 'Given by' },
  { key: 'ends', label: 'Ends' },
  { key: 'status', label: 'Status' },
  { key: 'change', label: 'Change' },
];

function Grants(props: { readonly seen: Seen; readonly managed: Managed }) {
  const { seen, managed } = props;
  const { line } = seen.record;
  const rows = managed.grants.map((grant) => ({
    person: grant.person,
    by: grant.secondBy === null ? grant.grantedBy : `${grant.grantedBy} and ${grant.secondBy}`,
    ends: formatInstant(grant.expiresAt),
    status: grant.waitsForSecond ? (
      <Badge tone="person">Waiting for a second org admin</Badge>
    ) : (
      <Badge tone="success">Live</Badge>
    ),
    change: <GrantControls grant={grant} />,
  }));
  return (
    <Card title="Reveal grants" sub="Who may see the value, and until when" flush>
      {rows.length === 0 ? (
        <p class={empty}>Nobody holds a reveal grant.</p>
      ) : (
        <Table caption="Reveal grants" columns={grantColumns} rows={rows} bare />
      )}
      {line.revokedAt === null ? (
        <div class="border-t border-line px-4 py-3">
          <GrantRevealForm
            credentialId={line.id}
            alone={managed.alone}
            seers={managed.seers.map((person) => ({ value: person.personId, label: person.email }))}
          />
        </div>
      ) : null}
    </Card>
  );
}

const logColumns = [
  { key: 'at', label: 'When' },
  { key: 'who', label: 'Who' },
  { key: 'what', label: 'What' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'where', label: 'Where' },
];

function Log(props: { readonly seen: Seen; readonly managed: Managed }) {
  const titles = new Map(props.seen.workflows.map((choice) => [choice.value, choice.label]));
  const rows = props.managed.log.map((entry) => ({
    at: formatInstant(entry.at),
    who: actorWord(entry),
    what: actionWord(entry.action),
    outcome: outcomeWord(entry),
    where:
      entry.harnessId === null
        ? ''
        : `${titles.get(entry.harnessId) ?? otherWorkflow} · ${connectorWord(entry.connectorKey ?? '')}`,
  }));
  return (
    <Card title="Access log" sub="Every use, reveal and change, newest first" flush>
      <Table caption="Access log" columns={logColumns} rows={rows} bare />
    </Card>
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
        <Card title="Rotate" sub="Seal a new value; the old one stops being used">
          <RotateForm credentialId={line.id} />
        </Card>
      ) : null}
      {live ? (
        <Card title="Revoke" sub="For a credential that must never be used again">
          <RevokeCredential line={line} />
        </Card>
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
  const seen = { record, workflows, at: screen.at };
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
    <>
      <PageHead title={line.name} eyebrow={areaLabel(line.jdArea)} lede={kindWord(line.kind)} />
      <KeptOutcome />
      <div class="flex flex-col gap-5">
        <Facts seen={seen} />
        <Reveal seen={seen} />
        {managed === null ? null : <Manage seen={seen} managed={managed} />}
      </div>
    </>,
  );
}
