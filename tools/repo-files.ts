import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function repoFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return listed.split('\n').filter((path) => path !== '' && existsSync(path));
}
