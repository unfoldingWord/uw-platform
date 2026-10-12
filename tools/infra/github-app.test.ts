import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import manifest from '../../infra/github/app-manifest.json' with { type: 'json' };
import { reviewerIdentities } from '../../packages/harness/github/reviewers.ts';

const secrets = [
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
];

const wranglerFiles = readdirSync('infra', { recursive: true, encoding: 'utf8' })
  .filter((file) => /wrangler[^/]*\.toml$/.test(file))
  .map((file) => join('infra', file));

function declaredVars(config: Record<string, unknown>): string[] {
  const envs = Object.values((config['env'] ?? {}) as Record<string, Record<string, unknown>>);
  return [config, ...envs].flatMap((block) =>
    Object.keys((block['vars'] ?? {}) as Record<string, unknown>),
  );
}

const secretText = /PRIVATE KEY|ghs_|ghp_|eyJ|"(?:secret|token|key|pem|client_secret)"/i;

describe('GH-1 the GitHub App is declared with least privilege', () => {
  it('asks for exactly the permissions the harness uses', () => {
    expect(manifest.default_permissions).toEqual({
      metadata: 'read',
      issues: 'write',
      pull_requests: 'read',
      checks: 'read',
      contents: 'write',
    });
  });

  it('subscribes to exactly the five events', () => {
    expect(new Set(manifest.default_events)).toEqual(
      new Set(['issues', 'pull_request', 'pull_request_review', 'check_run', 'push']),
    );
    expect(manifest.default_events).toHaveLength(5);
  });

  it('points its webhook at the route uw-ingest serves and is private', () => {
    expect(manifest.hook_attributes.url).toBe(
      'https://uw-ingest-staging.unfoldingword.workers.dev/webhooks/github',
    );
    expect(manifest.public).toBe(false);
  });

  it('holds no key, secret or token text', () => {
    expect(secretText.test(readFileSync('infra/github/app-manifest.json', 'utf8'))).toBe(false);
  });

  it('finds the wrangler files', () => {
    expect(wranglerFiles.length).toBeGreaterThan(0);
  });

  it.each(wranglerFiles)('%s sets no GitHub secret as a var', (file) => {
    const vars = declaredVars(parse(readFileSync(file, 'utf8')));
    expect(vars.filter((name) => secrets.includes(name))).toEqual([]);
  });

  it('names the four wrangler secret put commands in the infra README', () => {
    const readme = readFileSync('infra/README.md', 'utf8');
    for (const name of secrets) {
      expect(readme).toContain(`wrangler secret put ${name} --env <name>`);
    }
  });
});

const reviewerManifests = [
  ['infra/github/reviewer-app-manifest.json', 'uw-reviewer'],
  ['infra/github/reviewer-codex-app-manifest.json', 'uw-reviewer-codex'],
] as const;

type ReviewerManifest = {
  readonly name: string;
  readonly public: boolean;
  readonly default_permissions: Record<string, string>;
  readonly default_events: readonly string[];
  readonly hook_attributes?: unknown;
};

describe('HE-4 HE-9 each Reviewer identity is its own App with pull request write and nothing else', () => {
  it.each(reviewerManifests)('%s registers %s', (file, slug) => {
    const declared = JSON.parse(readFileSync(file, 'utf8')) as ReviewerManifest;
    expect(declared.name).toBe(slug);
    expect(reviewerIdentities.map((entry) => entry.reviewer)).toContain(slug);
    expect(declared.default_permissions).toEqual({ metadata: 'read', pull_requests: 'write' });
    expect(declared.default_events).toEqual([]);
    expect(declared.hook_attributes).toBeUndefined();
    expect(declared.public).toBe(false);
    expect(secretText.test(readFileSync(file, 'utf8'))).toBe(false);
  });
});
