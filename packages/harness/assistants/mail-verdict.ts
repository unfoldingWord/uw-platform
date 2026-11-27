export type MailHeader = { readonly name: string; readonly value: string };
export type SenderVerdict = 'pass' | 'automated_sender' | 'other_sender' | 'unverified_sender';
export type VerdictInput = {
  readonly headers: readonly MailHeader[];
  readonly fromAssistant: boolean;
};

type Result = {
  readonly method: string;
  readonly result: string;
  readonly props: Map<string, string>;
};

export const TRUSTED_AUTHSERV_ID = 'mx.google.com';

const ADDRESS = /[^\s<>,;:"()[\]\\]+@[^\s<>,;:"()[\]\\]+/g;
const AUTOMATED_PRECEDENCE: ReadonlySet<string> = new Set(['bulk', 'junk', 'list', 'auto_reply']);
const AUTOMATED_PRESENT: readonly string[] = [
  'list-id',
  'list-unsubscribe',
  'x-autoreply',
  'x-autorespond',
];

function named(headers: readonly MailHeader[], name: string): readonly string[] {
  return headers
    .filter((header) => header.name.toLowerCase() === name)
    .map((header) => header.value);
}

function withoutComments(value: string): string {
  let depth = 0;
  let kept = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) kept += character;
  }
  return kept;
}

function automated(input: VerdictInput): boolean {
  const { headers } = input;
  const submitted = named(headers, 'auto-submitted').some(
    (value) => !value.trim().toLowerCase().startsWith('no'),
  );
  const precedence = named(headers, 'precedence').some((value) =>
    AUTOMATED_PRECEDENCE.has(value.trim().toLowerCase()),
  );
  const listed = AUTOMATED_PRESENT.some((name) => named(headers, name).length > 0);
  const bounce = named(headers, 'return-path').some((value) => value.replace(/\s/g, '') === '<>');
  return input.fromAssistant || submitted || precedence || listed || bounce;
}

function fromOwner(headers: readonly MailHeader[], owner: string): boolean {
  const from = named(headers, 'from');
  if (from.length !== 1) return false;
  const addresses = withoutComments(from[0] ?? '').match(ADDRESS) ?? [];
  return addresses.length === 1 && addresses[0]?.toLowerCase() === owner.toLowerCase();
}

function resultOf(part: string): Result | null {
  const [head, ...rest] = part.trim().split(/\s+/);
  const match = /^([a-z0-9-]+)=([a-z]+)$/i.exec(head ?? '');
  if (match === null) return null;
  const props = new Map<string, string>();
  for (const pair of rest) {
    const equals = pair.indexOf('=');
    if (equals > 0)
      props.set(pair.slice(0, equals).toLowerCase(), pair.slice(equals + 1).toLowerCase());
  }
  return { method: (match[1] ?? '').toLowerCase(), result: (match[2] ?? '').toLowerCase(), props };
}

function trustedResults(headers: readonly MailHeader[]): readonly Result[] | null {
  const top = named(headers, 'authentication-results')[0];
  if (top === undefined) return null;
  const [authserv, ...parts] = withoutComments(top).split(';');
  const id = authserv?.trim().split(/\s+/)[0]?.toLowerCase();
  if (id !== TRUSTED_AUTHSERV_ID) return null;
  return parts.flatMap((part) => resultOf(part) ?? []);
}

function passed(
  results: readonly Result[],
  method: string,
  test: (props: Map<string, string>) => boolean,
) {
  return results.some(
    (result) => result.method === method && result.result === 'pass' && test(result.props),
  );
}

function authenticated(results: readonly Result[], owner: string): boolean {
  const address = owner.toLowerCase();
  const domain = address.slice(address.indexOf('@') + 1);
  if (passed(results, 'dmarc', (props) => props.get('header.from') === domain)) return true;
  const spf = passed(results, 'spf', (props) => props.get('smtp.mailfrom') === address);
  const dkim = passed(
    results,
    'dkim',
    (props) =>
      props.get('header.d') === domain || (props.get('header.i') ?? '').endsWith(`@${domain}`),
  );
  return spf && dkim;
}

export function emailSenderVerdict(input: VerdictInput, owner: string): SenderVerdict {
  if (automated(input)) return 'automated_sender';
  if (!fromOwner(input.headers, owner)) return 'other_sender';
  const results = trustedResults(input.headers);
  return results !== null && authenticated(results, owner) ? 'pass' : 'unverified_sender';
}
