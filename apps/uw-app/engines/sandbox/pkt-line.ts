export type RefUpdate = { readonly old: string; readonly new: string; readonly ref: string };

const FLUSH = 0;
const HEADER = 4;
const lengthHex = /^[0-9a-f]{4}$/;
const command = /^([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/\S+)$/;
const decoder = new TextDecoder();

function lengthAt(bytes: Uint8Array, at: number): number | null {
  if (at + HEADER > bytes.length) return null;
  const header = String.fromCharCode(...bytes.subarray(at, at + HEADER));
  return lengthHex.test(header) ? Number.parseInt(header, 16) : null;
}

function updateOf(payload: Uint8Array): RefUpdate | null {
  const text = decoder.decode(payload);
  const [line = ''] = text.replace(/\n$/, '').split('\0');
  const match = command.exec(line);
  if (match === null) return null;
  const [, old = '', next = '', ref = ''] = match;
  return { old, new: next, ref };
}

export function parseRefUpdates(bytes: Uint8Array): readonly RefUpdate[] | null {
  const updates: RefUpdate[] = [];
  let at = 0;
  while (true) {
    const length = lengthAt(bytes, at);
    if (length === null) return null;
    if (length === FLUSH) return updates;
    if (length <= HEADER || at + length > bytes.length) return null;
    const update = updateOf(bytes.subarray(at + HEADER, at + length));
    if (update === null) return null;
    updates.push(update);
    at += length;
  }
}
