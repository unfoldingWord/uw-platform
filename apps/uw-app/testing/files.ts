import type { FilesBucket } from '../env.ts';

type Held = { readonly bytes: Uint8Array; readonly contentType: string | undefined };

export function memoryBucket(): FilesBucket {
  const held = new Map<string, Held>();
  return {
    put: async (key, value, options) => {
      held.set(key, {
        bytes: Uint8Array.from(value),
        contentType: options?.httpMetadata?.contentType,
      });
    },
    get: async (key) => {
      const found = held.get(key);
      if (found === undefined) return null;
      const buffer = new ArrayBuffer(found.bytes.byteLength);
      new Uint8Array(buffer).set(found.bytes);
      return {
        arrayBuffer: async () => buffer,
        httpMetadata: found.contentType === undefined ? {} : { contentType: found.contentType },
      };
    },
    delete: async (key) => {
      held.delete(key);
    },
  };
}
