import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createShipWrites } from './ship-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';

const sha = 'a'.repeat(40);
const existing = '/repos/o/r/git/ref/tags/harness/x';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

async function tagOver(existingSha: string | null, type = 'commit') {
  const github = fixtureGitHub();
  github.on('POST', '/repos/o/r/git/refs', { status: 422, body: { message: 'exists' } });
  if (existingSha) {
    github.on('GET', existing, {
      status: 200,
      body: { ref: 'refs/tags/harness/x', object: { sha: existingSha, type } },
    });
  }
  return createShipWrites(app, fixtureTransport(github)).tag('o/r', 'harness/x', sha);
}

describe('the merge tag is idempotent on its sha', () => {
  it('answers created false when the tag already points at the sha', async () => {
    expect(await tagOver(sha)).toEqual({ ok: true, value: { created: false } });
  });

  it('answers conflict when the tag points at another sha', async () => {
    expect(await tagOver('b'.repeat(40))).toEqual({ ok: false, failure: 'conflict', status: 422 });
  });

  it('answers conflict for an annotated tag of the name, since the harness creates only lightweight tags', async () => {
    expect(await tagOver(sha, 'tag')).toEqual({ ok: false, failure: 'conflict', status: 422 });
  });

  it('answers the failure of reading the existing tag', async () => {
    expect(await tagOver(null)).toEqual({ ok: false, failure: 'not_found', status: 404 });
  });

  it('mints one token for the merge and the tag of one connector run', async () => {
    const github = fixtureGitHub();
    github.on('PUT', '/repos/o/r/pulls/2/merge', { status: 200, body: { sha: 'c'.repeat(40) } });
    github.on('POST', '/repos/o/r/git/refs', { status: 201, body: {} });
    const writes = createShipWrites(app, fixtureTransport(github));
    await writes.merge('o/r', 2, { sha, title: 't', message: 'm' });
    await writes.tag('o/r', 'harness/x', 'c'.repeat(40));
    expect(github.requests().map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /app/installations/77/access_tokens',
      'PUT /repos/o/r/pulls/2/merge',
      'POST /repos/o/r/git/refs',
    ]);
  });

  it.each(['harness/../x', 'harness//x', '.hidden', 'harness/x?y', ''])(
    'refuses the tag name %j without a request',
    async (name) => {
      const github = fixtureGitHub();
      expect(await createShipWrites(app, fixtureTransport(github)).tag('o/r', name, sha)).toEqual({
        ok: false,
        failure: 'unprocessable',
        status: null,
      });
      expect(github.requests()).toEqual([]);
    },
  );
});
