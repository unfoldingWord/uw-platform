import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractCommand, inOwnSession, inspectCommand, modelSession } from './fix-commands.ts';
import { REPOSITORY_DIR } from './paths.ts';

const root = mkdtempSync(join(tmpdir(), 'uw-fix-'));
let count = 0;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function repoWith(files: Readonly<Record<string, string>>): string {
  count += 1;
  const repo = join(root, `repo-${count.toString()}`);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'fix@example.org');
  git(repo, 'config', 'user.name', 'fix');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  return repo;
}

function committed(repo: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fix');
  return git(repo, 'rev-parse', 'HEAD');
}

function runIn(
  repo: string,
  command: readonly string[],
): { status: number | null; stdout: string } {
  const script = (command[2] ?? '').replaceAll(REPOSITORY_DIR, repo);
  const ran = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout };
}

function extracted(repo: string, sha: string): { status: number | null; tree: string } {
  const tree = join(root, `tree-${count.toString()}`);
  const { status } = runIn(repo, extractCommand(sha, tree, join(root, `home-${count.toString()}`)));
  return { status, tree };
}

describe('FL-4 the checked tree is the raw blobs of the commit, on a real git', () => {
  it('FL-4 export-ignore and export-subst at the root and in a directory change nothing', () => {
    const repo = repoWith({
      '.gitattributes': 's.txt export-subst\n',
      's.txt': 'subst $Format:%H$\n',
      'sub/.gitattributes': 't.test.sh export-ignore\n',
      'sub/t.test.sh': 'exit 1\n',
    });
    const sha = committed(repo);
    const { status, tree } = extracted(repo, sha);
    expect(status).toBe(0);
    for (const path of ['.gitattributes', 's.txt', 'sub/.gitattributes', 'sub/t.test.sh']) {
      expect(readFileSync(join(tree, path), 'utf8')).toBe(
        git(repo, 'cat-file', 'blob', `${sha}:${path}`) + '\n',
      );
    }
  });
});

describe('FL-4 an entry outside plain files refuses the extraction, on a real git', () => {
  it('FL-4 a symlink in the commit refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    symlinkSync('/etc/hostname', join(repo, 'link.txt'));
    const { status, tree } = extracted(repo, committed(repo));
    expect(status).toBe(80);
    expect(readdirSync(tree)).not.toContain('link.txt');
  });

  it('FL-4 a submodule entry refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    const sha = committed(repo);
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${sha},sub`);
    git(repo, 'commit', '-qm', 'submodule');
    expect(extracted(repo, git(repo, 'rev-parse', 'HEAD')).status).toBe(80);
  });

  it('FL-4 a tree entry named .. refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    committed(repo);
    const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], {
      input: 'evil\n',
      encoding: 'utf8',
    }).trim();
    const inner = execFileSync('git', ['-C', repo, 'mktree'], {
      input: `100644 blob ${blob}\tx\n`,
      encoding: 'utf8',
    }).trim();
    const outer = execFileSync('git', ['-C', repo, 'mktree'], {
      input: `040000 tree ${inner}\t..\n`,
      encoding: 'utf8',
    }).trim();
    const sha = git(repo, 'commit-tree', outer, '-m', 'traversal');
    expect(extracted(repo, sha).status).toBe(80);
  });

  it('FL-4 a .git redirected through commondir refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    const sha = committed(repo);
    writeFileSync(join(repo, '.git', 'commondir'), join(root, 'elsewhere.git'));
    expect(extracted(repo, sha).status).toBe(79);
  });
});

describe('FL-4 the model session is killed whole, on a real shell', () => {
  it('FL-4 a process the model left running in its session is gone after the inspection', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    committed(repo);
    const [command, ...args] = inOwnSession([
      'sh',
      '-c',
      'sleep 120 >/dev/null 2>&1 & echo started',
    ]);
    const ran = spawnSync(command ?? 'setsid', args, { encoding: 'utf8', timeout: 20_000 });
    const sid = modelSession(ran.stderr);
    expect(sid).not.toBeNull();
    const left = (): string =>
      spawnSync('pgrep', ['-s', String(sid)], { encoding: 'utf8' }).stdout.trim();
    expect(left()).not.toBe('');
    expect(runIn(repo, inspectCommand(sid ?? 0)).status).toBe(0);
    expect(left()).toBe('');
  });
});
