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

const shapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['enqueue', (given) => ({ title: given.get('title'), pageId: null, due: null })],
  [
    'reorder',
    (given) => ({ itemId: given.get('itemId'), beforeItemId: optional(given.get('beforeItemId')) }),
  ],
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
