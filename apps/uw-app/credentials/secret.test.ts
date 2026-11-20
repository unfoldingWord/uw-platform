import { describe, expect, it } from 'vitest';
import { newEventSchema, verbIo } from '@uw/contracts';
import { createLogger, errorFields, type LogValue } from '@uw/core/log';
import { toBase64, utf8 } from './base64.ts';
import { REDACTED, Secret, exposeSecret, secretOf, spendSecret } from './secret.ts';

const planted = 'uw-planted-credential-value-158';

function held(): Secret<string> {
  return secretOf(utf8(planted));
}

function passedOff<T>(secret: Secret<string>): T {
  return secret as unknown as T;
}

function leaks(text: string): boolean {
  return text.includes(planted) || text.includes(toBase64(utf8(planted)));
}

const inspect = Symbol.for('nodejs.util.inspect.custom');

type Rendering = (secret: Secret<string>) => string | null;

const renderings: readonly (readonly [string, Rendering])[] = [
  ['String()', (secret) => String(secret)],
  ['a template literal', (secret) => `Bearer ${passedOff<string>(secret)}`],
  ['string concatenation', (secret) => 'key=' + passedOff<string>(secret)],
  ['toString', (secret) => secret.toString()],
  ['JSON.stringify', (secret) => JSON.stringify(secret)],
  ['JSON.stringify of a field', (secret) => JSON.stringify({ key: secret })],
  ['JSON.stringify of a list', (secret) => JSON.stringify([secret])],
  ['a spread copy', (secret) => JSON.stringify({ ...secret })],
  ['its own keys', (secret) => Reflect.ownKeys(secret).map(String).join(',')],
  ['a structured clone', (secret) => JSON.stringify(structuredClone(secret))],
  ['console inspection', (secret) => String(Reflect.get(secret, inspect)?.())],
  [
    'a URL parameter',
    (secret) =>
      new URL(`https://partner.example/?key=${passedOff<string>(secret)}`).searchParams.get('key'),
  ],
  ['a header value', (secret) => new Headers({ a: passedOff(secret) }).get('a')],
];

function rendering(): void {
  it('gives the value to the one function that exposes it', () => {
    expect(exposeSecret(held())).toBe(planted);
  });

  it.each(renderings)('shows only the marker through %s', (_name, render) => {
    const text = render(held()) ?? '';
    expect(leaks(text)).toBe(false);
    expect(text === '' || text === '{}' || text.includes(REDACTED)).toBe(true);
  });
}

function logging(): void {
  it('holds nothing a debugger-style walk of its properties can reach', () => {
    const secret = held();
    const seen = [
      ...Object.entries(secret),
      ...Object.entries(Object.getOwnPropertyDescriptors(secret)),
    ];
    expect(seen).toEqual([]);
    expect(Object.isFrozen(secret)).toBe(true);
  });

  it('writes the marker, never the value, into a log line', () => {
    const lines: string[] = [];
    const logger = createLogger(
      { traceId: 't', commit: 'c', route: 'r', principal: null },
      (line) => lines.push(line),
    );
    const secret = held();
    logger.info(passedOff<string>(secret), {
      outcome: 'done',
      key: passedOff<LogValue>(secret),
    });
    logger.error('failed', { outcome: 'refused', ...errorFields(secret) });
    expect(lines).toHaveLength(2);
    expect(lines.some(leaks)).toBe(false);
    expect(lines.join('\n')).toContain(REDACTED);
  });
}

function recording(): void {
  it('is refused as an event, or recorded as the marker, never as the value', () => {
    const secret = held();
    const parsed = newEventSchema.safeParse({
      eventId: '00000000-0000-4000-8000-000000000001',
      harnessId: '00000000-0000-4000-8000-000000000002',
      itemId: null,
      name: 'connector_refused',
      actor: 'system',
      at: '2026-11-20T09:00:00.000Z',
      traceId: '00000000-0000-4000-8000-000000000003',
      evidence: { connector: 'send', reason: secret },
    });
    expect(leaks(JSON.stringify(parsed))).toBe(false);
  });

  it('is refused by every verb output schema that takes text', () => {
    const secret = held();
    const replies = Object.values(verbIo).flatMap(({ output }) => [
      JSON.stringify(output.safeParse(secret)),
      JSON.stringify(output.safeParse({ value: secret, pages: [secret], prompts: [secret] })),
    ]);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.some(leaks)).toBe(false);
  });

  it('renders the marker in a page and in a prompt', () => {
    const secret = held();
    const page = `<p>${passedOff<string>(secret)}</p>`;
    const prompt = ['Use this key:', passedOff<string>(secret)].join(' ');
    expect(page).toBe(`<p>${REDACTED}</p>`);
    expect(prompt).toBe(`Use this key: ${REDACTED}`);
  });
}

describe('#158 a secret hands its value to exposeSecret and to nothing else', () => {
  describe('rendered as text', rendering);
  describe('walked or logged', logging);
  describe('recorded, answered, paged or prompted', recording);
});

describe('#158 a spent secret is gone', () => {
  it('zeroes the bytes it held and refuses to expose them again', () => {
    const bytes = utf8(planted);
    const secret = secretOf(bytes);
    spendSecret(secret);
    expect([...bytes].every((byte) => byte === 0)).toBe(true);
    expect(() => exposeSecret(secret)).toThrow('secret_spent');
    expect(String(secret)).toBe(REDACTED);
  });

  it('refuses to expose a secret nothing was ever put in', () => {
    expect(() => exposeSecret(new Secret<string>())).toThrow('secret_spent');
  });

  it('refuses to expose bytes that are not text, without quoting them', () => {
    const secret = secretOf(new Uint8Array([0xff, 0xfe, 0x00, 0xc3]));
    expect(() => exposeSecret(secret)).toThrow('secret_not_text');
  });
});
