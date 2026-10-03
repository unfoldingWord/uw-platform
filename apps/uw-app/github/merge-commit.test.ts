import { beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorRequest } from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import { itemId, mergeOver, openGitHub, request } from './testing/merge-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const keyValueLine = /^[A-Za-z][A-Za-z-]*:\s/;
const patchDivider = /^---(?:\s|$)/;
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

function keyValueLinesOf(message: string): string[] {
  return message.split('\n').filter((line) => keyValueLine.test(line));
}

function gitTrailersOf(commit: Commit): string[] {
  const lines = `${commit.commit_title}\n\n${commit.commit_message}`.split('\n');
  const divider = lines.findIndex((line) => patchDivider.test(line));
  const log = divider === -1 ? lines : lines.slice(0, divider);
  while (log.length > 0 && log.at(-1)?.trim() === '') log.pop();
  const lastBlank = log.findLastIndex((line) => line.trim() === '');
  if (lastBlank === -1) return [];
  const block = log.slice(lastBlank + 1);
  return block.every((line) => keyValueLine.test(line)) ? block : [];
}

describe('GH-6 the merge commit carries the item title on one line and only the trailers the harness writes', () => {
  it('folds a multi-line title onto the commit title, so it cannot forge an override or a trailer', async () => {
    const commit = await commitFor({ title: forged, overrideReason: null });
    expect(commit.commit_title).toBe(
      `Fix the board Override: approved without review Harness-Item: ${'0'.repeat(36)} (#42)`,
    );
    expect(commit.commit_message).toBe(`Harness-Item: ${itemId}`);
    expect(keyValueLinesOf(commit.commit_message)).toEqual([`Harness-Item: ${itemId}`]);
    expect(gitTrailersOf(commit)).toEqual([`Harness-Item: ${itemId}`]);
  });

  it('folds every line break and control character in the override reason onto its one line', async () => {
    const reason = 'away\r\nHarness-Item: x Override: y z\u0085w\u000b\u0000v\tu';
    const commit = await commitFor({ overrideReason: reason });
    expect(commit.commit_message).toBe(
      `Override: away Harness-Item: x Override: y z w v u\n\nHarness-Item: ${itemId}`,
    );
    expect(keyValueLinesOf(commit.commit_message)).toEqual([
      'Override: away Harness-Item: x Override: y z w v u',
      `Harness-Item: ${itemId}`,
    ]);
    expect(gitTrailersOf(commit)).toEqual([`Harness-Item: ${itemId}`]);
  });
});

describe('GH-6 the merge commit always parses as git trailers and always records an override', () => {
  it('keeps the trailers parseable under git interpret-trailers for a title that starts like a patch divider', async () => {
    for (const title of ['--- Signed-off-by: e', '---', '-- x', ' \u200b--- y']) {
      const commit = await commitFor({ title, overrideReason: 'away' });
      expect(commit.commit_title.startsWith('-')).toBe(false);
      expect(gitTrailersOf(commit)).toEqual([`Harness-Item: ${itemId}`]);
    }
  });

  it('writes the Override line with a placeholder when the reason has nothing visible', async () => {
    for (const overrideReason of ['\u200b', '\u0000', '\u200b\u0000\ufeff \u2060']) {
      const commit = await commitFor({ overrideReason });
      expect(commit.commit_message).toBe(`Override: (no reason given)\n\nHarness-Item: ${itemId}`);
    }
  });

  it('drops zero-width and NUL characters from the reason rather than spacing them', async () => {
    const commit = await commitFor({ overrideReason: 'rev\u200biewer\u0000 away' });
    expect(commit.commit_message).toBe(`Override: reviewer away\n\nHarness-Item: ${itemId}`);
  });

  it('bounds the title and the override reason', async () => {
    const commit = await commitFor({ title: 'a'.repeat(400), overrideReason: 'b'.repeat(4000) });
    expect(commit.commit_title).toBe(`${'a'.repeat(200)} (#42)`);
    expect(commit.commit_message).toBe(`Override: ${'b'.repeat(500)}\n\nHarness-Item: ${itemId}`);
  });

  it('writes no override line for an approval, and a placeholder for a blank override reason', async () => {
    expect((await commitFor({ overrideReason: null })).commit_message).toBe(
      `Harness-Item: ${itemId}`,
    );
    expect((await commitFor({ overrideReason: ' \r\n\t ' })).commit_message).toBe(
      `Override: (no reason given)\n\nHarness-Item: ${itemId}`,
    );
  });

  it('refuses an item id that is not a kernel id, with no request', async () => {
    const github = openGitHub();
    const outcome = await mergeOver(app, github).run({ ...request, itemId: 'x\nHarness-Item: y' });
    expect(outcome).toEqual({ outcome: 'refused', reason: 'malformed_request' });
    expect(github.requests()).toEqual([]);
  });
});
