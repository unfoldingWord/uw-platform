import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { skillFrontmatterSchema } from '../../packages/contracts/index.ts';
import { skillPageOf } from './skill-file.ts';
import { syncSkill } from './sync-harness-skill.ts';

const repoCopy = 'skills/harness/SKILL.md';
const pageFixture = 'tools/skills/fixtures/harness-skill-page.json';
const flow = [
  'Sign in',
  'Poll',
  'Claim',
  'Worktree',
  'Context',
  'Work and record',
  'The lease warning',
  'Pull request',
  'Submit',
  'What you never do',
];
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'uw-skill-'));
  roots.push(root);
  return root;
}

function pageWith(change: object): string {
  const path = join(scratch(), 'page.json');
  const exported = JSON.parse(readFileSync(pageFixture, 'utf8')) as { page: object };
  writeFileSync(path, JSON.stringify({ page: { ...exported.page, ...change } }));
  return path;
}

describe('the synced harness skill', () => {
  it('HE-7 the harness skill in the repo parses as a skill page', () => {
    const page = skillPageOf(readFileSync(repoCopy, 'utf8'));
    expect(skillFrontmatterSchema.parse(page.frontmatter)).toMatchObject({ name: 'harness' });
    expect(page.bodyMd.length).toBeGreaterThan(0);
  });

  it('HE-7 syncing from the skill page writes the repo copy and a second sync changes nothing', () => {
    const target = join(scratch(), 'SKILL.md');
    expect(syncSkill([pageFixture], target)).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(repoCopy, 'utf8'));
    expect(syncSkill([pageFixture, '--check'], target)).toBe(0);
    expect(syncSkill([pageFixture, '--check'], repoCopy)).toBe(0);
    writeFileSync(target, 'drifted');
    expect(syncSkill([pageFixture, '--check'], target)).toBe(1);
    expect(readFileSync(target, 'utf8')).toBe('drifted');
  });

  it('refuses a page that is not a skill or whose frontmatter is not a skill frontmatter', () => {
    const target = join(scratch(), 'SKILL.md');
    expect(() => syncSkill([pageWith({ type: 'learning' })], target)).toThrow('not a skill page');
    expect(() => syncSkill([pageWith({ frontmatter: { name: 'Harness' } })], target)).toThrow(
      'not a skill page',
    );
    expect(() => syncSkill([], target)).toThrow('name the exported page');
  });

  it('HE-7 the skill tells a session the flow in order', () => {
    const headings = readFileSync(repoCopy, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    expect(headings).toEqual(flow);
  });

  it('the skill tells a session to push a wip commit at the lease warning with its own credentials', () => {
    const body = readFileSync(repoCopy, 'utf8');
    const warning = body.slice(
      body.indexOf('## The lease warning'),
      body.indexOf('## Pull request'),
    );
    expect(warning).toContain('leaseWarning: true');
    expect(warning).toContain('`wip: <item>`');
    expect(warning).toContain('push it to `harness/<item>` with your own git credentials');
  });
});
