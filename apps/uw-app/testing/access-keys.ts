import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';

const FIXTURE_TEAM_DOMAIN = 'https://uw-fixture.cloudflareaccess.com';
const FIXTURE_AUDIENCE = 'fixture-audience-tag';
const FIXTURE_MCP_AUDIENCE = 'fixture-mcp-audience-tag';
export const fixtureAccessEnv = {
  ACCESS_TEAM_DOMAIN: FIXTURE_TEAM_DOMAIN,
  ACCESS_AUD: FIXTURE_AUDIENCE,
  ACCESS_MCP_AUD: FIXTURE_MCP_AUDIENCE,
};

type SignOptions = {
  readonly audience?: string;
  readonly issuer?: string;
  readonly expiresAt?: number | null;
};

export type AccessFixture = {
  readonly keys: JWTVerifyGetKey;
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
  signForMcp(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
};

export async function createAccessFixture(): Promise<AccessFixture> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256' };
  const sign = (claims: Record<string, unknown>, options: SignOptions = {}): Promise<string> => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(options.issuer ?? FIXTURE_TEAM_DOMAIN)
      .setAudience(options.audience ?? FIXTURE_AUDIENCE)
      .setIssuedAt();
    if (options.expiresAt !== null) {
      jwt.setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300);
    }
    return jwt.sign(privateKey);
  };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign,
    signForMcp: (claims, options = {}) =>
      sign(claims, { ...options, audience: FIXTURE_MCP_AUDIENCE }),
  };
}
