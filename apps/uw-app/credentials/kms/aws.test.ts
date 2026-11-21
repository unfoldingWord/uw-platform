import { describe, expect, it } from 'vitest';
import { systemTimers, type Timers } from '../../timers.ts';
import type { DataKey, KeyContext } from '../data-keys.ts';
import { describeDataKeysContract } from '../testing/data-keys-contract.ts';
import {
  fakeKms,
  fakeKmsAccess,
  fakeKmsAlias,
  fakeKmsRegion,
  type FakeKms,
} from '../testing/fake-kms.ts';
import { awsKmsDataKeys, type KmsConfig } from './aws.ts';

const config: KmsConfig = { region: fakeKmsRegion, keyId: fakeKmsAlias, ...fakeKmsAccess };
const context: KeyContext = { purpose: 'credential', credential_id: 'c-1', jd_area: '20-29' };

describeDataKeysContract('the AWS KMS adapter, against a fake KMS', async () => {
  const kms = await fakeKms();
  return {
    keys: awsKmsDataKeys(config, kms.fetcher, systemTimers),
    loseTheService: () => kms.failNext('network'),
  };
});

async function generated(kms: FakeKms): Promise<DataKey> {
  const outcome = await awsKmsDataKeys(config, kms.fetcher, systemTimers).generate(context);
  if (!outcome.ok) throw new Error(`generate was refused: ${outcome.reason}`);
  return outcome.value;
}

describe('#157 the AWS KMS adapter speaks the KMS JSON protocol, signed', () => {
  it('asks GenerateDataKey for an AES-256 key under the configured key and the context', async () => {
    const kms = await fakeKms();
    const key = await generated(kms);
    expect(kms.calls).toHaveLength(1);
    expect(kms.calls[0]).toMatchObject({
      url: 'https://kms.us-east-1.amazonaws.com/',
      method: 'POST',
      target: 'TrentService.GenerateDataKey',
      contentType: 'application/x-amz-json-1.1',
      body: { KeyId: fakeKmsAlias, KeySpec: 'AES_256', EncryptionContext: context },
    });
    expect(key.keyId).toBe(kms.keyArn);
  });

  it('asks Decrypt with the key that wrapped it pinned, and the context', async () => {
    const kms = await fakeKms();
    const key = await generated(kms);
    const keys = awsKmsDataKeys(config, kms.fetcher, systemTimers);
    await keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, context);
    expect(kms.calls[1]).toMatchObject({
      target: 'TrentService.Decrypt',
      body: { KeyId: kms.keyArn, CiphertextBlob: key.wrapped, EncryptionContext: context },
    });
  });

  it('signs each request with SigV4 for the kms service in the region, and never sends the secret', async () => {
    const kms = await fakeKms();
    await generated(kms);
    const call = kms.calls[0];
    expect(call?.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDFAKEFORTESTS\/\d{8}\/us-east-1\/kms\/aws4_request, SignedHeaders=[a-z0-9;-]*host[a-z0-9;-]*x-amz-target[a-z0-9;-]*, Signature=[0-9a-f]{64}$/,
    );
    expect(`${call?.authorization} ${call?.text} ${call?.url}`).not.toContain(
      fakeKmsAccess.secretAccessKey,
    );
  });
});

describe('#157 a KMS failure becomes a closed-set reason', () => {
  it.each([
    ['ThrottlingException', 'key_service_unavailable'],
    ['KMSInternalException', 'key_service_unavailable'],
    ['DependencyTimeoutException', 'key_service_unavailable'],
    ['KeyUnavailableException', 'key_service_unavailable'],
    ['server_error', 'key_service_unavailable'],
    ['not_json', 'key_service_unavailable'],
    ['network', 'key_service_unavailable'],
    ['AccessDeniedException', 'key_service_refused'],
    ['DisabledException', 'key_service_refused'],
    ['KMSInvalidStateException', 'key_service_refused'],
    ['NotFoundException', 'key_service_refused'],
    ['UnrecognizedClientException', 'key_service_refused'],
    ['com.amazonaws.kms#InvalidCiphertextException', 'key_rejected'],
    ['IncorrectKeyException', 'key_rejected'],
  ])('%s is %s, from generate and from unwrap', async (failure, reason) => {
    const kms = await fakeKms();
    const key = await generated(kms);
    const keys = awsKmsDataKeys(config, kms.fetcher, systemTimers);
    kms.failNext(failure);
    expect(await keys.generate(context)).toEqual({ ok: false, reason });
    kms.failNext(failure);
    expect(await keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, context)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe('#157 a KMS answer that cannot be trusted is refused', () => {
  it('gives up after its deadline and answers key_service_unavailable', async () => {
    const never: typeof fetch = () => new Promise<Response>(() => undefined);
    const expired: Timers = { after: () => Promise.resolve() };
    const keys = awsKmsDataKeys(config, never, expired);
    expect(await keys.generate(context)).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
  });

  it('answers key_service_unavailable when KMS hands back a key that is not 256 bits', async () => {
    const short: typeof fetch = () =>
      Promise.resolve(Response.json({ CiphertextBlob: 'AAAA', Plaintext: 'AAAA', KeyId: 'k' }));
    const keys = awsKmsDataKeys(config, short, systemTimers);
    expect(await keys.generate(context)).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
  });

  it('refuses a wrapped key that is not base64 without asking KMS', async () => {
    const kms = await fakeKms();
    const keys = awsKmsDataKeys(config, kms.fetcher, systemTimers);
    expect(await keys.unwrap({ wrapped: 'not base64', keyId: kms.keyArn }, context)).toEqual({
      ok: false,
      reason: 'key_rejected',
    });
    expect(kms.calls).toHaveLength(0);
  });
});
