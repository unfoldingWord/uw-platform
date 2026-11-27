import { describe, expect, it } from 'vitest';
import { describeDirectMessagesNotWired } from '@uw/harness/port-contracts/direct-messages';
import type { Bindings } from '../env.ts';
import { directMessagesOf } from './direct-messages.ts';

const database = { db: null as never, ping: async () => undefined, release: async () => undefined };
const refuse = () => Promise.reject(new Error('no send'));
const key = JSON.stringify({
  client_email: 'assistants@uw-platform.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nunused\\n-----END PRIVATE KEY-----',
});
const email = {
  requestId: '00000000-0000-4000-8000-000000000011',
  effectId: '00000000-0000-4000-8000-000000000012',
  personId: '00000000-0000-4000-8000-000000000013',
  channel: 'email' as const,
  replyAddress: 'ana@example.org',
  threadKey: null,
  text: 'Done.',
  traceId: '00000000-0000-4000-8000-000000000014',
  sendBy: new Date('2100-01-01T00:00:00.000Z'),
};

describeDirectMessagesNotWired(
  'the uw-platform factory where no Zulip site is configured',
  directMessagesOf({ env: {}, database, fetch: refuse }),
);

describe('PA-6 the uw-platform direct messages factory', () => {
  it('wires the Zulip bot adapter once the Zulip site is configured', async () => {
    const env: Bindings = { ZULIP_SITE: 'https://chat.example.org' };
    const directMessages = directMessagesOf({ env, database, fetch: refuse });
    const late = {
      requestId: '00000000-0000-4000-8000-000000000001',
      effectId: '00000000-0000-4000-8000-000000000002',
      personId: '00000000-0000-4000-8000-000000000003',
      channel: 'zulip_dm' as const,
      replyAddress: 'zulip:5005',
      threadKey: null,
      text: 'Done.',
      traceId: '00000000-0000-4000-8000-000000000004',
      sendBy: new Date('2000-01-01T00:00:00.000Z'),
    };
    await expect(directMessages.send(late)).resolves.toEqual({ outcome: 'deadline_passed' });
  });

  it('leaves email replies not wired where no Workspace key is configured', async () => {
    const env: Bindings = { ZULIP_SITE: 'https://chat.example.org' };
    const directMessages = directMessagesOf({ env, database, fetch: refuse });
    await expect(directMessages.send(email)).rejects.toThrow(/not.wired|not_wired/i);
  });

  it('wires the Gmail adapter once the Workspace key and domain are configured', async () => {
    const env: Bindings = { GOOGLE_WORKSPACE_KEY: key, GOOGLE_WORKSPACE_DOMAIN: 'example.org' };
    const directMessages = directMessagesOf({ env, database, fetch: refuse });
    const late = { ...email, sendBy: new Date('2000-01-01T00:00:00.000Z') };
    await expect(directMessages.send(late)).resolves.toEqual({ outcome: 'deadline_passed' });
    await expect(directMessages.send({ ...late, channel: 'zulip_dm' })).rejects.toThrow(
      /not.wired|not_wired/i,
    );
  });
});
