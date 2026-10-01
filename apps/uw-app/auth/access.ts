import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Bindings } from '../env.ts';

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export type AccessConfig = { readonly teamDomain: string; readonly audience: string };
export type AccessIdentity =
  | { readonly kind: 'person'; readonly email: string }
  | { readonly kind: 'service'; readonly clientId: string };

const teamDomainPattern = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;

const claimsSchema = z.object({
  email: z.email().optional(),
  common_name: z.string().min(1).max(200).optional(),
});

const keySets = new Map<string, JWTVerifyGetKey>();

export function accessConfigFrom(env: Bindings): AccessConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!teamDomain || !audience || !teamDomainPattern.test(teamDomain)) return null;
  return { teamDomain, audience };
}

export function remoteAccessKeys(config: AccessConfig): JWTVerifyGetKey {
  const cached = keySets.get(config.teamDomain);
  if (cached) return cached;
  const created = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`));
  keySets.set(config.teamDomain, created);
  return created;
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  keys: JWTVerifyGetKey,
): Promise<AccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    if (claims.data.email) return { kind: 'person', email: claims.data.email.toLowerCase() };
    if (claims.data.common_name) return { kind: 'service', clientId: claims.data.common_name };
    return null;
  } catch {
    return null;
  }
}
