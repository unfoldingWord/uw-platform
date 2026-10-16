import type { McpHandler } from './egress.ts';
import type { ContainerHost, ExecResult } from './host.ts';

export type SessionFile = { readonly path: string; readonly content: string };

type SessionExec = (
  command: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<ExecResult>;
type FinishEnd = 'pushed' | 'checks_not_run_locally' | 'not_run';

export type SessionTools = {
  readonly exec: SessionExec;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly admit: () => Promise<boolean>;
};

export type SessionFinish = {
  readonly modelEnv: Readonly<Record<string, string>>;
  prepare(tools: SessionTools): Promise<ExecResult | null>;
  finish(ran: ExecResult, tools: SessionTools): Promise<FinishEnd>;
};

export type SessionSpec = {
  readonly sessionId: string;
  readonly files: readonly SessionFile[];
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly egress: McpHandler;
  readonly admit: () => Promise<boolean>;
  readonly finish: SessionFinish | null;
};

export type SessionRun = ExecResult & {
  readonly wallMs: number;
  readonly finished: FinishEnd | null;
};

type Session = Awaited<ReturnType<ContainerHost['open']>>;

function toolsOf(session: Session, spec: SessionSpec): SessionTools {
  return {
    exec: (command, env) => session.exec(command, { ...spec.env, ...env }, spec.timeoutMs),
    writeFile: (path, content) => session.writeFile(path, content),
    admit: spec.admit,
  };
}

async function ranIn(session: Session, spec: SessionSpec): Promise<Omit<SessionRun, 'wallMs'>> {
  const tools = toolsOf(session, spec);
  const stopped = spec.finish === null ? null : await spec.finish.prepare(tools);
  if (stopped !== null) return { ...stopped, finished: 'checks_not_run_locally' };
  const env = { ...spec.env, ...spec.finish?.modelEnv };
  const ran = await session.exec(spec.command, env, spec.timeoutMs);
  const finished = spec.finish === null ? null : await spec.finish.finish(ran, tools);
  return { ...ran, finished };
}

export async function runSession(
  host: ContainerHost,
  spec: SessionSpec,
  now: () => Date,
): Promise<SessionRun> {
  const started = now().getTime();
  const session = await host.open(spec.sessionId, spec.egress);
  try {
    for (const file of spec.files) await session.writeFile(file.path, file.content);
    const ran = await ranIn(session, spec);
    return { ...ran, wallMs: now().getTime() - started };
  } finally {
    await session.destroy();
  }
}

const DEFAULT_MINOR_PER_HOUR = 10;
const MS_PER_HOUR = 3_600_000;

export function computeMinorOf(wallMs: number, minorPerHour: string | undefined): number {
  const parsed = Number(minorPerHour);
  const rate = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MINOR_PER_HOUR;
  return Math.floor((wallMs * rate + MS_PER_HOUR / 2) / MS_PER_HOUR);
}

export function sessionIdOf(runId: string): string {
  return `run-${runId}-${crypto.randomUUID()}`;
}
