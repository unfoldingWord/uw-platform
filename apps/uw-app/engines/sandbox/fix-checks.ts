import type { ExecResult } from './host.ts';
import { REPOSITORY_DIR, WORKSPACE } from './paths.ts';
import { REGISTRY_HOST } from './registry-egress.ts';
import type { SessionFinish, SessionTools } from './session.ts';

export const NO_CHECKS_EXIT = 78;
const RENEW_EVERY_MS = 60_000;

const DECLARED_CHECKS = '.harness/checks.sh';
const SAFE_GIT = [
  'GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1',
  'git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false',
  '-c core.attributesFile=/dev/null',
].join(' ');
const MODEL_MARK = 'UW_MODEL_SESSION';
const CLEAN_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n';
const GIT_CONFIG = `${REPOSITORY_DIR}/.git/config`;
const fullSha = /^[0-9a-f]{40}$/u;
const PREPARE = [
  'sh',
  '-c',
  [
    'set -e',
    `git clone --quiet --no-tags "$UW_CLONE_URL" ${REPOSITORY_DIR}`,
    `git -C ${REPOSITORY_DIR} checkout --quiet -B "$UW_BRANCH" "$UW_START"`,
    `git -C ${REPOSITORY_DIR} show "$UW_START:${DECLARED_CHECKS}" 2>/dev/null || exit ${NO_CHECKS_EXIT.toString()}`,
  ].join('\n'),
];
function inspectCommand(mark: string): readonly string[] {
  const killLeft = [
    'for e in /proc/[0-9]*/environ; do',
    `  if tr '\\0' '\\n' < "$e" 2>/dev/null | grep -qx '${MODEL_MARK}=${mark}'; then`,
    '    p="${e#/proc/}"; kill -KILL "${p%/environ}" 2>/dev/null || true',
    '  fi',
    'done',
  ];
  const head = `cd ${REPOSITORY_DIR} && ${SAFE_GIT} rev-parse --verify "HEAD^{commit}"`;
  return ['sh', '-c', [...killLeft, head].join('\n')];
}

function extractCommand(sha: string, tree: string, home: string): readonly string[] {
  const archive = `${tree}.tar`;
  return [
    'sh',
    '-c',
    [
      'set -e',
      `mkdir -p ${tree} ${home}`,
      `cd ${REPOSITORY_DIR}`,
      'rm -f .git/info/attributes',
      `${SAFE_GIT} archive --format=tar --output=${archive} ${sha}`,
      `tar -xf ${archive} -C ${tree}`,
      `rm -f ${archive}`,
    ].join('\n'),
  ];
}

const checksEnv = {
  npm_config_registry: `http://${REGISTRY_HOST}/`,
  npm_config_replace_registry_host: 'always',
  COREPACK_NPM_REGISTRY: `http://${REGISTRY_HOST}`,
};

type Phase = 'prepare' | 'model' | 'checks' | 'push';

export type FixPhase = {
  thinks(): boolean;
  pushes(sha: string): boolean;
  installs(): boolean;
  enter(phase: Exclude<Phase, 'prepare'>, checked?: string): void;
};

export function fixPhase(fixing: boolean): FixPhase {
  let phase: Phase = fixing ? 'prepare' : 'model';
  let checkedSha: string | null = null;
  return {
    thinks: () => phase === 'model',
    pushes: (sha) => !fixing || (phase === 'push' && sha === checkedSha),
    installs: () => fixing && phase === 'checks',
    enter: (next, checked) => {
      phase = next;
      if (checked !== undefined) checkedSha = checked;
    },
  };
}

function pushCommand(sha: string): readonly string[] {
  const target = `"${sha}:refs/heads/$UW_BRANCH"`;
  return [
    'sh',
    '-c',
    `cd ${REPOSITORY_DIR} && ${SAFE_GIT} push --no-verify --quiet "$UW_CLONE_URL" ${target}`,
  ];
}

async function checkedHead(tools: SessionTools, mark: string): Promise<string | null> {
  await tools.writeFile(GIT_CONFIG, CLEAN_CONFIG);
  const inspected = await tools.exec(inspectCommand(mark), {});
  const sha = inspected.stdout.trim();
  return inspected.exitCode === 0 && fullSha.test(sha) ? sha : null;
}

async function heartbeat<T>(tools: SessionTools, work: () => Promise<T>): Promise<T> {
  await tools.admit();
  const timer = setInterval(() => void tools.admit(), RENEW_EVERY_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

async function runChecks(tools: SessionTools, text: string, sha: string): Promise<boolean> {
  const fresh = crypto.randomUUID();
  const tree = `${WORKSPACE}/checked-${fresh}`;
  const home = `${WORKSPACE}/home-${fresh}`;
  const extracted = await tools.exec(extractCommand(sha, tree, home), {});
  if (extracted.exitCode !== 0) return false;
  const env = { ...checksEnv, HOME: home, UW_CHECKS: text };
  const checked = await tools.exec(['sh', '-c', `cd ${tree} && sh -c "$UW_CHECKS"`], env);
  return checked.exitCode === 0;
}

async function pushed(tools: SessionTools, sha: string): Promise<boolean> {
  if (!(await tools.admit())) return false;
  await tools.writeFile(GIT_CONFIG, CLEAN_CONFIG);
  return (await tools.exec(pushCommand(sha), {})).exitCode === 0;
}

export function fixFinish(phase: FixPhase, ended: (ran: ExecResult) => boolean): SessionFinish {
  let declared: string | null = null;
  const mark = crypto.randomUUID();
  return {
    modelEnv: { [MODEL_MARK]: mark },
    prepare: async (tools) => {
      const prepared = await tools.exec(PREPARE, {});
      if (prepared.exitCode === NO_CHECKS_EXIT) return prepared;
      if (prepared.exitCode !== 0) {
        throw new Error(`the fix checkout exited ${prepared.exitCode.toString()}`);
      }
      declared = prepared.stdout;
      phase.enter('model');
      return null;
    },
    finish: async (ran, tools) => {
      if (declared === null || !ended(ran)) return 'not_run';
      const text = declared;
      const sha = await checkedHead(tools, mark);
      if (sha === null) return 'checks_not_run_locally';
      phase.enter('checks', sha);
      const passed = await heartbeat(tools, () => runChecks(tools, text, sha));
      if (!passed) return 'checks_not_run_locally';
      phase.enter('push');
      return (await pushed(tools, sha)) ? 'pushed' : 'checks_not_run_locally';
    },
  };
}
