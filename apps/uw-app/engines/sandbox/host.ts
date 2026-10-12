import type { SandboxNamespace } from '../../env.ts';
import type { McpHandler } from './egress.ts';

export type ExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type ContainerSession = {
  writeFile(path: string, content: string): Promise<void>;
  exec(
    command: readonly string[],
    env: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<ExecResult>;
  destroy(): Promise<void>;
};

export type ContainerHost = {
  open(sessionId: string, egress: McpHandler): Promise<ContainerSession>;
};

export function sandboxHost(namespace: SandboxNamespace): ContainerHost {
  return {
    open: async (sessionId, egress) => {
      const sandbox = namespace.get(namespace.idFromName(sessionId));
      await sandbox.bindEgress(egress);
      return {
        writeFile: (path, content) => sandbox.writeFile(path, content),
        exec: (command, env, timeoutMs) => sandbox.exec([...command], { ...env }, timeoutMs),
        destroy: () => sandbox.destroy(),
      };
    },
  };
}
