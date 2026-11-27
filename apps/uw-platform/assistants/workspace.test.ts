import { describe, expect, it } from 'vitest';
import { describeWorkspaceNotWired } from '@uw/harness/port-contracts/workspace';
import type { Bindings } from '../env.ts';
import { workspaceNotWired } from '../ports/workspace.not-wired.ts';
import { workspaceConfigOf } from './google/config.ts';
import { workspaceOf } from './workspace.ts';

const database = { db: null as never, ping: async () => undefined, release: async () => undefined };
const refuse = () => Promise.reject(new Error('no call'));
const key = JSON.stringify({
  client_email: 'assistants@uw-platform.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});

describeWorkspaceNotWired(
  'the uw-platform factory where no Workspace key is configured',
  workspaceOf({ env: { GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org' }, database, fetch: refuse }),
);

describe('PA-8 the uw-platform workspace factory', () => {
  it('wires the Google adapter once the key and the domain are configured', () => {
    const env: Bindings = {
      GOOGLE_WORKSPACE_KEY: key,
      GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org',
    };
    expect(workspaceOf({ env, database, fetch: refuse })).not.toBe(workspaceNotWired);
    expect(workspaceOf({ env: { GOOGLE_WORKSPACE_KEY: key }, database, fetch: refuse })).toBe(
      workspaceNotWired,
    );
  });

  it('keeps an admin subject only when it is inside the domain', () => {
    const inside = workspaceConfigOf({
      GOOGLE_WORKSPACE_KEY: key,
      GOOGLE_WORKSPACE_DOMAIN: 'UnfoldingWord.org',
      GOOGLE_WORKSPACE_ADMIN_SUBJECT: 'Platform-Admin@unfoldingword.org',
    });
    expect(inside?.domain).toBe('unfoldingword.org');
    expect(inside?.adminSubject).toBe('platform-admin@unfoldingword.org');
    const outside = workspaceConfigOf({
      GOOGLE_WORKSPACE_KEY: key,
      GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org',
      GOOGLE_WORKSPACE_ADMIN_SUBJECT: 'admin@elsewhere.example',
    });
    expect(outside?.adminSubject).toBeNull();
    expect(
      workspaceConfigOf({ GOOGLE_WORKSPACE_KEY: key, GOOGLE_WORKSPACE_DOMAIN: 'not a domain' }),
    ).toBeNull();
  });
});
