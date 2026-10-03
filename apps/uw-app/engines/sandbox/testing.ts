import type { McpHandler } from './egress.ts';
import type { ContainerHost, ExecResult } from './host.ts';

type RecordedCommand = {
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
};

type RecordedSession = {
  readonly id: string;
  readonly files: { readonly path: string; readonly content: string }[];
  readonly commands: RecordedCommand[];
  destroyed: boolean;
  readonly egress: McpHandler;
};

export type FakeContainerHost = ContainerHost & { readonly sessions: RecordedSession[] };

export function fakeContainerHost(replies: readonly (ExecResult | Error)[]): FakeContainerHost {
  const queue = [...replies];
  const sessions: RecordedSession[] = [];
  return {
    sessions,
    open: async (id, egress) => {
      const session: RecordedSession = { id, files: [], commands: [], destroyed: false, egress };
      sessions.push(session);
      return {
        writeFile: async (path, content) => {
          session.files.push({ path, content });
        },
        exec: async (command, env, timeoutMs) => {
          session.commands.push({ command: [...command], env: { ...env }, timeoutMs });
          const reply = queue.shift();
          if (reply === undefined) throw new Error('no reply scripted for the fake container');
          if (reply instanceof Error) throw reply;
          return reply;
        },
        destroy: async () => {
          session.destroyed = true;
        },
      };
    },
  };
}
