import type { HarnessEvent } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatCount, formatMoney } from '@uw/core/money';
import { reasonText } from '@uw/ui/components/text.ts';

type Fact = { readonly label: string; readonly value: string; readonly identity?: string };
export type Shown = { readonly facts: readonly Fact[]; readonly list: readonly string[] };

type Fields = ReadonlyMap<string, unknown>;
type Describe = (fields: Fields, event: HarnessEvent) => Shown;

function text(fields: Fields, key: string): string | null {
  const value = fields.get(key);
  return typeof value === 'string' ? value : null;
}

function count(fields: Fields, key: string): number {
  const value = fields.get(key);
  return typeof value === 'number' ? value : 0;
}

function texts(fields: Fields, key: string): readonly string[] {
  const value = fields.get(key);
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function words(value: string | null): string {
  return value === null ? 'None' : reasonText(value);
}

function instant(value: string | null): string {
  return value === null ? 'None' : formatInstant(new Date(value));
}

function shortId(value: string | null): string {
  return value === null ? 'None' : value.slice(0, 8);
}

function facts(...entries: readonly Fact[]): Shown {
  return { facts: entries, list: [] };
}

function runStep(fields: Fields): Shown {
  const basis = text(fields, 'costBasis');
  const shown = [
    { label: 'Step', value: words(text(fields, 'step')) },
    { label: 'Model', value: text(fields, 'model') ?? 'Not reported' },
    { label: 'Tokens in', value: formatCount(count(fields, 'tokensIn')) },
    { label: 'Tokens out', value: formatCount(count(fields, 'tokensOut')) },
    { label: 'Cost basis', value: basis === 'metered' ? 'Metered' : 'Subscription' },
  ];
  if (basis !== 'metered') return facts(...shown);
  const amountMinor = count(fields, 'costMinor') + count(fields, 'computeMinor');
  return facts(...shown, { label: 'Cost', value: formatMoney({ amountMinor, currency: 'USD' }) });
}

function run(reasonKey: string): Describe {
  return (fields) =>
    facts(
      { label: 'Run', value: shortId(text(fields, 'runId')) },
      { label: 'Reason', value: words(text(fields, reasonKey)) },
    );
}

function runStarted(fields: Fields): Shown {
  return facts(
    { label: 'Run', value: shortId(text(fields, 'runId')) },
    { label: 'Engine', value: text(fields, 'engine') ?? 'None' },
    { label: 'Model', value: text(fields, 'model') ?? 'None' },
  );
}

function decided(decision: string, extra: (fields: Fields) => Shown): Describe {
  return (fields, event) => {
    const more = extra(fields);
    const shown = [
      { label: 'Decision', value: decision },
      { label: 'Stage', value: text(fields, 'stage') ?? 'None' },
      { label: 'Decided by', value: event.actor, identity: event.actor },
    ];
    return { facts: [...shown, ...more.facts], list: more.list };
  };
}

const none: (fields: Fields) => Shown = () => facts();

function holderFact(fields: Fields): Fact {
  const held = text(fields, 'holder');
  return held === null
    ? { label: 'Holder', value: 'None' }
    : { label: 'Holder', value: held, identity: held };
}

function personFact(label: string, fields: Fields, otherwise: string): Fact {
  const personId = text(fields, 'personId');
  const value = text(fields, 'email') ?? otherwise;
  return personId === null ? { label, value } : { label, value, identity: `human:${personId}` };
}

function holder(fields: Fields): Shown {
  return facts(holderFact(fields), {
    label: 'Lease until',
    value: instant(text(fields, 'leaseExpiresAt')),
  });
}

function branch(fields: Fields, event: HarnessEvent): Shown {
  return facts(
    { label: 'Branch', value: `harness/${event.itemId ?? ''}` },
    { label: 'Head', value: text(fields, 'head') ?? 'None' },
  );
}

function comment(fields: Fields): Shown {
  const shown = [personFact('Author', fields, 'Unknown'), { label: 'Source', value: 'Zulip' }];
  if (fields.get('truncated') !== true) return facts(...shown);
  return facts(...shown, { label: 'Length', value: 'Cut at 10,000 characters' });
}

function delegatedExitClaimed(fields: Fields): Shown {
  const decision = shortId(text(fields, 'decisionId'));
  return { facts: [], list: [`The minute job took the delegated exit for decision ${decision}`] };
}

function delegatedMerge(fields: Fields): Shown {
  return {
    facts: [
      { label: 'Persona', value: text(fields, 'persona') ?? 'None' },
      { label: 'Up to tier', value: words(text(fields, 'maxTier')) },
      personFact('Granted by', fields, 'A person no longer named'),
    ],
    list: [`Merged under a delegation until ${instant(text(fields, 'expiresAt'))}`],
  };
}

const describers: ReadonlyMap<string, Describe> = new Map<string, Describe>([
  ['run_step_recorded', runStep],
  ['run_started', runStarted],
  ['run_completed', run('result')],
  ['run_failed', run('why')],
  ['run_stopped', run('why')],
  ['run_hibernated', run('why')],
  ['run_resumed', run('why')],
  [
    'submitted_to_gate',
    (fields) =>
      facts(
        { label: 'Stage', value: text(fields, 'stage') ?? 'None' },
        { label: 'Result', value: words(text(fields, 'result')) },
      ),
  ],
  ['gate_approved', decided('Approved', none)],
  [
    'gate_rejected',
    decided('Rejected', (fields) => ({ facts: [], list: texts(fields, 'findings') })),
  ],
  ['gate_taken_over', decided('Taken over', (fields) => facts(holderFact(fields)))],
  [
    'gate_overridden',
    decided('Overridden', (fields) =>
      facts({ label: 'Reason', value: text(fields, 'reason') ?? 'None' }),
    ),
  ],
  [
    'gate_refused_to_agent',
    decided('Refused to an agent', (fields) =>
      facts({ label: 'Asked for', value: words(text(fields, 'decision')) }),
    ),
  ],
  [
    'ship_refused',
    decided('Refused by the ship rule', (fields) => ({
      facts: [],
      list: texts(fields, 'reasons').map(reasonText),
    })),
  ],
  ['item_claimed', holder],
  ['item_released', holder],
  ['lease_renewed', holder],
  ['lease_expired', holder],
  ['branch_abandoned', branch],
  ['branch_adopted', branch],
  [
    'delegation_granted',
    (fields) =>
      facts(
        { label: 'Persona', value: text(fields, 'persona') ?? 'None' },
        { label: 'Capability', value: words(text(fields, 'capability')) },
        { label: 'Expires', value: instant(text(fields, 'expiresAt')) },
      ),
  ],
  [
    'delegation_revoked',
    (fields) => facts({ label: 'Delegation', value: shortId(text(fields, 'delegationId')) }),
  ],
  [
    'delegation_lapsed',
    (fields) =>
      facts(
        { label: 'Delegation', value: shortId(text(fields, 'delegationId')) },
        { label: 'Reason', value: words(text(fields, 'why')) },
      ),
  ],
  [
    'delegation_required',
    (fields) => facts({ label: 'Stage', value: text(fields, 'stage') ?? 'None' }),
  ],
  ['comment_recorded', comment],
  ['delegated_merge', delegatedMerge],
  ['delegated_exit_claimed', delegatedExitClaimed],
]);

export function evidenceOf(event: HarnessEvent): Shown {
  const describe = describers.get(event.name);
  if (describe === undefined) return facts();
  return describe(new Map(Object.entries(event.evidence)), event);
}

export function eventIdentities(events: readonly HarnessEvent[]): readonly string[] {
  return events.flatMap((event) => {
    const fields = new Map(Object.entries(event.evidence));
    const personId = text(fields, 'personId');
    return [
      event.actor,
      text(fields, 'holder') ?? '',
      personId === null ? '' : `human:${personId}`,
    ];
  });
}
