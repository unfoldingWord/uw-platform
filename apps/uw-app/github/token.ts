import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, failureOf, type GitHubResult } from './failures.ts';
import type { GitHubTransport } from './transport.ts';

export type TokenScope = {
  readonly repository: string | null;
  readonly permissions: Readonly<Record<string, 'read' | 'write'>>;
};

type Issued = { readonly token: string; readonly expiresAt: Date };

const pkcs8Header = '-----BEGIN PRIVATE KEY-----';
const issuedLeeway = 60;
const lifetime = 540;
const tokenAnswer = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

async function appJwt(config: GitHubAppConfig, at: Date): Promise<string | null> {
  try {
    const key = await importPKCS8(config.privateKey.trim(), 'RS256');
    return await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(config.appId)
      .setIssuedAt(seconds(at) - issuedLeeway)
      .setExpirationTime(seconds(at) + lifetime)
      .sign(key);
  } catch {
    return null;
  }
}

function bodyOf(scope: TokenScope): string {
  const { repository, permissions } = scope;
  return JSON.stringify(repository ? { repositories: [repository], permissions } : { permissions });
}

async function requestToken(
  config: GitHubAppConfig,
  transport: GitHubTransport,
  jwt: string,
  scope: TokenScope,
): Promise<Response | null> {
  try {
    return await transport.fetch(
      `https://api.github.com/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'uw-platform',
        },
        body: bodyOf(scope),
      },
    );
  } catch {
    return null;
  }
}

export async function installationToken(
  config: GitHubAppConfig,
  transport: GitHubTransport,
  scope: TokenScope,
): Promise<GitHubResult<Issued>> {
  if (!config.privateKey.trim().startsWith(pkcs8Header)) return failed('key_not_pkcs8', null);
  const jwt = await appJwt(config, transport.now());
  if (jwt === null) return failed('key_not_pkcs8', null);
  const response = await requestToken(config, transport, jwt, scope);
  if (response === null) return failed('unreachable', null);
  if (!response.ok) return failed(failureOf(response.status, response.headers), response.status);
  const parsed = tokenAnswer.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return failed('malformed_response', response.status);
  return {
    ok: true,
    value: { token: parsed.data.token, expiresAt: new Date(parsed.data.expires_at) },
  };
}
