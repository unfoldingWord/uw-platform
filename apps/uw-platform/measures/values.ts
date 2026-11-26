import {
  observedValueSchema,
  type MeasureFrontmatter,
  type MeasureValueDefinition,
  type ObservedValue,
  type ObservedValues,
  type ValueType,
} from '@uw/contracts';

export type ReadValues =
  | { readonly ok: true; readonly values: ObservedValues }
  | { readonly ok: false; readonly reason: 'output_not_json' | 'output_unfit' | 'tool_failed' };

export type ReadingRule = Pick<MeasureFrontmatter, 'failure_path'> & {
  readonly values: readonly MeasureValueDefinition[];
};

const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

function parsed(text: string): { readonly ok: true; readonly value: unknown } | null {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

function unescaped(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function child(node: unknown, token: string): unknown {
  if (Array.isArray(node)) return ARRAY_INDEX.test(token) ? node[Number(token)] : undefined;
  if (node === null || typeof node !== 'object') return undefined;
  return new Map<string, unknown>(Object.entries(node)).get(token);
}

function pointerAt(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  return pointer.slice(1).split('/').map(unescaped).reduce(child, document);
}

const fitsType: Readonly<Record<ValueType, (value: unknown) => boolean>> = {
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  percent: (value) => typeof value === 'number' && Number.isFinite(value),
  text: (value) => typeof value === 'string',
  text_list: (value) => Array.isArray(value) && value.every((each) => typeof each === 'string'),
  yes_no: (value) => typeof value === 'boolean',
};

const expected: Readonly<Record<ValueType, string>> = {
  number: 'a number',
  percent: 'a number',
  text: 'text',
  text_list: 'a list of text',
  yes_no: 'true or false',
};

export type ValueProblem = {
  readonly index: number;
  readonly key: string;
  readonly message: string;
};

export type ValueReading =
  | { readonly json: false }
  | {
      readonly json: true;
      readonly values: ObservedValues;
      readonly problems: readonly ValueProblem[];
      readonly failure: string | null;
    };

function kindOf(found: unknown): string {
  if (found === null) return 'null';
  if (Array.isArray(found)) return 'a list';
  if (typeof found === 'object') return 'an object';
  if (typeof found === 'string') return 'text';
  if (typeof found === 'boolean') return 'true or false';
  return 'a number';
}

function problemOf(found: unknown, definition: MeasureValueDefinition): string | null {
  const at = definition.path || 'the whole output';
  if (found === undefined) return `nothing at ${at}`;
  if (!fitsType[definition.type](found)) {
    return `found ${kindOf(found)} at ${at}, expected ${expected[definition.type]}`;
  }
  return observedValueSchema.safeParse(found).success ? null : `found a value too long at ${at}`;
}

function failureIn(document: unknown, failurePath: string | undefined): string | null {
  if (failurePath === undefined) return null;
  const found = pointerAt(document, failurePath);
  const quiet = found === undefined || found === null || found === false || found === '';
  return quiet ? null : `the tool reported a failure at ${failurePath}`;
}

export function valueReading(stdout: string, rule: ReadingRule): ValueReading {
  const document = parsed(stdout);
  if (document === null) return { json: false };
  const kept: [string, ObservedValue][] = [];
  const problems: ValueProblem[] = [];
  rule.values.forEach((definition, index) => {
    const found = pointerAt(document.value, definition.path);
    const message = problemOf(found, definition);
    if (message !== null) problems.push({ index, key: definition.key, message });
    else kept.push([definition.key, observedValueSchema.parse(found)]);
  });
  const failure = failureIn(document.value, rule.failure_path);
  return { json: true, values: Object.fromEntries(kept), problems, failure };
}

export function readValues(stdout: string, rule: ReadingRule): ReadValues {
  const reading = valueReading(stdout, rule);
  if (!reading.json) return { ok: false, reason: 'output_not_json' };
  if (reading.failure !== null) return { ok: false, reason: 'tool_failed' };
  if (reading.problems.length > 0) return { ok: false, reason: 'output_unfit' };
  return { ok: true, values: reading.values };
}
