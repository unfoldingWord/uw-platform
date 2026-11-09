import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = '.github/scripts/db-tunnel.sh';

function run(env: Readonly<Record<string, string>>) {
  const result = spawnSync('bash', [script], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('FD-12 the migrate jobs reach a tunnel-only database', () => {
  it('FD-12 without a tunnel host the script does nothing, so migrations connect directly', () => {
    const { status, out } = run({});
    expect(status).toBe(0);
    expect(out).toContain('migrations connect to DATABASE_URL directly');
  });

  it('FD-12 a tunnel host without the Access service token fails before downloading anything', () => {
    const { status, out } = run({ DATABASE_TUNNEL_HOST: 'db.example.org' });
    expect(status).toBe(1);
    expect(out).toContain('DATABASE_TUNNEL_CLIENT_ID and DATABASE_TUNNEL_CLIENT_SECRET');
  });

  it('FD-12 both migrate jobs open the tunnel, gated, before they migrate', () => {
    for (const [file, place] of [
      ['.github/workflows/deploy-staging.yml', 'STAGING'],
      ['.github/workflows/deploy-production.yml', 'PRODUCTION'],
    ] as const) {
      const text = readFileSync(file, 'utf8');
      const tunnel = text.indexOf('bash .github/scripts/db-tunnel.sh');
      expect(tunnel, file).toBeGreaterThan(-1);
      expect(tunnel, file).toBeLessThan(text.indexOf('run: pnpm db:migrate'));
      expect(text).toContain(`vars.DATABASE_TUNNEL_HOST_${place}`);
    }
  });
});
