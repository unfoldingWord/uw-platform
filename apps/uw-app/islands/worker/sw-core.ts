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

const harnessKey = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ShownPush = {
  readonly title: string;
  readonly options: {
    readonly body?: string;
    readonly tag: string;
    readonly data: { readonly link: string };
  };
};

export function pushNotification(payload: PushPayload): ShownPush {
  const named = payload.harness !== null && harnessKey.test(payload.harness);
  const body = named ? { body: `In ${payload.harness}.` } : {};
  return {
    title: pushTitle(payload),
    options: { ...body, tag: payload.link, data: { link: payload.link } },
  };
}

export function isShellAsset(pathname: string, assets: readonly string[]): boolean {
  return assets.includes(pathname);
}

export function shellCacheName(assets: readonly string[]): string {
  return `uw-shell ${assets.join(' ')}`;
}

export function staleCaches(keys: readonly string[], assets: readonly string[]): readonly string[] {
  const current = shellCacheName(assets);
  return keys.filter((key) => key !== current);
}
