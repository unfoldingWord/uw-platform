import { REPOSITORY_DIR } from './paths.ts';

export const NO_CHECKS_EXIT = 78;

const DECLARED_CHECKS = '.harness/checks.sh';
const SESSION_LINE = 'uw-model-session';
const sessionLine = /^uw-model-session (\d{1,10})$/u;
const SAFE_GIT = [
  'GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1',
  'git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false',
  '-c core.attributesFile=/dev/null -c core.quotePath=true',
].join(' ');
const refusedPaths = [
  '/*',
  '\\"*',
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

export const PREPARE = [
  'sh',
  '-c',
  [
    'set -e',
    `git clone --quiet --no-tags "$UW_CLONE_URL" ${REPOSITORY_DIR}`,
    `git -C ${REPOSITORY_DIR} checkout --quiet -B "$UW_BRANCH" "$UW_START"`,
    `git -C ${REPOSITORY_DIR} show "$UW_START:${DECLARED_CHECKS}" 2>/dev/null || exit ${NO_CHECKS_EXIT.toString()}`,
  ].join('\n'),
];

export function inOwnSession(command: readonly string[]): readonly string[] {
  const announce = `echo "${SESSION_LINE} $$" >&2; exec "$@"`;
  return ['setsid', '--wait', 'sh', '-c', announce, 'uw-model', ...command];
}

export function modelSession(stderr: string): number | null {
  const found = sessionLine.exec(stderr.split('\n')[0] ?? '');
  const sid = found === null ? Number.NaN : Number(found[1]);
  return Number.isSafeInteger(sid) && sid > 1 ? sid : null;
}

export function inspectCommand(sid: number): readonly string[] {
  return [
    'sh',
    '-c',
    [
      'for f in /proc/[0-9]*/stat; do',
      '  s=$(cat "$f" 2>/dev/null) || continue',
      '  s=${s##*) }',
      '  set -- $s',
      `  if [ "$4" = "${sid.toString()}" ]; then p=\${f#/proc/}; kill -KILL "\${p%/stat}" 2>/dev/null || true; fi`,
      'done',
      `cd ${REPOSITORY_DIR} && ${SAFE_GIT} rev-parse --verify "HEAD^{commit}"`,
    ].join('\n'),
  ];
}

export function extractCommand(sha: string, tree: string, home: string): readonly string[] {
  const list = `${tree}.list`;
  return [
    'sh',
    '-c',
    [
      'set -e',
      `cd ${REPOSITORY_DIR}`,
      'test -d .git && test ! -L .git && test ! -e .git/commondir || exit 79',
      `test "$(${SAFE_GIT} rev-parse --git-common-dir)" = .git || exit 79`,
      `mkdir -p ${tree} ${home}`,
      `${SAFE_GIT} ls-tree -r --full-tree ${sha} > ${list}`,
      'while IFS= read -r entry; do',
      '  meta=${entry%%\t*}',
      '  path=${entry#*\t}',
      '  set -- $meta',
      '  case "$1" in 100644|100755) ;; *) exit 80 ;; esac',
      `  case "$path" in ${refusedPaths}) exit 80 ;; esac`,
      `  mkdir -p "${tree}/$(dirname "$path")"`,
      `  ${SAFE_GIT} cat-file blob "$3" > "${tree}/$path"`,
      `  if [ "$1" = 100755 ]; then chmod 755 "${tree}/$path"; fi`,
      `done < ${list}`,
      `rm -f ${list}`,
    ].join('\n'),
  ];
}

export function checksCommand(tree: string): readonly string[] {
  return ['sh', '-c', `cd ${tree} && sh -c "$UW_CHECKS"`];
}

export function pushCommand(sha: string): readonly string[] {
  const target = `"${sha}:refs/heads/$UW_BRANCH"`;
  return [
    'sh',
    '-c',
    `cd ${REPOSITORY_DIR} && ${SAFE_GIT} push --no-verify --quiet "$UW_CLONE_URL" ${target}`,
  ];
}
