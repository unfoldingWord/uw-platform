import type { Principal } from '@uw/core/principal';

export type Provenance = {
  readonly source: string;
  readonly reference: string;
  readonly filters: readonly string[];
  readonly exportedBy: string;
  readonly exportedOn: string;
  readonly sourceSha256: string;
  readonly withheld: boolean;
};

export type VersionSnapshot = {
  readonly pageId: string;
  readonly version: number;
  readonly slug: string;
  readonly title: string;
  readonly frontmatter: unknown;
  readonly bodyMd: string;
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(([, field]) => field !== undefined);
  entries.sort(([left], [right]) => (left < right ? -1 : 1));
  return Object.fromEntries(entries.map(([key, field]) => [key, sorted(field)]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest('SHA-256', bufferOf(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function pageVersionHash(snapshot: VersionSnapshot): Promise<string> {
  const { pageId, version, slug, title, frontmatter, bodyMd } = snapshot;
  return sha256Hex(canonicalJson({ pageId, version, slug, title, frontmatter, bodyMd }));
}

export function exporterOf(actor: Principal): string {
  return actor.email ?? actor.identity;
}
