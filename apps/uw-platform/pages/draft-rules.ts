import { decodeSnapshot, equalSnapshots, snapshot, type Doc } from 'yjs';

export const AUTHORIZED_MS = 5 * 60 * 1000;

export type Admitted = { readonly until: number };

function bytesOf(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function savedEverything(doc: Doc, sent: string | null): boolean {
  const bytes = sent === null ? null : bytesOf(sent);
  if (bytes === null) return false;
  try {
    return equalSnapshots(snapshot(doc), decodeSnapshot(bytes));
  } catch {
    return false;
  }
}

export function admittedUntil(header: string | null, now: number): Admitted | null {
  const until = Number(header);
  if (!Number.isFinite(until) || until <= now) return null;
  return { until: Math.min(until, now + AUTHORIZED_MS) };
}

export function stillAdmitted(state: unknown, now: number): boolean {
  const until = (state as Partial<Admitted> | null)?.until;
  return typeof until === 'number' && until > now;
}
