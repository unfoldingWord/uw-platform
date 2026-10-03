import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const deployCommand = /wrangler\s+deploy\b/g;
const configFlag = /--config[=\s]+(\S+)/g;
const liveConfig = /(?:^|\/)wrangler\.toml$/;

function deployConfigProblems(file: string, text: string): string[] {
  const deploys = [...text.matchAll(deployCommand)].length;
  const configs = [...text.matchAll(configFlag)].map((match) => match[1] ?? '');
  const problems = configs
    .filter((config) => !liveConfig.test(config))
    .map((config) => `${file} deploys with ${config}`);
  if (configs.length < deploys) problems.push(`${file} has a wrangler deploy without --config`);
  if (text.includes('wrangler.go-live.toml')) problems.push(`${file} names wrangler.go-live.toml`);
  return problems;
}

describe('the deploy workflows deploy only the live wrangler file', () => {
  const workflows = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));

  it('names wrangler.toml in every wrangler deploy and never the go-live file', () => {
    const problems = workflows.flatMap((file) =>
      deployConfigProblems(file, readFileSync(join(workflowsDir, file), 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('finds the uw-app deploys it checks', () => {
    const text = workflows.map((file) => readFileSync(join(workflowsDir, file), 'utf8')).join();
    expect(text).toContain('--config ../../infra/uw-app/wrangler.toml');
  });

  it('flags a planted deploy of the go-live file and a deploy with no config', () => {
    const planted = [
      'run: pnpm exec wrangler deploy --config ../../infra/uw-app/wrangler.go-live.toml --env staging',
      'run: pnpm exec wrangler deploy --env staging',
    ].join('\n');
    expect(deployConfigProblems('planted.yml', planted)).toEqual([
      'planted.yml deploys with ../../infra/uw-app/wrangler.go-live.toml',
      'planted.yml has a wrangler deploy without --config',
      'planted.yml names wrangler.go-live.toml',
    ]);
  });
});
