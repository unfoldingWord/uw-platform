import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const files = readdirSync('infra', { recursive: true, encoding: 'utf8' })
  .filter((file) => /wrangler[^/]*\.toml$/.test(file))
  .map((file) => join('infra', file));

function declaredVars(config: Record<string, unknown>): string[] {
  const envs = Object.values((config['env'] ?? {}) as Record<string, Record<string, unknown>>);
  return [config, ...envs].flatMap((block) =>
    Object.keys((block['vars'] ?? {}) as Record<string, unknown>),
  );
}

describe('P21 no deployed environment can set the dev principal', () => {
  it('finds the wrangler files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s declares no DEV_PRINCIPAL_EMAIL', (file) => {
    expect(declaredVars(parse(readFileSync(file, 'utf8')))).not.toContain('DEV_PRINCIPAL_EMAIL');
  });
});
