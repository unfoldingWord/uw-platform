import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const generatedRoots = ['apps/uw-app/generated/'];

export function isGeneratedArtefact(path: string): boolean {
  return generatedRoots.some((root) => path.startsWith(root));
}

export function repoFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return listed
    .split('\n')
    .filter((path) => path !== '' && existsSync(path) && !isGeneratedArtefact(path));
}
