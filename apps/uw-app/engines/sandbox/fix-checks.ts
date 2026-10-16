import type { ExecResult } from './host.ts';
import { REPOSITORY_DIR, WORKSPACE } from './paths.ts';
import { REGISTRY_HOST } from './registry-egress.ts';
import type { SessionFinish } from './session.ts';

export const NO_CHECKS_EXIT = 78;

const DECLARED_CHECKS = '.harness/checks.sh';
const CHECKS_FILE = `${WORKSPACE}/checks.sh`;
const RUN_CHECKS = ['sh', '-c', `cd ${REPOSITORY_DIR} && sh ${CHECKS_FILE}`];
const PUSH = ['sh', '-c', `git -C ${REPOSITORY_DIR} push origin "HEAD:refs/heads/$UW_BRANCH"`];
const checksEnv = {
  npm_config_registry: `http://${REGISTRY_HOST}/`,
  npm_config_replace_registry_host: 'always',
  COREPACK_NPM_REGISTRY: `http://${REGISTRY_HOST}`,
};

export const readDeclaredChecks = `git -C ${REPOSITORY_DIR} show "$UW_START:${DECLARED_CHECKS}" > ${CHECKS_FILE} 2>/dev/null || exit ${NO_CHECKS_EXIT.toString()}`;

type Phase = 'model' | 'checks' | 'push';

export type FixPhase = {
  pushes(): boolean;
  installs(): boolean;
  enter(phase: Exclude<Phase, 'model'>): void;
};

export function fixPhase(fixing: boolean): FixPhase {
  let phase: Phase = 'model';
  return {
    pushes: () => !fixing || phase === 'push',
    installs: () => fixing && phase === 'checks',
    enter: (next) => {
      phase = next;
    },
  };
}

export function fixFinish(phase: FixPhase, ended: (ran: ExecResult) => boolean): SessionFinish {
  return async (ran, exec) => {
    if (ran.exitCode === NO_CHECKS_EXIT) return 'checks_not_run_locally';
    if (!ended(ran)) return 'not_run';
    phase.enter('checks');
    const checked = await exec(RUN_CHECKS, checksEnv);
    if (checked.exitCode !== 0) return 'checks_not_run_locally';
    phase.enter('push');
    const pushed = await exec(PUSH, {});
    if (pushed.exitCode !== 0) throw new Error(`the fix push exited ${pushed.exitCode.toString()}`);
    return 'pushed';
  };
}
