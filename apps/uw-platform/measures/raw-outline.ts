import type { ValueType } from '@uw/contracts';

type OutlineSample = number | string | boolean | null;

type OutlineLeaf = {
  readonly path: string;
  readonly type: ValueType | null;
  readonly sample: OutlineSample;
};

export type Outline = { readonly leaves: readonly OutlineLeaf[]; readonly more: boolean };

const SAMPLE_LENGTH = 80;
const MOST_PATH = 300;
const ELLIPSIS = '…';

function parsedJson(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

function escaped(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function shortened(text: string): string {
  if (text.length <= SAMPLE_LENGTH) return text;
  let kept = '';
  for (const character of text) {
    if (kept.length + character.length + ELLIPSIS.length > SAMPLE_LENGTH) break;
    kept += character;
  }
  return `${kept}${ELLIPSIS}`;
}

function leafOf(path: string, value: unknown): OutlineLeaf | null {
  if (value === null) return { path, type: null, sample: null };
  if (typeof value === 'number') return { path, type: 'number', sample: value };
  if (typeof value === 'boolean') return { path, type: 'yes_no', sample: value };
  if (typeof value === 'string') return { path, type: 'text', sample: shortened(value) };
  const texts = Array.isArray(value) && value.length > 0;
  if (texts && value.every((each) => typeof each === 'string')) {
    return { path, type: 'text_list', sample: shortened(String(value[0])) };
  }
  return null;
}

function childrenOf(path: string, value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((each, index) => [`${path}/${String(index)}`, each]);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).map(([key, each]) => [`${path}/${escaped(key)}`, each]);
}

export function outlineOf(text: string, most: number): Outline | null {
  const document = parsedJson(text);
  if (document === null) return null;
  const leaves: OutlineLeaf[] = [];
  const pending: [string, unknown][] = [['', document.value]];
  while (pending.length > 0) {
    const [path, value] = pending.pop() ?? ['', null];
    if (path.length > MOST_PATH) continue;
    const leaf = leafOf(path, value);
    if (leaf !== null) {
      if (leaves.length === most) return { leaves, more: true };
      leaves.push(leaf);
    } else for (const child of childrenOf(path, value).reverse()) pending.push(child);
  }
  return { leaves, more: false };
}
