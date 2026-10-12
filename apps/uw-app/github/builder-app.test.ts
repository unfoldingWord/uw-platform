import { describe, expect, it } from 'vitest';
import { builderAppOf, builderTokens } from './builder-app.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';

async function minting() {
  const github = fixtureGitHub();
  const app = await fixtureApp();
  const env = {
    BUILDER_GITHUB_APP_ID: app.appId,
    BUILDER_GITHUB_APP_INSTALLATION_ID: app.installationId,
    BUILDER_GITHUB_APP_PRIVATE_KEY: app.privateKey,
  };
  return { github, env, tokens: builderTokens(builderAppOf(env), fixtureTransport(github)) };
}

describe('the Builder GitHub App', () => {
  it('PE-5 the Builder token is scoped to one repository with contents and pull request write, and is not wired without its secrets', async () => {
    const { github, env, tokens } = await minting();
    const step = tokens('unfoldingWord/uw-platform');
    expect(await step()).toBe('ghs_fixture_1');
    expect(await step()).toBe('ghs_fixture_1');
    const minted = github.requests().filter((request) => request.method === 'POST');
    expect(minted.map((request) => [request.path, request.body])).toEqual([
      [
        '/app/installations/77/access_tokens',
        {
          repositories: ['uw-platform'],
          permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
        },
      ],
    ]);
    expect(await tokens('unfoldingWord/uw-platform')()).toBe('ghs_fixture_2');
    expect(await tokens('not a repository')()).toBeNull();
    expect(builderAppOf({ ...env, BUILDER_GITHUB_APP_PRIVATE_KEY: '' })).toBeNull();
    expect(builderAppOf({})).toBeNull();
    const unwired = builderTokens(null, fixtureTransport(github));
    expect(await unwired('unfoldingWord/uw-platform')()).toBeNull();
  });
});
