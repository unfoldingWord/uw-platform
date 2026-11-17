import { readFileSync } from 'node:fs';

export type DeployEnv = 'staging' | 'production';

export type GitHubAppTarget = {
  readonly manifest: string;
  readonly slug: string;
  readonly prefix: string;
  readonly envs: readonly DeployEnv[];
  readonly webhook: boolean;
};

export const githubApps: readonly GitHubAppTarget[] = [
  {
    manifest: 'infra/github/app-manifest.json',
    slug: 'uw-harness-staging',
    prefix: 'GITHUB_APP',
    envs: ['staging'],
    webhook: true,
  },
  {
    manifest: 'infra/github/app-manifest.production.json',
    slug: 'uw-harness',
    prefix: 'GITHUB_APP',
    envs: ['production'],
    webhook: true,
  },
  {
    manifest: 'infra/github/builder-app-manifest.json',
    slug: 'uw-builder',
    prefix: 'BUILDER_GITHUB_APP',
    envs: ['staging', 'production'],
    webhook: false,
  },
  {
    manifest: 'infra/github/reviewer-app-manifest.json',
    slug: 'uw-reviewer',
    prefix: 'REVIEWER_GITHUB_APP',
    envs: ['staging', 'production'],
    webhook: false,
  },
  {
    manifest: 'infra/github/reviewer-codex-app-manifest.json',
    slug: 'uw-reviewer-codex',
    prefix: 'REVIEWER_CODEX_GITHUB_APP',
    envs: ['staging', 'production'],
    webhook: false,
  },
];

export const ORG = 'unfoldingWord';
export const REDIRECT_URL = 'https://github.com/unfoldingWord/uw-platform';

export function manifestOf(target: GitHubAppTarget): Record<string, unknown> {
  return JSON.parse(readFileSync(target.manifest, 'utf8')) as Record<string, unknown>;
}

export function targetFor(slug: string): GitHubAppTarget | null {
  return githubApps.find((target) => target.slug === slug) ?? null;
}
