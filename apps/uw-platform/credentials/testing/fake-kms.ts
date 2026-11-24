import { z } from 'zod';
import type { KeyContext } from '../data-keys.ts';
import { fromBase64, toBase64 } from '../base64.ts';
import { memoryDataKeys } from './memory-data-keys.ts';

export const fakeKmsRegion = 'us-east-1';
export const fakeKmsAlias = 'alias/uw-credentials-test';
export const fakeKmsAccess = {
  accessKeyId: 'AKIDFAKEFORTESTS',
  secretAccessKey: 'fake-signing-secret-for-tests-only',
} as const;

type FakeKmsFailure = 'network' | 'server_error' | 'not_json' | (string & {});

type RecordedCall = {
  readonly url: string;
  readonly method: string;
  readonly target: string;
  readonly contentType: string;
  readonly authorization: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly text: string;
};

export type FakeKms = {
  readonly fetcher: typeof fetch;
  readonly keyArn: string;
  readonly calls: readonly RecordedCall[];
  failNext(failure: FakeKmsFailure): void;
};

const contextSchema = z.record(z.string(), z.string());
const generateSchema = z.object({
  KeyId: z.string(),
  KeySpec: z.literal('AES_256'),
  EncryptionContext: contextSchema,
});
const decryptSchema = z.object({
  KeyId: z.string(),
  CiphertextBlob: z.string(),
  EncryptionContext: contextSchema,
});

function failure(type: string, status = 400): Response {
  return Response.json({ __type: type, message: `fake KMS answered ${type}` }, { status });
}

async function recorded(request: Request): Promise<RecordedCall> {
  const text = await request.text();
  return {
    url: request.url,
    method: request.method,
    target: request.headers.get('x-amz-target') ?? '',
    contentType: request.headers.get('content-type') ?? '',
    authorization: request.headers.get('authorization') ?? '',
    body: z.record(z.string(), z.unknown()).parse(JSON.parse(text)),
    text,
  };
}

type Service = {
  generate(keyId: string, context: KeyContext): Promise<Response>;
  decrypt(keyId: string, blob: string, context: KeyContext): Promise<Response>;
};

async function service(keyArn: string): Promise<Service> {
  const keys = await memoryDataKeys(keyArn);
  return {
    generate: async (keyId, context) => {
      if (keyId !== fakeKmsAlias && keyId !== keyArn) return failure('NotFoundException');
      const outcome = await keys.generate(context);
      if (!outcome.ok) return failure('KMSInternalException', 500);
      const { plaintext, wrapped } = outcome.value;
      return Response.json({
        CiphertextBlob: wrapped,
        Plaintext: toBase64(plaintext),
        KeyId: keyArn,
      });
    },
    decrypt: async (keyId, blob, context) => {
      if (keyId !== keyArn) return failure('NotFoundException');
      if (fromBase64(blob) === null) return failure('SerializationException');
      const outcome = await keys.unwrap({ wrapped: blob, keyId: keyArn }, context);
      if (!outcome.ok) return failure('InvalidCiphertextException');
      return Response.json({ Plaintext: toBase64(outcome.value), KeyId: keyArn });
    },
  };
}

function answered(kms: Service, call: RecordedCall): Promise<Response> {
  if (call.target === 'TrentService.GenerateDataKey') {
    const input = generateSchema.parse(call.body);
    return kms.generate(input.KeyId, input.EncryptionContext);
  }
  if (call.target === 'TrentService.Decrypt') {
    const input = decryptSchema.parse(call.body);
    return kms.decrypt(input.KeyId, input.CiphertextBlob, input.EncryptionContext);
  }
  return Promise.resolve(failure('UnknownOperationException'));
}

function failed(mode: FakeKmsFailure): Promise<Response> {
  if (mode === 'network') return Promise.reject(new TypeError('fetch failed'));
  if (mode === 'server_error') return Promise.resolve(failure('KMSInternalException', 500));
  if (mode === 'not_json') return Promise.resolve(new Response('502 Bad Gateway'));
  return Promise.resolve(failure(mode));
}

export async function fakeKms(): Promise<FakeKms> {
  const keyArn = `arn:aws:kms:${fakeKmsRegion}:000000000000:key/${crypto.randomUUID()}`;
  const kms = await service(keyArn);
  const calls: RecordedCall[] = [];
  let failing: FakeKmsFailure | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    const call = await recorded(new Request(input, init));
    calls.push(call);
    const mode = failing;
    failing = null;
    return mode === null ? answered(kms, call) : failed(mode);
  };
  return {
    fetcher,
    keyArn,
    calls,
    failNext: (mode) => {
      failing = mode;
    },
  };
}
