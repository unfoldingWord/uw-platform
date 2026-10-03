import { Container, type OutboundHandler } from '@cloudflare/containers';
import type { Bindings, SandboxNamespace, SandboxStub } from '../../env.ts';

export { ContainerProxy } from '@cloudflare/containers';

type Egress = (request: Request) => Promise<Response>;
type ExecResult = Awaited<ReturnType<SandboxStub['exec']>>;

export const sandboxSettings = {
  enableInternet: false,
  defaultPort: 3000,
  sleepAfter: '30m',
} as const;

const decoder = new TextDecoder();

function refusedEgress(): Response {
  return new Response('egress refused', { status: 403 });
}

const namespaces: ReadonlyMap<string, (env: Bindings) => SandboxNamespace | undefined> = new Map([
  ['ClaudeCodeSandbox', (env: Bindings) => env.CLAUDE_CODE_SANDBOX],
  ['CodexSandbox', (env: Bindings) => env.CODEX_SANDBOX],
]);

export const routeOutbound: OutboundHandler<Bindings> = async (request, env, context) => {
  const namespace = namespaces.get(context.className)?.(env);
  if (namespace === undefined) return refusedEgress();
  return namespace.get(namespace.idFromString(context.containerId)).egressFetch(request);
};

class EgressSandbox extends Container<Bindings> implements SandboxStub {
  override enableInternet = sandboxSettings.enableInternet;
  override defaultPort = sandboxSettings.defaultPort;
  override sleepAfter = sandboxSettings.sleepAfter;
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

ClaudeCodeSandbox.outbound = routeOutbound;
CodexSandbox.outbound = routeOutbound;
