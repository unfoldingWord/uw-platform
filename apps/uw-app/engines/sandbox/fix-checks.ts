import {
  checksCommand,
  inOwnSession,
  inspectCommand,
  killSessionCommand,
  modelSession,
  NO_CHECKS_EXIT,
  PREPARE,
  pushCommand,
} from './fix-commands.ts';
import { type TreeDirs, treeDirs, verifiedTreeCommand } from './fix-tree.ts';
import type { ExecResult } from './host.ts';
import { REPOSITORY_DIR } from './paths.ts';
import { REGISTRY_HOST } from './registry-egress.ts';
import type { SessionFinish, SessionTools } from './session.ts';

const RENEW_EVERY_MS = 60_000;
const CLEAN_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n';
const CLEAN_BARE_CONFIG =
  '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n';
const GIT_CONFIG = `${REPOSITORY_DIR}/.git/config`;
const fullSha = /^[0-9a-f]{40}$/u;
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

async function killedSession(tools: SessionTools, ran: ExecResult): Promise<boolean> {
  const sid = modelSession(ran.stderr);
  if (sid === null) return false;
  const killed = await tools.exec(killSessionCommand(sid), {});
  if (killed.exitCode !== 0) return false;
  await tools.writeFile(GIT_CONFIG, CLEAN_CONFIG);
  return true;
}

async function checkedHead(tools: SessionTools): Promise<string | null> {
  const inspected = await tools.exec(inspectCommand(), {});
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

async function runChecks(
  tools: SessionTools,
  text: string,
  sha: string,
  dirs: TreeDirs,
): Promise<boolean> {
  const extracted = await tools.exec(verifiedTreeCommand(sha, dirs), {});
  if (extracted.exitCode !== 0) return false;
  const env = { ...checksEnv, HOME: dirs.home, UW_CHECKS: text };
  const checked = await tools.exec(checksCommand(dirs.tree), env);
  return checked.exitCode === 0;
}

async function pushed(tools: SessionTools, sha: string, verified: string): Promise<boolean> {
  if (!(await tools.admit())) return false;
  await tools.writeFile(`${verified}/config`, CLEAN_BARE_CONFIG);
  return (await tools.exec(pushCommand(sha, verified), {})).exitCode === 0;
}

export function fixFinish(phase: FixPhase, ended: (ran: ExecResult) => boolean): SessionFinish {
  let declared: string | null = null;
  return {
    model: inOwnSession,
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
      if (!(await killedSession(tools, ran))) return 'checks_not_run_locally';
      const sha = await checkedHead(tools);
      if (sha === null) return 'checks_not_run_locally';
      const dirs = treeDirs(crypto.randomUUID());
      phase.enter('checks', sha);
      const passed = await heartbeat(tools, () => runChecks(tools, text, sha, dirs));
      if (!passed) return 'checks_not_run_locally';
      phase.enter('push');
      return (await pushed(tools, sha, dirs.verified)) ? 'pushed' : 'checks_not_run_locally';
    },
  };
}
