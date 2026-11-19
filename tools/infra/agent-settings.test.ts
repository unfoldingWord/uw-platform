import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

type Env = {
  vars?: Record<string, string>;
  containers?: { class_name: string; instance_type?: string }[];
};
type Config = { env: Record<string, Env> };

const files = ['infra/uw-app/wrangler.toml', 'infra/uw-app/wrangler.go-live.toml'];
const deployed = ['staging', 'production'] as const;
const credential = /API_KEY|TOKEN|SECRET|PRIVATE/;

function load(file: string): Config {
  return parse(readFileSync(file, 'utf8')) as unknown as Config;
}

describe('#98 the hosted agents read their settings from config, their keys from secrets', () => {
  it.each(files.flatMap((file) => deployed.map((env) => [file, env] as const)))(
    '%s %s pins the cap, the always-on model and the gateway',
    (file, env) => {
      expect(load(file).env[env]?.vars).toMatchObject({
        AI_GATEWAY_ACCOUNT_ID: '5a3ffd86280d3ed086be76d955829242',
        AI_GATEWAY_ID: `uw-platform-${env}`,
        AI_SPEND_CAP_MINOR: '50000',
        ALWAYS_ON_PROVIDER: 'z-ai',
        ALWAYS_ON_MODEL: 'z-ai/glm-5.3-flash',
        SANDBOX_MINOR_PER_HOUR: '3',
      });
    },
  );

  it.each(files)('%s runs each sandbox on the basic instance its rate is priced for', (file) => {
    for (const env of deployed) {
      const containers = load(file).env[env]?.containers ?? [];
      expect(containers.map((entry) => entry.instance_type)).toEqual(['basic', 'basic']);
    }
  });

  it.each(files)('%s declares no credential as a var', (file) => {
    const names = Object.values(load(file).env).flatMap((env) => Object.keys(env.vars ?? {}));
    expect(names.filter((name) => credential.test(name))).toEqual([]);
  });
});
