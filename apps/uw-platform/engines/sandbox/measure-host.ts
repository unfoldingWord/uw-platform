import { z } from 'zod';
import type { Resolve } from './measure-address.ts';
import type { MeasurePhase, MeasureRoute } from './measure-egress.ts';

export type SandboxMeasureJob = z.infer<typeof measureJobSchema>;
export type SandboxInstallJob = z.infer<typeof measureInstallJobSchema>;

export type SandboxMeasureResult = {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly refusedHosts: readonly string[];
  readonly lock: string;
  readonly toolVersion: string | null;
};

export type MeasureContainer = {
  writeFile(path: string, content: string): Promise<void>;
  exec(
    command: string[],
    env: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
};

export type MeasureGate = {
  readonly route: MeasureRoute;
  enter(phase: MeasurePhase): void;
  hosts(): readonly string[];
};

type Envelope = z.infer<typeof envelopeSchema>;

const RUNNER = '/opt/measure/runner.py';
const LOCK_FILE = '/workspace/requirements.txt';
const LOCK_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;
const GRACE_MS = 30_000;
export const MEASURE_HOST_LIMITS = {
  lockMs: LOCK_TIMEOUT_MS,
  installMs: INSTALL_TIMEOUT_MS,
  graceMs: GRACE_MS,
} as const;
const LOCK_LIMIT = 1_048_576;
const UNPINNED = 'the lock holds a line that is not a pinned, hashed package';
const closed: MeasurePhase = { kind: 'closed' };
const CONTINUED = ' \\';
const MARKER = ' ; ';
const requirement = /^[A-Za-z0-9][A-Za-z0-9._,[\]-]*==[A-Za-z0-9.!+_-]+$/;
const hashLine = /^ {4}--hash=sha256:[0-9a-f]{64}$/;
const pinnedSpec = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}==[A-Za-z0-9.!+_-]{1,50}$/;

function plainWebAddress(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  return web && url.username === '' && url.password === '' && url.hostname !== '';
}

export const measureJobSchema = z.strictObject({
  runId: z.string().min(1).max(100),
  runtime: z.literal('uvx'),
  packageSpec: z.string().regex(pinnedSpec),
  lock: z.string().max(LOCK_LIMIT).nullable(),
  command: z.array(z.string().min(1).max(500)).min(1).max(40).readonly(),
  address: z.string().max(2048).refine(plainWebAddress, 'a plain http or https address'),
  timeoutMs: z.number().int().min(1_000).max(900_000),
  outputLimitBytes: z.number().int().min(1).max(10_485_760),
});

export const measureInstallJobSchema = measureJobSchema.pick({
  runId: true,
  runtime: true,
  packageSpec: true,
  lock: true,
});

const envelopeSchema = z.strictObject({
  exit_code: z.number().int().nullable(),
  timed_out: z.boolean(),
  stdout: z.string(),
  stderr_tail: z.string(),
});

function withoutContinuation(line: string): string {
  return line.endsWith(CONTINUED) ? line.slice(0, -CONTINUED.length) : line;
}

function isPin(line: string): boolean {
  if (!line.endsWith(CONTINUED)) return false;
  const body = withoutContinuation(line);
  const split = body.indexOf(MARKER);
  const pin = split === -1 ? body : body.slice(0, split);
  const marker = split === -1 ? '' : body.slice(split + MARKER.length);
  return requirement.test(pin) && !marker.includes('\\');
}

function nextWanted(wanted: 'pin' | 'hash', line: string): 'pin' | 'hash' | null {
  if (wanted === 'pin') return line === '' ? 'pin' : isPin(line) ? 'hash' : null;
  if (!hashLine.test(withoutContinuation(line))) return null;
  return line.endsWith(CONTINUED) ? 'hash' : 'pin';
}

