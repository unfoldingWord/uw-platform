import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const images = ['infra/containers/claude-code/Dockerfile', 'infra/containers/codex/Dockerfile'];
const secretName = /KEY|TOKEN|SECRET|OAUTH|AUTH/i;
const instruction = /^(?<name>[A-Z]+)\s+(?<rest>.*)$/;
const rootUser = /^(?:root|0)(?::|$)/;
const loginFiles: readonly string[] = ['.credentials', 'auth.json'];
const loginHomes: readonly string[] = ['.claude/', '.codex/'];
const copying: ReadonlySet<string> = new Set(['COPY', 'ADD']);

type Instruction = { readonly name: string; readonly rest: string };

function instructionsOf(source: string): Instruction[] {
  return source
    .split('\n')
    .map((line) => instruction.exec(line.trim())?.groups)
    .filter((groups) => groups !== undefined)
    .map((groups) => ({ name: groups['name'] ?? '', rest: groups['rest'] ?? '' }));
}

function declaredNames(rest: string): string[] {
  return rest
    .split(/\s+/)
    .map((pair) => pair.split('=')[0] ?? '')
    .filter((name) => name.length > 0);
}

function pinned(image: string): boolean {
  if (image.includes('@sha256:')) return true;
  const tag = image.split('/').at(-1)?.split(':')[1];
  return tag !== undefined && tag !== '' && tag !== 'latest';
}

function loginProblems(source: string, found: readonly Instruction[]): string[] {
  const files = loginFiles
    .filter((name) => source.includes(name))
    .map((name) => `holds a CLI login: ${name}`);
  const homes = found
    .filter((line) => copying.has(line.name))
    .flatMap((line) => loginHomes.filter((home) => line.rest.includes(home)))
    .map((home) => `holds a CLI login: ${home}`);
  return [...files, ...homes];
}

function imageProblems(source: string): string[] {
  const found = instructionsOf(source);
  const secrets = found
    .filter((line) => line.name === 'ENV' || line.name === 'ARG')
    .flatMap((line) => declaredNames(line.rest).filter((name) => secretName.test(name)))
    .map((name) => `names a secret: ${name}`);
  const unpinned = found
    .filter((line) => line.name === 'FROM')
    .map((line) => line.rest.split(/\s+/)[0] ?? '')
    .filter((image) => !pinned(image))
    .map((image) => `unpinned base: ${image}`);
  const user = found
    .filter((line) => line.name === 'USER')
    .at(-1)
    ?.rest.trim();
  const runsAsRoot = user === undefined || rootUser.test(user) ? ['ends as root'] : [];
  return [...secrets, ...loginProblems(source, found), ...unpinned, ...runsAsRoot];
}

describe('the sandbox container images', () => {
  it.each(images)(
    '%s bakes in no key or CLI login, pins its base and ends as a user other than root',
    (path) => {
      expect(imageProblems(readFileSync(path, 'utf8'))).toEqual([]);
    },
  );

  it.each([
    ['a Claude Code login written by RUN', 'RUN echo "$T" > ~/.claude/.credentials.json'],
    ['a copied Claude Code login', 'COPY .credentials.json /workspace/.claude/'],
    ['a copied Codex sign-in', 'COPY auth.json /workspace/.codex/auth.json'],
    ['an added Codex home', 'ADD codex-home /workspace/.codex/'],
    ['a copied Claude Code home', 'COPY --chown=runner claude /workspace/.claude/'],
    [
      'a credential on a continued line',
      'RUN mkdir -p ~/.codex \\\n  && cp /tmp/auth.json ~/.codex/',
    ],
  ])('flags a planted image that bakes in %s', (_name, line) => {
    const planted = ['FROM docker.io/cloudflare/sandbox:1.0.0', line, 'USER runner'].join('\n');
    expect(imageProblems(planted).some((problem) => problem.startsWith('holds a CLI login'))).toBe(
      true,
    );
  });

  it('flags a planted image that holds a key, floats its base and runs as root', () => {
    const planted = [
      'FROM docker.io/cloudflare/sandbox:latest',
      'FROM node',
      'ARG NPM_TOKEN',
      'ENV ANTHROPIC_API_KEY=sk-live HOME=/workspace',
      'ENV CLAUDE_CODE_OAUTH_TOKEN=x',
      'USER runner',
      'USER root',
    ].join('\n');
    expect(imageProblems(planted)).toEqual([
      'names a secret: NPM_TOKEN',
      'names a secret: ANTHROPIC_API_KEY',
      'names a secret: CLAUDE_CODE_OAUTH_TOKEN',
      'unpinned base: docker.io/cloudflare/sandbox:latest',
      'unpinned base: node',
      'ends as root',
    ]);
    expect(imageProblems('FROM docker.io/cloudflare/sandbox:1.0.0')).toEqual(['ends as root']);
  });
});
