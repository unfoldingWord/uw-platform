import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = Record<string, unknown>;
type Policy = { name: string; decision: string; include: Rule[] };
type Application = {
  name: string;
  domain: string;
  destinations?: { uri: string }[];
  allowed_idps: string[];
  same_site_cookie_attribute?: string;
};
type Declaration = {
  application: Application;
  policies: Policy[];
  health_bypass: { application: Application; policies: Policy[] };
  mcp: { application: Application; policies: Policy[] };
};

const declaration: Declaration = JSON.parse(readFileSync('infra/access/uw-app.json', 'utf8'));

describe('FD-7 Cloudflare Access in front of uw-app, declared in infra', () => {
  it('covers staging and every per-PR Worker', () => {
    expect(declaration.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev',
      'uw-app-pr-*.unfoldingword.workers.dev',
    ]);
  });

  it('signs people in with Google and admits no service token on the app', () => {
    expect(declaration.policies).toEqual([
      {
        name: 'Anyone signed in with Google',
        decision: 'allow',
        include: [{ login_method: { id: '<google-idp-id>' } }],
      },
    ]);
  });

  it('sends the app session cookie same-site lax, so a cross-site form post carries none', () => {
    expect(declaration.application.same_site_cookie_attribute).toBe('lax');
  });

  it('bypasses Access for the deploy probe at /health/probe only, on staging and on every per-PR Worker', () => {
    expect(declaration.health_bypass.application.domain).toBe(
      'uw-app-staging.unfoldingword.workers.dev/health/probe',
    );
    expect(declaration.health_bypass.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev/health/probe',
      'uw-app-pr-*.unfoldingword.workers.dev/health/probe',
    ]);
    expect(declaration.health_bypass.policies).toEqual([
      { name: 'Deploy health probe', decision: 'bypass', include: [{ everyone: {} }] },
    ]);
  });

  it('holds no secret', () => {
    expect(JSON.stringify(declaration)).not.toMatch(/secret|token_value|client_secret/i);
  });
});

describe('FD-7 AB-1 the MCP surface is its own Access application', () => {
  it('puts /mcp behind its own application, on staging and on every per-PR Worker', () => {
    expect(declaration.mcp.application.domain).toBe('uw-app-staging.unfoldingword.workers.dev/mcp');
    expect(declaration.mcp.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev/mcp',
      'uw-app-pr-*.unfoldingword.workers.dev/mcp',
    ]);
    expect(declaration.mcp.application.allowed_idps).toEqual(['<google-idp-id>']);
  });

  it('signs agents on /mcp in with Google or any valid service token as non-identity', () => {
    const [people, agents] = declaration.mcp.policies;
    expect(declaration.mcp.policies).toHaveLength(2);
    expect(people).toMatchObject({
      decision: 'allow',
      include: [{ login_method: { id: '<google-idp-id>' } }],
    });
    expect(agents).toMatchObject({
      decision: 'non_identity',
      include: [{ any_valid_service_token: {} }],
    });
  });
});