export function lockIsPinned(lock: string): boolean {
  const lines = lock.split('\n');
  let wanted: 'pin' | 'hash' | null = 'pin';
  for (const line of lines) wanted = wanted === null ? null : nextWanted(wanted, line);
  return wanted === 'pin' && lines.some(isPin);
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runner(container: MeasureContainer, args: readonly string[], timeoutMs: number) {
  const reply = await container.exec(['python3', RUNNER, ...args], {}, timeoutMs + GRACE_MS);
  const envelope = envelopeSchema.safeParse(parsedJson(reply.stdout));
  if (!envelope.success) throw new Error('the measure runner answered out of shape');
  return envelope.data;
}

function memoized(resolve: Resolve): Resolve {
  const answers = new Map<string, Promise<readonly string[] | null>>();
  return (hostname) => {
    const known = answers.get(hostname) ?? resolve(hostname);
    answers.set(hostname, known);
    return known;
  };
}

export function measureGate(resolve: Resolve): MeasureGate {
  let phase = closed;
  const refused = new Set<string>();
  return {
    route: { phase: () => phase, resolve: memoized(resolve), refused: (host) => refused.add(host) },
    enter: (next) => {
      phase = next;
    },
    hosts: () => [...refused].sort(),
  };
}

function normalized(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function toolVersionIn(lock: string, packageSpec: string): string | null {
  const wanted = normalized(packageSpec.split('==')[0] ?? '');
  const pins = lock.split('\n').map((line) => /^([A-Za-z0-9][\w.-]*)==([^\s\\;]+)/.exec(line));
  const pin = pins.find((match) => match !== null && normalized(match[1] ?? '') === wanted);
  return pin?.[2] ?? null;
}

function filledCommand(command: readonly string[], address: string): string[] {
  const host = new URL(address).host;
  return command.map((arg) =>
    arg.replace(/\{address\}|\{host\}/g, (token) => (token === '{host}' ? host : address)),
  );
}

function stopped(envelope: Envelope, lock: string, gate: MeasureGate): SandboxMeasureResult {
  return {
    exitCode: envelope.exit_code,
    timedOut: envelope.timed_out,
    stdout: '',
    stderrTail: envelope.stderr_tail,
    refusedHosts: gate.hosts(),
    lock,
    toolVersion: null,
  };
}

async function lockOf(container: MeasureContainer, job: SandboxInstallJob): Promise<Envelope> {
  if (job.lock !== null)
    return { exit_code: 0, timed_out: false, stdout: job.lock, stderr_tail: '' };
  return runner(container, ['lock', String(LOCK_TIMEOUT_MS), job.packageSpec], LOCK_TIMEOUT_MS);
}

async function installed(
  container: MeasureContainer,
  gate: MeasureGate,
  job: SandboxInstallJob,
): Promise<SandboxMeasureResult> {
  gate.enter({ kind: 'install' });
  const locked = await lockOf(container, job);
  if (locked.exit_code !== 0) return stopped(locked, '', gate);
  const lock = locked.stdout;
  if (!lockIsPinned(lock))
    return stopped({ ...locked, exit_code: 2, stderr_tail: UNPINNED }, lock, gate);
  await container.writeFile(LOCK_FILE, lock);
  const done = await runner(container, ['install', String(INSTALL_TIMEOUT_MS)], INSTALL_TIMEOUT_MS);
  if (done.exit_code !== 0) return stopped(done, lock, gate);
  return { ...stopped(done, lock, gate), toolVersion: toolVersionIn(lock, job.packageSpec) };
}

async function measured(container: MeasureContainer, gate: MeasureGate, job: SandboxMeasureJob) {
  const install = await installed(container, gate, job);
  if (install.exitCode !== 0) return install;
  gate.enter({ kind: 'measure', origin: new URL(job.address).origin });
  const limits = [String(job.timeoutMs), String(job.outputLimitBytes)];
  const command = ['run', ...limits, '--', ...filledCommand(job.command, job.address)];
  const run = await runner(container, command, job.timeoutMs);
  return {
    exitCode: run.exit_code,
    timedOut: run.timed_out,
    stdout: run.stdout,
    stderrTail: run.stderr_tail,
    refusedHosts: gate.hosts(),
    lock: install.lock,
    toolVersion: install.toolVersion,
  };
}

export async function installIn(
  container: MeasureContainer,
  gate: MeasureGate,
  job: SandboxInstallJob,
): Promise<SandboxMeasureResult> {
  try {
    return await installed(container, gate, job);
  } finally {
    gate.enter(closed);
  }
}

export async function measureIn(
  container: MeasureContainer,
  gate: MeasureGate,
  job: SandboxMeasureJob,
): Promise<SandboxMeasureResult> {
  try {
    return await measured(container, gate, job);
  } finally {
    gate.enter(closed);
  }
}
