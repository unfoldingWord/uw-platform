import { exportPKCS8, generateKeyPair } from 'jose';
import type { GitHubAppConfig } from '../app-config.ts';
import type { GitHubTransport } from '../transport.ts';
import type { FixtureGitHub } from './fixture-github.ts';

export async function fixtureApp(): Promise<GitHubAppConfig> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  return { appId: '4242', installationId: '77', privateKey: await exportPKCS8(pair.privateKey) };
}

export function fixtureTransport(github: FixtureGitHub): GitHubTransport {
  return { fetch: github.fetch, now: () => new Date('2026-10-02T12:00:00.000Z') };
}
