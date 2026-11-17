import { harnessCommandSchemas } from '@uw/contracts';

export type CommandFields = Readonly<Record<string, string>>;

const schemas = new Map(Object.entries(harnessCommandSchemas));
const fields = (all: CommandFields) => new Map(Object.entries(all));
const optional = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

function findingsOf(text: string | undefined): readonly string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function entriesOf(text: string | undefined): readonly Readonly<Record<string, string>>[] {
  return (text ?? '')
    .split(',')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const [itemId = '', head = ''] = pair.split(':');
      return { itemId, head, decision: 'approve' };
    });
}

type Shape = (given: ReadonlyMap<string, string>) => Readonly<Record<string, unknown>>;

const itemOnly: Shape = (given) => ({ itemId: given.get('itemId') });

function versionOf(raw: string | undefined): number | null {
  return raw === undefined || raw === '' ? null : Number(raw);
}

const none: Shape = () => ({});

const calendarDay = /^\d{4}-\d{2}-\d{2}$/;

function endOfDay(day: string | undefined): string | null | undefined {
  if (day === undefined || day === '') return null;
  return calendarDay.test(day) ? `${day}T23:59:59.000Z` : undefined;
}

const grant: Shape = (given) => {
  const [persona, capability, tier] = (given.get('grant') ?? '').split('|');
  return {
    persona,
    capability,
    expiresAt: endOfDay(given.get('expiresOn')),
    supersedes: null,
    maxTier: optional(tier),
  };
};

const switched =
  (field: string): Shape =>
  (given) => ({ [field]: given.get(field) === 'true' });

const stageKeyOnly: Shape = (given) => ({ stageKey: optional(given.get('stageKey')) });

const stageField = /^stage\.(\d+)\.(.+)$/;

function rowsOf(given: ReadonlyMap<string, string>): readonly ReadonlyMap<string, string>[] {
  const rows = new Map<number, Map<string, string>>();
  for (const [name, value] of given) {
    const match = stageField.exec(name);
    if (match === null) continue;
    const index = Number(match[1]);
    const row = rows.get(index) ?? new Map<string, string>();
    row.set(match[2] ?? '', value);
    rows.set(index, row);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

function stageRuleOf(row: ReadonlyMap<string, string>): Readonly<Record<string, unknown>> {
  return {
    id: row.get('id'),
    agentPickup: row.get('agentPickup'),
    exitGate: row.get('exitGate'),
    wipLimit: Number(row.get('wipLimit')),
    instructionsPageId: optional(row.get('instructionsPageId')),
    validators: [...row.entries()]
      .filter(([name]) => name.startsWith('validator.'))
      .map(([, value]) => value),
  };
}

const shapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['open_workflow_draft', none],
  ['set_stage_rules', (given) => ({ stages: rowsOf(given).map(stageRuleOf) })],
  ['set_shadow', switched('shadow')],
  ['set_hosted_builder', switched('enabled')],
  ['set_freeze', (given) => ({ ...switched('frozen')(given), allow: [] })],
  ['pause', stageKeyOnly],
  ['resume', stageKeyOnly],
  ['discard_workflow_draft', none],
  ['publish_workflow_draft', (given) => ({ revision: versionOf(given.get('revision')) })],
  ['take_over_workflow_draft', (given) => ({ reason: given.get('reason') })],
  ['enqueue', (given) => ({ title: given.get('title'), pageId: null, due: null })],
  [
    'reorder',
    (given) => ({ itemId: given.get('itemId'), beforeItemId: optional(given.get('beforeItemId')) }),
  ],
  ['schedule_regular_tweak', grant],
  ['revoke_delegation', (given) => ({ delegationId: given.get('delegationId') })],
  ['claim', itemOnly],
  ['release', itemOnly],
  ['take_over', itemOnly],
  ['decide_gates', (given) => ({ entries: entriesOf(given.get('entries')) })],
  [
    'refute_finding',
    (given) => ({
      itemId: given.get('itemId'),
      runId: given.get('runId'),
      finding: Number(given.get('finding')),
    }),
  ],
  ['approve', (given) => ({ itemId: given.get('itemId'), head: optional(given.get('head')) })],
  [
    'reject',
    (given) => ({ itemId: given.get('itemId'), findings: findingsOf(given.get('findings')) }),
  ],
  [
    'activate_persona',
    (given) => ({
      pageId: given.get('pageId'),
      expectedVersion: versionOf(given.get('expectedVersion')),
    }),
  ],
  [
    'override',
    (given) => ({
      itemId: given.get('itemId'),
      head: optional(given.get('head')),
      reason: given.get('reason'),
    }),
  ],
]);

export function commandBody(
  command: string,
  given: CommandFields,
  requestId: string,
): Readonly<Record<string, unknown>> | null {
  const shape = shapes.get(command);
  const schema = schemas.get(command);
  if (shape === undefined || schema === undefined) return null;
  const body = { command, requestId, ...shape(fields(given)) };
  return schema.safeParse(body).success ? body : null;
}
