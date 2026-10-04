export type PushPayload = {
  readonly harness: string | null;
  readonly reason: string | null;
  readonly link: string;
};

export const PUSH_TITLES: Readonly<Record<string, string>> = {
  gate_waiting: 'A gate is waiting on you',
  run_failed: 'A run failed on an item you hold',
  delegation_lapsed: 'A delegation you gave has lapsed',
  stage_advanced: 'An item you hold moved on',
};

export const DEFAULT_PUSH_TITLE = 'Something is waiting on you';

const LINK_LIMIT = 2000;
const DELETE = 127;
const FIRST_PRINTABLE = 32;

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < FIRST_PRINTABLE || code === DELETE;
  });
}

export function safeLink(link: unknown): string {
  if (typeof link !== 'string' || link.length > LINK_LIMIT) return '/';
  if (!link.startsWith('/') || link.startsWith('//')) return '/';
  if (link.includes('\\') || hasControlCharacter(link)) return '/';
  return link;
}

function field(data: unknown, name: string): unknown {
  if (typeof data !== 'object' || data === null) return null;
  return new Map(Object.entries(data)).get(name) ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function pushPayload(data: unknown): PushPayload {
  return {
    harness: text(field(data, 'harness')),
    reason: text(field(data, 'reason')),
    link: safeLink(field(data, 'link')),
  };
}

const titles: ReadonlyMap<string, string> = new Map(Object.entries(PUSH_TITLES));

export function pushTitle(payload: PushPayload): string {
  return (payload.reason === null ? undefined : titles.get(payload.reason)) ?? DEFAULT_PUSH_TITLE;
}

export function isShellAsset(pathname: string, assets: readonly string[]): boolean {
  return assets.includes(pathname);
}
