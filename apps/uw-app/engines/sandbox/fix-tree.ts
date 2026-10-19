import { SAFE_GIT } from './fix-commands.ts';
import { REPOSITORY_DIR, WORKSPACE } from './paths.ts';

export type TreeDirs = { readonly verified: string; readonly tree: string; readonly home: string };

const refusedPaths = [
  '/*',
  '..',
  '../*',
  '*/..',
  '*/../*',
  '.',
  './*',
  '*/.',
  '*/./*',
  '.git',
  '.git/*',
  '*/.git',
  '*/.git/*',
].join('|');

export function treeDirs(id: string): TreeDirs {
  return {
    verified: `${WORKSPACE}/verified-${id}`,
    tree: `${WORKSPACE}/checked-${id}`,
    home: `${WORKSPACE}/home-${id}`,
  };
}

function transferLines(sha: string, verified: string): readonly string[] {
  const fresh = `${SAFE_GIT} -C ${verified}`;
  return [
    `cd ${REPOSITORY_DIR}`,
    'test -d .git && test ! -L .git && test ! -e .git/commondir || exit 79',
    'test ! -e .git/objects/info/alternates || exit 79',
    'test ! -e .git/objects/info/http-alternates || exit 79',
    `test "$(${SAFE_GIT} rev-parse --git-common-dir)" = .git || exit 79`,
    `${SAFE_GIT} init --quiet --bare --template= ${verified}`,
    `printf '%s\\n' ${sha} | ${SAFE_GIT} pack-objects --revs --stdout | ${fresh} index-pack --stdin --fix-thin --strict >/dev/null || exit 82`,
    `${fresh} fsck --strict --no-dangling ${sha} >/dev/null || exit 82`,
    `test "$(${fresh} cat-file -t ${sha})" = commit || exit 82`,
  ];
}

function extractLines(sha: string, dirs: TreeDirs): readonly string[] {
  const list = `${dirs.tree}.list`;
  return [
    `mkdir -p ${dirs.tree} ${dirs.home}`,
    `${SAFE_GIT} -C ${dirs.verified} ls-tree -r -z --full-tree ${sha} > ${list}.z`,
    `test -z "$(tr -cd '\\n' < ${list}.z | tr '\\n' x)" || exit 80`,
    `tr '\\0' '\\n' < ${list}.z > ${list}`,
    'while IFS= read -r entry; do',
    '  meta=${entry%%\t*}',
    '  path=${entry#*\t}',
    '  set -- $meta',
    '  case "$1" in 100644|100755) ;; *) exit 80 ;; esac',
    `  case "$path" in ${refusedPaths}) exit 80 ;; esac`,
    `  case "$path" in */*) mkdir -p "${dirs.tree}/\${path%/*}" ;; esac`,
    `  ${SAFE_GIT} -C ${dirs.verified} cat-file blob "$3" > "${dirs.tree}/$path"`,
    `  if [ "$1" = 100755 ]; then chmod 755 "${dirs.tree}/$path"; fi`,
    `done < ${list}`,
    `rm -f ${list} ${list}.z`,
  ];
}

export function verifiedTreeCommand(sha: string, dirs: TreeDirs): readonly string[] {
  return [
    'sh',
    '-c',
    ['set -e', ...transferLines(sha, dirs.verified), ...extractLines(sha, dirs)].join('\n'),
  ];
}
