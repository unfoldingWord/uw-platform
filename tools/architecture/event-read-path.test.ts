import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const theReadPath = 'packages/db/store/events.ts';
const readsEvents = [
  /\.from\(\s*harnessEvents\b/,
  /\.from\(\s*\w+\.harnessEvents\b/,
  /\bFROM\s+"?harness_events\b/i,
];

function isScanned(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && file !== theReadPath;
}

function selectsEvents(source: string): boolean {
  return readsEvents.some((pattern) => pattern.test(source));
}

function readers(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(isScanned).filter((file) => selectsEvents(read(file)));
}

describe('KN-4 one read function is the only event read path', () => {
  it('finds no other file that selects from harness_events', () => {
    expect(readers(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each([
    'db.select().from(harnessEvents)',
    'tx.select().from(schema.harnessEvents)',
    'sql`SELECT * FROM harness_events`',
  ])('flags %j', (source) => {
    expect(readers(['apps/uw-app/x.ts'], () => source)).toEqual(['apps/uw-app/x.ts']);
  });
});
