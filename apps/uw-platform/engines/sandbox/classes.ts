import { Container, type OutboundHandler } from '@cloudflare/containers';
import type { Bindings, SandboxStub } from '../../env.ts';
import { dohResolver } from './measure-address.ts';
import { measureEgress } from './measure-egress.ts';
import {
  installIn,
  measureGate,
  measureIn,
  measureInstallJobSchema,
  measureJobSchema,
  type MeasureGate,
  type SandboxInstallJob,
  type SandboxMeasureJob,
  type SandboxMeasureResult,
} from './measure-host.ts';

export { ContainerProxy } from '@cloudflare/containers';

type Egress = (request: Request) => Promise<Response>;
type EgressNamespace = {
  idFromString(id: string): unknown;
  get(id: unknown): { egressFetch(request: Request): Promise<Response> };
};
type ExecResult = Awaited<ReturnType<SandboxStub['exec']>>;
type Queue = { busy: Promise<unknown> };

export const sandboxSettings = {
  enableInternet: false,
  defaultPort: 3000,
  sleepAfter: '30m',
} as const;

export const measureSandboxSettings = {
  ...sandboxSettings,
  sleepAfter: '5m',
  interceptHttps: true,
} as const;

const decoder = new TextDecoder();

function refusedEgress(): Response {
  return new Response('egress refused', { status: 403 });
}

const namespaces: ReadonlyMap<string, (env: Bindings) => EgressNamespace | undefined> = new Map<
  string,
  (env: Bindings) => EgressNamespace | undefined
>([
  ['ClaudeCodeSandbox', (env: Bindings) => env.CLAUDE_CODE_SANDBOX],
  ['CodexSandbox', (env: Bindings) => env.CODEX_SANDBOX],
  ['MeasureSandbox', (env: Bindings) => env.MEASURE_SANDBOX],
]);

export const routeOutbound: OutboundHandler<Bindings> = async (request, env, context) => {
  const namespace = namespaces.get(context.className)?.(env);
  if (namespace === undefined) return refusedEgress();
  return namespace.get(namespace.idFromString(context.containerId)).egressFetch(request);
};

class EgressSandbox extends Container<Bindings> implements SandboxStub {
  override enableInternet = sandboxSettings.enableInternet;
  override defaultPort = sandboxSettings.defaultPort;
  override sleepAfter: string | number = sandboxSettings.sleepAfter;
  private egress: Egress | null = null;

  async bindEgress(egress: Egress): Promise<void> {
    this.egress = egress;
  }

  async egressFetch(request: Request): Promise<Response> {
    return this.egress === null ? refusedEgress() : this.egress(request);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const write = ['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path];
    const done = await this.run(write, {}, new Blob([content]).stream());
    if (done.exitCode !== 0) throw new Error(`the sandbox could not write ${path}`);
  }

  async exec(command: string[], env: Record<string, string>, timeoutMs: number) {
    return this.run(command, env, null, AbortSignal.timeout(timeoutMs));
  }

  override async destroy(): Promise<void> {
    this.egress = null;
    await super.destroy();
  }

  private async run(
    command: string[],
    env: Record<string, string>,
    stdin: ReadableStream | null,
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    const container = this.ctx.container;
    if (container === undefined) throw new Error('the sandbox has no container');
    await this.start();
    const options = { env, stdout: 'pipe' as const, stderr: 'pipe' as const };
    const process = await container.exec(command, {
      ...options,
      ...(stdin === null ? {} : { stdin }),
      ...(signal === undefined ? {} : { signal }),
    });
    const output = await process.output();
    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }
}

export class ClaudeCodeSandbox extends EgressSandbox {}
export class CodexSandbox extends EgressSandbox {}

const upstream: Egress = (request) => fetch(request);

function inTurn<T>(queue: Queue, work: () => Promise<T>): Promise<T> {
  const turn = queue.busy.then(work, work);
  queue.busy = turn.catch(() => undefined);
  return turn;
}

export class MeasureSandbox extends EgressSandbox {
  override sleepAfter = measureSandboxSettings.sleepAfter;
  override interceptHttps = measureSandboxSettings.interceptHttps;
  private gate: MeasureGate = measureGate(dohResolver(upstream));
  private readonly queue: Queue = { busy: Promise.resolve() };
  private jobs = 0;

  override async bindEgress(): Promise<void> {
    throw new Error('the measure sandbox routes its own egress');
  }

  override async egressFetch(request: Request): Promise<Response> {
    return measureEgress(request, this.gate.route, upstream);
  }

  async install(job: unknown): Promise<SandboxMeasureResult> {
    const parsed = measureInstallJobSchema.parse(job);
    return inTurn(this.queue, () => this.installAlone(parsed));
  }

  async measure(job: unknown): Promise<SandboxMeasureResult> {
    const parsed = measureJobSchema.parse(job);
    return inTurn(this.queue, () => this.measureAlone(parsed));
  }

  async release(): Promise<void> {
    if (this.jobs > 0 || this.ctx.container?.running !== true) return;
    await this.destroy();
  }

  override async onActivityExpired(): Promise<void> {
    if (this.jobs > 0) return this.renewActivityTimeout();
    await super.onActivityExpired();
  }

  private installAlone(job: SandboxInstallJob): Promise<SandboxMeasureResult> {
    return this.alone((gate) => installIn(this, gate, job));
  }

  private measureAlone(job: SandboxMeasureJob): Promise<SandboxMeasureResult> {
    return this.alone((gate) => measureIn(this, gate, job));
  }

  private async alone(
    work: (gate: MeasureGate) => Promise<SandboxMeasureResult>,
  ): Promise<SandboxMeasureResult> {
    this.jobs += 1;
    this.gate = measureGate(dohResolver(upstream));
    try {
      return await work(this.gate);
    } finally {
      this.jobs -= 1;
      this.renewActivityTimeout();
    }
  }
}

ClaudeCodeSandbox.outbound = routeOutbound;
CodexSandbox.outbound = routeOutbound;
MeasureSandbox.outbound = routeOutbound;
