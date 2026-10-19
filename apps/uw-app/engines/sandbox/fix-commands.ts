import { REPOSITORY_DIR } from './paths.ts';

export const NO_CHECKS_EXIT = 78;

const DECLARED_CHECKS = '.harness/checks.sh';
const SESSION_LINE = 'uw-model-session';
const KILL_PASSES = 100;
const PASS_PAUSE = '0.02';
const sessionLine = /^uw-model-session (\d{1,10})$/u;
export const SAFE_GIT = [
  'GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1',
  'git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false',
  '-c core.attributesFile=/dev/null',
].join(' ');

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

export function killSessionCommand(sid: number): readonly string[] {
  return [
    'sh',
    '-c',
    [
      'for sig in STOP KILL; do',
      '  tries=0',
      '  while :; do',
      '    left=0',
      '    for f in /proc/[0-9]*/stat; do',
      '      s=$(cat "$f" 2>/dev/null) || continue',
      '      s=${s##*) }',
      '      set -- $s',
      `      [ "$4" = "${sid.toString()}" ] || continue`,
      '      case "$sig$1" in STOPT|STOPt|*Z|*X|*x) continue ;; esac',
      '      p=${f#/proc/}',
      '      kill -"$sig" "${p%/stat}" 2>/dev/null || true',
      '      left=$((left + 1))',
      '    done',
      '    [ "$left" = 0 ] && break',
      '    tries=$((tries + 1))',
      `    [ "$tries" -lt ${KILL_PASSES.toString()} ] || exit 81`,
      `    sleep ${PASS_PAUSE}`,
      '  done',
      'done',
    ].join('\n'),
  ];
}

export function inspectCommand(): readonly string[] {
  return ['sh', '-c', `cd ${REPOSITORY_DIR} && ${SAFE_GIT} rev-parse --verify "HEAD^{commit}"`];
}

export function checksCommand(tree: string): readonly string[] {
  return ['sh', '-c', `cd ${tree} && sh -c "$UW_CHECKS"`];
}

export function pushCommand(sha: string, verified: string): readonly string[] {
  const target = `"${sha}:refs/heads/$UW_BRANCH"`;
  return [
    'sh',
    '-c',
    `${SAFE_GIT} -C ${verified} push --no-verify --quiet "$UW_CLONE_URL" ${target}`,
  ];
}
