export const REDACTED = '[secret]';

const held = new WeakMap<object, Uint8Array<ArrayBuffer>>();
const inspect = Symbol.for('nodejs.util.inspect.custom');

declare const holds: unique symbol;

export class Secret<T> {
  declare readonly [holds]: T;

  constructor() {
    Object.freeze(this);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [inspect](): string {
    return REDACTED;
  }
}

export function secretOf(value: Uint8Array<ArrayBuffer>): Secret<string> {
  const secret = new Secret<string>();
  held.set(secret, value);
  return secret;
}

export function exposeSecret(secret: Secret<string>): string {
  const value = held.get(secret);
  if (value === undefined) throw new TypeError('secret_spent');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    throw new TypeError('secret_not_text');
  }
}

export function spendSecret(secret: Secret<string>): void {
  held.get(secret)?.fill(0);
  held.delete(secret);
}
