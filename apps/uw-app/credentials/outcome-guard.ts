import { toBase64, utf8 } from './base64.ts';

const MAX_DEPTH = 12;
const MAX_NODES = 10_000;

type Walk = { readonly needles: readonly Uint8Array[]; nodes: number };

function startsAt(hay: Uint8Array, needle: Uint8Array, offset: number): boolean {
  return needle.every((byte, index) => hay[offset + index] === byte);
}

function within(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  for (let offset = 0; offset + needle.length <= hay.length; offset += 1) {
    if (startsAt(hay, needle, offset)) return true;
  }
  return false;
}

function textCarries(walk: Walk, text: string): boolean {
  const hay = utf8(text);
  return walk.needles.some((needle) => within(hay, needle));
}

function isPlain(node: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(node);
  return prototype === Object.prototype || prototype === null;
}

function carries(walk: Walk, node: unknown, depth: number): boolean {
  walk.nodes += 1;
  if (depth > MAX_DEPTH || walk.nodes > MAX_NODES) return true;
  if (typeof node === 'string') return textCarries(walk, node);
  if (node === null || typeof node !== 'object') return typeof node === 'function';
  if (node instanceof Uint8Array) return walk.needles.some((needle) => within(node, needle));
  if (Array.isArray(node)) return node.some((entry) => carries(walk, entry, depth + 1));
  if (!isPlain(node)) return true;
  return Object.entries(node).some(
    ([key, entry]) => textCarries(walk, key) || carries(walk, entry, depth + 1),
  );
}

export function outcomeCarries(outcome: unknown, value: Uint8Array<ArrayBuffer>): boolean {
  const encoded = toBase64(value);
  const unpadded = encoded.replaceAll('=', '');
  const urlSafe = unpadded.replaceAll('+', '-').replaceAll('/', '_');
  const needles = [value, utf8(unpadded), utf8(urlSafe)];
  return carries({ needles, nodes: 0 }, outcome, 0);
}
