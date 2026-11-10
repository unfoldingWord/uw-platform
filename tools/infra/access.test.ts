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
  migrations: { application: Application; policies: Policy[] };
};

const production = 'uw-app.unfoldingword.workers.dev';
const staging = 'uw-app-staging.unfoldingword.workers.dev';
const perPr = 'uw-app-pr-*.unfoldingword.workers.dev';
const everyHost = (suffix: string): string[] =>
  [production, staging, perPr].map((host) => `${host}${suffix}`);
const anyoneWithAnEmail = {
  name: 'Anyone with an email',
  decision: 'allow',
  include: [{ everyone: {} }],
};

const declaration: Declaration = JSON.parse(readFileSync('infra/access/uw-app.json', 'utf8'));

describe('FD-7 Cloudflare Access in front of uw-app, declared in infra', () => {
  it('covers production, staging and every per-PR Worker', () => {
    expect(declaration.application.domain).toBe(production);
    expect(declaration.application.destinations?.map((d) => d.uri)).toEqual(everyHost(''));
  });

  it('signs people in with an emailed one-time PIN and admits no service token on the app', () => {
    expect(declaration.application.allowed_idps).toEqual(['<one-time-pin-idp-id>']);
    expect(declaration.policies).toEqual([anyoneWithAnEmail]);
  });

  it('sends the app session cookie same-site lax, so a cross-site form post carries none', () => {
    expect(declaration.application.same_site_cookie_attribute).toBe('lax');
  });

  it('bypasses Access for the deploy probe at /health/probe only, on every host', () => {
    expect(declaration.health_bypass.application.domain).toBe(`${production}/health/probe`);
    expect(declaration.health_bypass.application.destinations?.map((d) => d.uri)).toEqual(
      everyHost('/health/probe'),
    );
    expect(declaration.health_bypass.policies).toEqual([
      { name: 'Deploy health probe', decision: 'bypass', include: [{ everyone: {} }] },
    ]);
  });

  it('holds no secret', () => {
    expect(JSON.stringify(declaration)).not.toMatch(/secret|token_value|client_secret/i);
  });
});

describe('FD-7 AB-1 the MCP surface is its own Access application', () => {
  it('puts /mcp behind its own application, on every host', () => {
    expect(declaration.mcp.application.domain).toBe(`${production}/mcp`);
    expect(declaration.mcp.application.destinations?.map((d) => d.uri)).toEqual(everyHost('/mcp'));
    expect(declaration.mcp.application.allowed_idps).toEqual(['<one-time-pin-idp-id>']);
  });

  it('signs agents on /mcp in with a one-time PIN or any valid service token as non-identity', () => {
    const [people, agents] = declaration.mcp.policies;
    expect(declaration.mcp.policies).toHaveLength(2);
    expect(people).toEqual(anyoneWithAnEmail);
    expect(agents).toMatchObject({
      decision: 'non_identity',
      include: [{ any_valid_service_token: {} }],
    });
  });
});

describe('FD-12 the migrations reach the database through one service token', () => {
  it('admits only the GitHub migrations service token to the database hostname', () => {
    expect(declaration.migrations.application.domain).toBe('uw-db-production.unfoldingword.us');
    expect(declaration.migrations.policies).toEqual([
      {
        name: 'GitHub migrations service token',
        decision: 'non_identity',
        include: [{ service_token: { token_id: '<github-migrations-service-token-id>' } }],
      },
    ]);
  });
});
