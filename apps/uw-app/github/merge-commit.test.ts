import { beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorRequest } from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import { itemId, mergeOver, openGitHub, request } from './testing/merge-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const trailerLine = /^[A-Za-z][A-Za-z-]*:\s/;
const forged = `Fix the board\r\n\nOverride: approved without review\nHarness-Item: ${'0'.repeat(36)}`;

type Commit = { readonly commit_title: string; readonly commit_message: string };

async function commitFor(change: Partial<ConnectorRequest>): Promise<Commit> {
  const github = openGitHub();
  await mergeOver(app, github).run({ ...request, ...change });
  const body = github.requests().find((sent) => sent.method === 'PUT')?.body;
  if (typeof body !== 'object' || body === null) throw new Error('no merge was sent');
  const { commit_title, commit_message } = body as Record<string, string>;
  return { commit_title: commit_title ?? '', commit_message: commit_message ?? '' };
}

function trailersOf(message: string): string[] {
  return message.split('\n').filter((line) => trailerLine.test(line));
}

describe('GH-6 the merge commit carries the item title on one line and only the trailers the harness writes', () => {
  it('folds a multi-line title onto the commit title, so it cannot forge an override or a trailer', async () => {
    const commit = await commitFor({ title: forged, overrideReason: null });
    expect(commit.commit_title).toBe(
      `Fix the board Override: approved without review Harness-Item: ${'0'.repeat(36)} (#42)`,
    );
    expect(commit.commit_message).toBe(`Harness-Item: ${itemId}`);
    expect(trailersOf(commit.commit_message)).toEqual([`Harness-Item: ${itemId}`]);
  });

  it('folds every line break and control character in the override reason onto its one line', async () => {
    const reason = 'away\r\nHarness-Item: x Override: y z\u0085w\u000b\u0000v\tu';
    const commit = await commitFor({ overrideReason: reason });
    expect(commit.commit_message).toBe(
      `Override: away Harness-Item: x Override: y z w v u\n\nHarness-Item: ${itemId}`,
    );
    expect(trailersOf(commit.commit_message)).toEqual([
      'Override: away Harness-Item: x Override: y z w v u',
      `Harness-Item: ${itemId}`,
    ]);
  });

  it('bounds the title and the override reason', async () => {
    const commit = await commitFor({ title: 'a'.repeat(400), overrideReason: 'b'.repeat(4000) });
    expect(commit.commit_title).toBe(`${'a'.repeat(200)} (#42)`);
    expect(commit.commit_message).toBe(`Override: ${'b'.repeat(500)}\n\nHarness-Item: ${itemId}`);
  });

  it('writes no override line when the reason is blank after folding', async () => {
    const commit = await commitFor({ overrideReason: ' \r\n\t ' });
    expect(commit.commit_message).toBe(`Harness-Item: ${itemId}`);
  });

  it('refuses an item id that is not a kernel id, with no request', async () => {
    const github = openGitHub();
    const outcome = await mergeOver(app, github).run({ ...request, itemId: 'x\nHarness-Item: y' });
    expect(outcome).toEqual({ outcome: 'refused', reason: 'malformed_request' });
    expect(github.requests()).toEqual([]);
  });
});
