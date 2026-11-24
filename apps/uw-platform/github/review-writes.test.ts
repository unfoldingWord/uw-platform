import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createReviewWrites } from './review-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';

const head = 'a'.repeat(40);
const reviews = '/repos/unfoldingWord/uw-platform/pulls/7/reviews';
const review = { head, verdict: 'request_changes' as const, body: 'Changes requested.' };

let app: GitHubAppConfig;

beforeAll(async () => {
  app = { ...(await fixtureApp()), installationId: '88' };
});

describe("a Reviewer App's review writes", () => {
  it("HE-4 a Reviewer's review is posted on the head commit with its own App's token scoped to one repository", async () => {
    const github = fixtureGitHub();
    github.on('POST', reviews, { status: 200, body: { id: 9400000001 } });
    const writes = createReviewWrites(app, fixtureTransport(github));
    expect(await writes.post('unfoldingWord/uw-platform', 7, review)).toEqual({
      ok: true,
      value: { reviewId: 9400000001 },
    });
    const [mint, posted] = github.requests();
    expect(mint).toMatchObject({
      method: 'POST',
      path: '/app/installations/88/access_tokens',
      body: {
        repositories: ['uw-platform'],
        permissions: { pull_requests: 'write', metadata: 'read' },
      },
    });
    expect(posted).toMatchObject({
      method: 'POST',
      path: reviews,
      authorization: 'token ghs_fixture_1',
      body: { commit_id: head, event: 'REQUEST_CHANGES', body: 'Changes requested.' },
    });
  });

  it('refuses a head that is not a full SHA or a pull request number that is not a count, asking nothing', async () => {
    const github = fixtureGitHub();
    const writes = createReviewWrites(app, fixtureTransport(github));
    const refused = { ok: false, failure: 'unprocessable', status: null };
    expect(await writes.post('unfoldingWord/uw-platform', 7, { ...review, head: 'main' })).toEqual(
      refused,
    );
    expect(await writes.post('unfoldingWord/uw-platform', 0, review)).toEqual(refused);
    expect(github.requests()).toEqual([]);
  });

  it('answers the GitHub failure of a refused review', async () => {
    const github = fixtureGitHub();
    github.on('POST', reviews, { status: 422, body: { message: 'commit not in pull request' } });
    const writes = createReviewWrites(app, fixtureTransport(github));
    expect(await writes.post('unfoldingWord/uw-platform', 7, review)).toEqual({
      ok: false,
      failure: 'unprocessable',
      status: 422,
    });
  });
});
