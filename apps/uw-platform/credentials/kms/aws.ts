import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import type { DataKeyRefusal } from '@uw/core/credentials';
import type { Timers } from '../../timers.ts';
import { fromBase64 } from '../base64.ts';
import {
  DATA_KEY_BYTES,
  keyRefusal,
  type DataKeyOutcome,
  type DataKeys,
  type KeyContext,
} from '../data-keys.ts';

const CALL_TIMEOUT_MS = 5_000;

export type KmsConfig = {
  readonly region: string;
  readonly keyId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

const generatedSchema = z.object({
  CiphertextBlob: z.string().min(1),
  Plaintext: z.string().min(1),
  KeyId: z.string().min(1),
});
const decryptedSchema = z.object({ Plaintext: z.string().min(1) });
const failureSchema = z.object({ __type: z.string() });

const rejected: ReadonlySet<string> = new Set([
  'InvalidCiphertextException',
  'IncorrectKeyException',
]);
const unavailable: ReadonlySet<string> = new Set([
  'ThrottlingException',
  'KMSInternalException',
  'DependencyTimeoutException',
  'KeyUnavailableException',
  'LimitExceededException',
  'ServiceUnavailableException',
  'InternalFailure',
]);

type Answer = DataKeyOutcome<unknown>;

function reasonOf(status: number, body: unknown): DataKeyRefusal {
  if (status >= 500) return 'key_service_unavailable';
  const parsed = failureSchema.safeParse(body);
  if (!parsed.success) return 'key_service_unavailable';
  const type = parsed.data.__type.split('#').at(-1) ?? '';
  if (rejected.has(type)) return 'key_rejected';
  return unavailable.has(type) ? 'key_service_unavailable' : 'key_service_refused';
}

async function answerOf(response: Response): Promise<Answer> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 200 && body !== null) return { ok: true, value: body };
  return keyRefusal(reasonOf(response.status, body));
}

async function bounded(
  work: (signal: AbortSignal) => Promise<Answer>,
  timers: Timers,
): Promise<Answer> {
  const stop = new AbortController();
  try {
    const expiry = timers
      .after(CALL_TIMEOUT_MS, stop.signal)
      .then(() => keyRefusal('key_service_unavailable'));
    return await Promise.race([work(stop.signal), expiry]);
  } catch {
    return keyRefusal('key_service_unavailable');
  } finally {
    stop.abort();
  }
}

type Call = (operation: 'GenerateDataKey' | 'Decrypt', input: object) => Promise<Answer>;

function caller(config: KmsConfig, fetcher: typeof fetch, timers: Timers): Call {
  const signer = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 'kms',
    region: config.region,
  });
  const endpoint = `https://kms.${config.region}.amazonaws.com/`;
  return (operation, input) =>
    bounded(async (signal) => {
      const signed = await signer.sign(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `TrentService.${operation}`,
        },
        body: JSON.stringify(input),
      });
      return answerOf(await fetcher(signed, { signal }));
    }, timers);
}

function keyBytes(encoded: string): Uint8Array<ArrayBuffer> | null {
  const bytes = fromBase64(encoded);
  return bytes !== null && bytes.length === DATA_KEY_BYTES ? bytes : null;
}

async function generate(call: Call, keyId: string, context: KeyContext) {
  const answer = await call('GenerateDataKey', {
    KeyId: keyId,
    KeySpec: 'AES_256',
    EncryptionContext: context,
  });
  if (!answer.ok) return answer;
  const parsed = generatedSchema.safeParse(answer.value);
  const plaintext = parsed.success ? keyBytes(parsed.data.Plaintext) : null;
  if (!parsed.success || plaintext === null) return keyRefusal('key_service_unavailable');
  const { CiphertextBlob: wrapped, KeyId: wrappedBy } = parsed.data;
  return { ok: true as const, value: { plaintext, wrapped, keyId: wrappedBy } };
}

async function unwrap(call: Call, key: { wrapped: string; keyId: string }, context: KeyContext) {
  if (fromBase64(key.wrapped) === null) return keyRefusal('key_rejected');
  const answer = await call('Decrypt', {
    KeyId: key.keyId,
    CiphertextBlob: key.wrapped,
    EncryptionContext: context,
  });
  if (!answer.ok) return answer;
  const parsed = decryptedSchema.safeParse(answer.value);
  const plaintext = parsed.success ? keyBytes(parsed.data.Plaintext) : null;
  if (plaintext === null) return keyRefusal('key_service_unavailable');
  return { ok: true as const, value: plaintext };
}

export function awsKmsDataKeys(config: KmsConfig, fetcher: typeof fetch, timers: Timers): DataKeys {
  const call = caller(config, fetcher, timers);
  return {
    generate: (context) => generate(call, config.keyId, context),
    unwrap: (key, context) => unwrap(call, key, context),
  };
}
