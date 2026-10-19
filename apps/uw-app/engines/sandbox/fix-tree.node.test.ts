import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
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
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { pushCommand } from './fix-commands.ts';
import { type TreeDirs, verifiedTreeCommand } from './fix-tree.ts';
import { REPOSITORY_DIR } from './paths.ts';

const root = mkdtempSync(join(tmpdir(), 'uw-fix-tree-'));
let count = 0;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: readonly string[], input?: string): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', input }).trim();
}

function repoWith(files: Readonly<Record<string, string>>): string {
  count += 1;
  const repo = join(root, `repo-${count.toString()}`);
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'fix@example.org']);
  git(repo, ['config', 'user.name', 'fix']);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  return repo;
}

function committed(repo: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'fix']);
  return git(repo, ['rev-parse', 'HEAD']);
}

function runIn(
  repo: string,
  command: readonly string[],
  env: Readonly<Record<string, string>> = {},
): number | null {
  const script = (command[2] ?? '').replaceAll(REPOSITORY_DIR, repo);
  return spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } })
    .status;
}

function extracted(repo: string, sha: string): { status: number | null; dirs: TreeDirs } {
  const at = (name: string): string => join(root, `${name}-${count.toString()}`);
  const dirs = { verified: at('verified'), tree: at('tree'), home: at('home') };
  return { status: runIn(repo, verifiedTreeCommand(sha, dirs)), dirs };
}

function filesUnder(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return files.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1)).sort();
}

function forge(repo: string, oid: string, content: string): void {
  const body = Buffer.from(content);
  const raw = Buffer.concat([Buffer.from(`blob ${body.length.toString()}\0`), body]);
  const dir = join(repo, '.git', 'objects', oid.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, oid.slice(2)), { force: true });
  writeFileSync(join(dir, oid.slice(2)), deflateSync(raw));
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
    const { status, dirs } = extracted(repo, sha);
    expect(status).toBe(0);
    for (const path of ['.gitattributes', 's.txt', 'sub/.gitattributes', 'sub/t.test.sh']) {
      expect(readFileSync(join(dirs.tree, path), 'utf8')).toBe(
        git(repo, ['cat-file', 'blob', `${sha}:${path}`]) + '\n',
      );
    }
  });

  it('FL-4 names an option parser or a quoting git would misread are extracted exactly', () => {
    const names = [
      '--help',
      '--version',
      '--',
      '-n',
      'é.txt',
      'a b',
      'back\\slash',
      '"q"',
      't\tab',
    ];
    const files = Object.fromEntries([...names, 'sub/--help'].map((name) => [name, `${name}\n`]));
    const repo = repoWith(files);
    const { status, dirs } = extracted(repo, committed(repo));
    expect(status).toBe(0);
    expect(filesUnder(dirs.tree)).toEqual(Object.keys(files).sort());
    for (const name of Object.keys(files)) {
      expect(readFileSync(join(dirs.tree, name), 'utf8')).toBe(`${name}\n`);
    }
  });

  it('FL-4 a path holding a newline refuses the extraction', () => {
    const repo = repoWith({ 'a\nb': 'x\n' });
    expect(extracted(repo, committed(repo)).status).toBe(80);
  });
});

describe('FL-4 objects the model forged never reach the checks, on a real git', () => {
  it('FL-4 a forged loose object for a blob of the commit refuses the extraction', () => {
    const repo = repoWith({ 't.sh': 'assert(real)\n' });
    const sha = committed(repo);
    const oid = git(repo, ['rev-parse', `${sha}:t.sh`]);
    forge(repo, oid, 'assert(true)\n');
    expect(git(repo, ['cat-file', 'blob', oid])).toBe('assert(true)');
    const { status, dirs } = extracted(repo, sha);
    expect(status).toBe(82);
    expect(filesUnder(dirs.tree)).toEqual([]);
  });

  it('FL-4 a repository that borrows objects through alternates refuses the extraction', () => {
    const repo = repoWith({ 't.sh': 'assert(real)\n' });
    const sha = committed(repo);
    const other = join(root, `alternate-${count.toString()}`);
    git(root, ['clone', '-q', '--bare', repo, other]);
    writeFileSync(join(repo, '.git', 'objects', 'info', 'alternates'), join(other, 'objects'));
    expect(extracted(repo, sha).status).toBe(79);
  });

  it('FL-4 the platform pushes from the fresh repository exactly the tree the checks read', () => {
    const repo = repoWith({ 't.sh': 'assert(real)\n', 'lib/a.ts': 'export {}\n' });
    const sha = committed(repo);
    const remote = join(root, `remote-${count.toString()}`);
    git(root, ['init', '-q', '--bare', remote]);
    const { status, dirs } = extracted(repo, sha);
    expect(status).toBe(0);
    const env = { UW_CLONE_URL: remote, UW_BRANCH: 'harness/item-1' };
    expect(runIn(repo, pushCommand(sha, dirs.verified), env)).toBe(0);
    expect(git(remote, ['rev-parse', 'refs/heads/harness/item-1'])).toBe(sha);
    for (const path of filesUnder(dirs.tree)) {
      expect(git(remote, ['cat-file', 'blob', `${sha}:${path}`]) + '\n').toBe(
        readFileSync(join(dirs.tree, path), 'utf8'),
      );
    }
  });
});

describe('FL-4 an entry outside plain files refuses the extraction, on a real git', () => {
  it('FL-4 a symlink in the commit refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    symlinkSync('/etc/hostname', join(repo, 'link.txt'));
    const { status, dirs } = extracted(repo, committed(repo));
    expect(status).toBe(80);
    expect(filesUnder(dirs.tree)).not.toContain('link.txt');
  });

  it('FL-4 a submodule entry refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    const sha = committed(repo);
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${sha},sub`]);
    git(repo, ['commit', '-qm', 'submodule']);
    expect(extracted(repo, git(repo, ['rev-parse', 'HEAD'])).status).toBe(80);
  });

  it('FL-4 a tree entry named .. refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    committed(repo);
    const blob = git(repo, ['hash-object', '-w', '--stdin'], 'evil\n');
    const inner = git(repo, ['mktree'], `100644 blob ${blob}\tx\n`);
    const outer = git(repo, ['mktree'], `040000 tree ${inner}\t..\n`);
    const sha = git(repo, ['commit-tree', outer, '-m', 'traversal']);
    expect(extracted(repo, sha).status).not.toBe(0);
    expect(readdirSync(root)).not.toContain('x');
  });

  it('FL-4 a .git redirected through commondir refuses the extraction', () => {
    const repo = repoWith({ 'a.txt': 'a\n' });
    const sha = committed(repo);
    writeFileSync(join(repo, '.git', 'commondir'), join(root, 'elsewhere.git'));
    expect(extracted(repo, sha).status).toBe(79);
  });
});
