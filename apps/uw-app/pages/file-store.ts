import type { FilesBucket } from '../env.ts';

type StoredFile = { readonly bytes: Uint8Array; readonly contentType: string };

export type FileStore = {
  put(key: string, file: StoredFile): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  remove(key: string): Promise<void>;
};

const UNKNOWN_TYPE = 'application/octet-stream';

export function bucketFiles(bucket: FilesBucket): FileStore {
  return {
    put: async (key, file) => {
      await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.contentType } });
    },
    get: async (key) => {
      const found = await bucket.get(key);
      if (found === null) return null;
      return {
        bytes: new Uint8Array(await found.arrayBuffer()),
        contentType: found.httpMetadata?.contentType ?? UNKNOWN_TYPE,
      };
    },
    remove: async (key) => {
      await bucket.delete(key);
    },
  };
}

export function memoryFiles(): FileStore {
  const held = new Map<string, StoredFile>();
  return {
    put: async (key, file) => {
      held.set(key, { bytes: Uint8Array.from(file.bytes), contentType: file.contentType });
    },
    get: async (key) => held.get(key) ?? null,
    remove: async (key) => {
      held.delete(key);
    },
  };
}
