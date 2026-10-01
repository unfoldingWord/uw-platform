import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = Record<string, unknown>;
type Policy = { name: string; decision: string; include: Rule[] };
type Application = {
  name: string;
  domain: string;
  destinations?: { uri: string }[];
  allowed_idps: string[];
};
type Declaration = {
  application: Application;
  policies: Policy[];
  health_bypass: { application: Application; policies: Policy[] };
};

const declaration: Declaration = JSON.parse(readFileSync('infra/access/uw-app.json', 'utf8'));

describe('FD-7 Cloudflare Access in front of uw-app, declared in infra', () => {
  it('covers staging and every per-PR Worker', () => {
    expect(declaration.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev',
      'uw-app-pr-*.unfoldingword.workers.dev',
    ]);
  });

  it('signs people in with Google and lets any valid service token through as non-identity', () => {
    const [people, agents] = declaration.policies;
    expect(people).toMatchObject({
      decision: 'allow',
      include: [{ login_method: { id: '<google-idp-id>' } }],
    });
    expect(agents).toMatchObject({
      decision: 'non_identity',
      include: [{ any_valid_service_token: {} }],
    });
  });

  it('bypasses Access for /health only, on staging and on every per-PR Worker', () => {
    expect(declaration.health_bypass.application.domain).toBe(
      'uw-app-staging.unfoldingword.workers.dev/health',
    );
    expect(declaration.health_bypass.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev/health',
      'uw-app-pr-*.unfoldingword.workers.dev/health',
    ]);
    expect(declaration.health_bypass.policies).toEqual([
      { name: 'Deploy health probe', decision: 'bypass', include: [{ everyone: {} }] },
    ]);
  });

  it('holds no secret', () => {
    expect(JSON.stringify(declaration)).not.toMatch(/secret|token_value|client_secret/i);
  });
});
