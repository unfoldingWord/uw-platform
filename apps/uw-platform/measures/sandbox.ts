import type { FilesBucket } from '../env.ts';

export type MeasureJob = {
  readonly runId: string;
  readonly runtime: 'uvx';
  readonly packageSpec: string;
  readonly lock: string | null;
  readonly command: readonly string[];
  readonly address: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
};

export type MeasureResult = {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly refusedHosts: readonly string[];
  readonly lock: string;
  readonly toolVersion: string | null;
};

export type MeasureInstallJob = Pick<MeasureJob, 'runId' | 'runtime' | 'packageSpec' | 'lock'>;

export type MeasureSandbox = {
  install(job: MeasureInstallJob): Promise<MeasureResult>;
  measure(job: MeasureJob): Promise<MeasureResult>;
  release(runId: string): Promise<void>;
};

type MeasureSandboxStub = {
  install(job: MeasureInstallJob): Promise<MeasureResult>;
  measure(job: MeasureJob): Promise<MeasureResult>;
  release(): Promise<void>;
};

type MeasureSandboxNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): MeasureSandboxStub;
};

export type MeasureRunStart = { readonly runId: string; readonly traceId: string };

export type MeasureRunBinding = {
  create(options: { readonly id: string; readonly params: MeasureRunStart }): Promise<unknown>;
};

export type MeasureBindings = {
  readonly FILES?: FilesBucket;
  readonly MEASURE_RUN?: MeasureRunBinding;
  readonly MEASURE_SANDBOX?: MeasureSandboxNamespace;
};

export const MEASURE_RUN_SLOTS = 4;
export const MEASURE_TIMEOUT_MS = 240_000;
export const MEASURE_OUTPUT_LIMIT_BYTES = 1_000_000;
export const SANDBOX_LIMITS = {
  startMs: 120_000,
  lockMs: 120_000,
  installMs: 300_000,
  graceMs: 30_000,
} as const;

const { startMs, lockMs, installMs, graceMs } = SANDBOX_LIMITS;
export const INSTALL_WORST_MS = startMs + lockMs + graceMs + installMs + graceMs;
export const RESOURCE_WORST_MS = startMs + installMs + graceMs + MEASURE_TIMEOUT_MS + graceMs;

export function measureSandboxFrom(env: MeasureBindings): MeasureSandbox | null {
  const namespace = env.MEASURE_SANDBOX;
  if (namespace === undefined) return null;
  const of = (runId: string) => namespace.get(namespace.idFromName(runId));
  return {
    install: (job) => of(job.runId).install(job),
    measure: (job) => of(job.runId).measure(job),
    release: (runId) => of(runId).release(),
  };
}

export function measureRunFrom(env: MeasureBindings): MeasureRunBinding | null {
  return env.MEASURE_RUN ?? null;
}
