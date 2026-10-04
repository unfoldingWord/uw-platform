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

type Shape = (given: ReadonlyMap<string, string>) => Readonly<Record<string, unknown>>;

const itemOnly: Shape = (given) => ({ itemId: given.get('itemId') });

const shapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['enqueue', (given) => ({ title: given.get('title'), pageId: null, due: null })],
  [
    'reorder',
    (given) => ({ itemId: given.get('itemId'), beforeItemId: optional(given.get('beforeItemId')) }),
  ],
  ['claim', itemOnly],
  ['release', itemOnly],
  ['take_over', itemOnly],
  ['approve', (given) => ({ itemId: given.get('itemId'), head: optional(given.get('head')) })],
  [
    'reject',
    (given) => ({ itemId: given.get('itemId'), findings: findingsOf(given.get('findings')) }),
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
