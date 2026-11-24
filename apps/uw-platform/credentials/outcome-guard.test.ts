import { describe, expect, it } from 'vitest';
import { toBase64, utf8 } from './base64.ts';
import { outcomeCarries } from './outcome-guard.ts';

const value = 'uw-planted-credential-value-158-guard';
const bytes = utf8(value);
const encoded = toBase64(bytes);

function nested(depth: number, leaf: unknown): unknown {
  return depth === 0 ? leaf : { next: nested(depth - 1, leaf) };
}

describe('#158 the outcome of a credentialed call is searched for the value', () => {
  it.each([
    ['a succeeded outcome', { outcome: 'succeeded', detail: { status: '202', id: 'msg_1' } }],
    ['a refused outcome', { outcome: 'refused', reason: 'partner_refused' }],
    ['nothing', undefined],
    ['null', null],
    ['a number', 202],
    ['a flag', true],
    ['a list of texts', ['sent', 'queued']],
    ['part of the value', { echoed: value.slice(0, value.length - 1) }],
    ['a short nesting', nested(8, 'done')],
  ])('lets %s through', (_name, outcome) => {
    expect(outcomeCarries(outcome, bytes)).toBe(false);
  });

  it.each([
    ['the value itself', value],
    ['the value in a field', { detail: { echoed: value } }],
    ['the value inside a longer text', { reason: `refused: Bearer ${value}.` }],
    ['the value as a key', { [value]: true }],
    ['the value in a nested list', { seen: [[{ deep: [value] }]] }],
    ['the value in base64', { basic: encoded }],
    ['the value in unpadded base64', { basic: encoded.replaceAll('=', '') }],
    ['the value in URL-safe base64', encoded.replaceAll('+', '-').replaceAll('/', '_')],
    ['the bytes of the value', { raw: utf8(`x${value}x`) }],
  ])('finds %s', (_name, outcome) => {
    expect(outcomeCarries(outcome, bytes)).toBe(true);
  });

  it.each([
    ['a map', new Map([['echoed', value]])],
    ['a set', new Set([value])],
    ['an error', new Error(value)],
    ['a response', new Response(value)],
    ['a function', () => value],
    ['a nesting too deep to walk', nested(40, 'done')],
    ['a list too long to walk', Array.from({ length: 20_000 }, () => 'done')],
  ])('refuses %s, which it cannot search to the end', (_name, outcome) => {
    expect(outcomeCarries(outcome, bytes)).toBe(true);
  });

  it('refuses an outcome that holds itself', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(outcomeCarries(loop, bytes)).toBe(true);
  });
});
