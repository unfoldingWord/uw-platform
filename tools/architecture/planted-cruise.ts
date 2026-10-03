import { cruise } from 'dependency-cruiser';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import config from '../../.dependency-cruiser.mjs';
import { architectureRoots } from './roots.ts';

const roots: string[] = [];
export const leaf = 'export const value = 1;';
export const store = 'node_modules/.pnpm/@octokit+core@7.0.8/node_modules/@octokit/core';
const githubFiles = [
  'client',
  'transport',
  'app-config',
  'session',
  'token',
  'ship-writes',
  'comments',
  'merge',
  'diff',
  'review-writes',
  'reviewer-apps',
];

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

const workspacePackages: Record<string, Record<string, string>> = {
  contracts: { '.': './index.ts' },
  db: { './client': './client.ts' },
  harness: { '.': './index.ts' },
};

function linkWorkspace(root: string): void {
  mkdirSync(join(root, 'apps/uw-app/node_modules/@uw'), { recursive: true });
  for (const [name, exports] of Object.entries(workspacePackages)) {
    for (const target of Object.values(exports)) write(root, `packages/${name}/${target}`, leaf);
    write(root, `packages/${name}/package.json`, JSON.stringify({ name: `@uw/${name}`, exports }));
    symlinkSync(
      join(root, 'packages', name),
      join(root, 'apps/uw-app/node_modules/@uw', name),
      'dir',
    );
  }
}

function pnpmTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'uw-github-rules-'));
  roots.push(root);
  for (const directory of architectureRoots) mkdirSync(join(root, directory), { recursive: true });
  write(root, `${store}/index.js`, 'export default 1;');
  write(root, `${store}/package.json`, JSON.stringify({ name: '@octokit/core', main: 'index.js' }));
  mkdirSync(join(root, 'apps/uw-app/node_modules/@octokit'), { recursive: true });
  symlinkSync(join(root, store), join(root, 'apps/uw-app/node_modules/@octokit/core'), 'dir');
  for (const name of githubFiles) write(root, `apps/uw-app/github/${name}.ts`, leaf);
  linkWorkspace(root);
  for (const name of ['@octokit/rest', '@octokit/webhooks-methods', 'zod']) {
    write(root, `node_modules/${name}/index.js`, 'export default 1;');
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
  }
  for (const [path, source] of Object.entries(files)) write(root, path, source);
  return root;
}

type Violation = { readonly rule: string; readonly to: string };

export async function violations(files: Record<string, string>): Promise<Violation[]> {
  const root = pnpmTree(files);
  const result = await cruise(
    architectureRoots,
    { ...config.options, baseDir: root, validate: true, ruleSet: config },
    undefined,
  );
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    to: violation.to,
  }));
}

export function removePlanted(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
