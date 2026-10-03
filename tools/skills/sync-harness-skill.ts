import { readFileSync, writeFileSync } from 'node:fs';
import { skillFileOf } from './skill-file.ts';

const repoCopy = 'skills/harness/SKILL.md';

function current(target: string): string | null {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

export function syncSkill(args: readonly string[], target: string): number {
  const named = args.filter((arg) => arg !== '--' && arg !== '--check');
  const [source] = named;
  if (source === undefined) throw new Error('name the exported page JSON to sync from');
  const file = skillFileOf(JSON.parse(readFileSync(source, 'utf8')) as unknown);
  if (args.includes('--check')) return current(target) === file ? 0 : 1;
  writeFileSync(target, file);
  return 0;
}

if (process.argv[1]?.endsWith('sync-harness-skill.ts') === true) {
  process.exitCode = syncSkill(process.argv.slice(2), repoCopy);
}
