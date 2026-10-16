import type { z } from 'zod';
import { fileSchema } from '../payloads.ts';

type PatchFile = z.infer<typeof fileSchema>;

const hunkHeader = /^@@.*$/gmu;
const field = '\u0000';
const entry = '\u0001';

function entryOf(file: PatchFile): string | null {
  const body =
    file.patch !== undefined
      ? file.patch.replace(hunkHeader, '@@')
      : typeof file.sha === 'string' && file.sha !== ''
        ? `blob ${file.sha}`
        : null;
  if (body === null) return null;
  return [file.status ?? '', file.previous_filename ?? '', file.filename, body].join(field);
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function patchIdOf(files: readonly unknown[]): Promise<string | null> {
  const parsed = fileSchema.array().safeParse(files);
  if (!parsed.success) return null;
  const entries = parsed.data.map(entryOf);
  const known = entries.filter((one): one is string => one !== null);
  if (known.length !== entries.length) return null;
  const text = [...known].sort().join(entry);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
