import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { utf8 } from './base64.ts';
import { credentialsDepsOf } from './compose.ts';
import { openValue, sealValue } from './envelope.ts';
import { notConfiguredDataKeys } from './kms/not-configured.ts';
import { fakeKms, fakeKmsAccess, fakeKmsRegion } from './testing/fake-kms.ts';

const context = {
  credentialId: '00000000-0000-4000-8000-0000000158c1',
  versionId: '00000000-0000-4000-8000-0000000158c2',
  jdArea: '20-29',
};
const keyContext = {
  purpose: 'credential',
  credential_id: context.credentialId,
  version_id: context.versionId,
  jd_area: context.jdArea,
};
const db = createClient('postgres://unused@127.0.0.1:1/unused');
const now = new Date('2026-11-20T09:00:00.000Z');

function platform(fetcher: typeof fetch) {
  return {
    fetch: fetcher,
    timers: { after: () => new Promise<void>(() => undefined) },
    clock: { now: () => now },
    newId: () => '00000000-0000-4000-8000-0000000158c3',
  };
}

describe('#158 the credentials store is composed from the Worker settings', () => {
  it('seals and opens through KMS when the four settings are present', async () => {
    const kms = await fakeKms();
    const env = {
      CREDENTIALS_KMS_REGION: fakeKmsRegion,
      CREDENTIALS_KMS_KEY_ID: kms.keyArn,
      CREDENTIALS_KMS_ACCESS_KEY_ID: fakeKmsAccess.accessKeyId,
      CREDENTIALS_KMS_SECRET_ACCESS_KEY: fakeKmsAccess.secretAccessKey,
    };
    const deps = credentialsDepsOf(env, db, platform(kms.fetcher));
    const sealed = await sealValue(deps.keys, context, utf8('a value'));
    expect(sealed.ok).toBe(true);
    const opened = sealed.ok ? await openValue(deps.keys, context, sealed.sealed) : sealed;
    expect(opened.ok && new TextDecoder().decode(opened.plaintext)).toBe('a value');
    expect(kms.calls).toHaveLength(2);
    expect(deps.clock.now()).toEqual(now);
    expect(deps.db).toBe(db);
  });

  it.each([
    ['no setting at all', {}],
    ['a region and nothing else', { CREDENTIALS_KMS_REGION: fakeKmsRegion }],
    [
      'a signing pair and no key',
      {
        CREDENTIALS_KMS_REGION: fakeKmsRegion,
        CREDENTIALS_KMS_ACCESS_KEY_ID: fakeKmsAccess.accessKeyId,
        CREDENTIALS_KMS_SECRET_ACCESS_KEY: fakeKmsAccess.secretAccessKey,
      },
    ],
  ])('refuses key_service_not_configured with %s, and calls nothing', async (_name, env) => {
    const called: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      called.push(new Request(input).url);
      return new Response('{}');
    };
    const deps = credentialsDepsOf(env, db, platform(fetcher));
    const refusal = { ok: false, reason: 'key_service_not_configured' };
    expect(await sealValue(deps.keys, context, utf8('a value'))).toEqual(refusal);
    expect(await deps.keys.generate(keyContext)).toEqual(refusal);
    expect(await deps.keys.unwrap({ wrapped: 'AAAA', keyId: 'k' }, keyContext)).toEqual(refusal);
    expect(called).toEqual([]);
  });

  it('never throws from the adapter that is not configured', async () => {
    await expect(notConfiguredDataKeys.generate(keyContext)).resolves.toMatchObject({ ok: false });
    await expect(
      notConfiguredDataKeys.unwrap({ wrapped: '', keyId: '' }, keyContext),
    ).resolves.toMatchObject({ ok: false });
  });
});
